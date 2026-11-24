import { completionResponse, requestSignal } from './completionResponse.js';
import { createHash } from 'node:crypto';
import { GROQ_MODELS } from '../shared/models.js';

export const FALLBACK_MODELS = GROQ_MODELS.map((model) => model.id);
const BROWSER_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
const VISION_MODELS = new Set(['qwen/qwen3.8-27b']);

function durationMs(value) {
  const str = String(value || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    return Number(str) * 1000;
  }
  let total = 0;
  for (const match of str.matchAll(/([\d.]+)\s*(h|m|s)/g)) {
    total += Number(match[1]) * { h: 3600000, m: 60000, s: 1000 }[match[2]];
  }
  return total;
}

export function createGroqClient({ fetchImpl = fetch, now = Date.now } = {}) {
  const cooldowns = new Map();
  const modelLists = new Map();
  const keyId = (key) => createHash('sha256').update(key).digest('hex');

  async function available(key) {
    const id = keyId(key);
    const saved = modelLists.get(id);
    if (saved && saved.expires > now()) {
      return saved.promise;
    }
    const promise = (async () => {
      try {
        const response = await fetchImpl('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return null;
        }
        const data = await response.json();
        return new Set(
          data.data?.filter((model) => model.active !== false).map((model) => model.id) || [],
        );
      } catch {
        return null;
      }
    })();
    modelLists.set(id, { promise, expires: now() + 600000 });
    return promise;
  }

  async function complete(key, messages, options = {}) {
    const getVision = () => {
      if (vision) {
        return 'No Groq vision model is available for this key right now.';
      }
      return 'No supported Groq models are available for this request.';
    };

    const preferred = options.model || FALLBACK_MODELS[0];
    const browser = options.extra?.tools?.some((tool) => tool.type === 'browser_search');
    const vision =
      options.vision ||
      messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image_url'),
      );
    let listed;
    if (key) {
      listed = await available(key);
    } else {
      listed = null;
    }
    let candidates;
    if (key) {
      const getVisionVISIONMODELSHasPreferred = () => {
        if (vision && !VISION_MODELS.has(preferred)) {
          return 'qwen/qwen3.8-27b';
        }
        return preferred;
      };

      candidates = [...new Set([getVisionVISIONMODELSHasPreferred(), ...FALLBACK_MODELS])].filter(
        (model) =>
          (!listed || listed.has(model)) &&
          (!browser || BROWSER_MODELS.has(model)) &&
          (!vision || VISION_MODELS.has(model)),
      );
    } else {
      candidates = [];
    }
    const attempted = [];
    let limited = false;
    let emptyResponse = false;
    let lastError;
    let nextRetry = Infinity;
    for (const model of candidates) {
      const getOptionsOnToken = () => {
        if (options.onToken) {
          return { stream: true };
        }
        return {};
      };

      options.signal?.throwIfAborted();
      options.onReset?.();
      const slot = `${keyId(key)}:${model}`;
      const blocked = cooldowns.get(slot);
      if (blocked?.until > now()) {
        if (blocked.reason === 'rate_limit') {
          limited = true;
          nextRetry = Math.min(nextRetry, blocked.until - now());
        }
        continue;
      }
      attempted.push(model);
      const extra = { ...options.extra };
      if (!model.startsWith('openai/') && !model.startsWith('qwen/')) {
        delete extra.reasoning_effort;
      }
      const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          ...getOptionsOnToken(),
          temperature: options.temperature ?? 0.25,
          max_tokens: options.maxTokens || 1800,
          ...extra,
        }),
        signal: requestSignal(options.signal, 45000),
      });
      const data = await completionResponse(response, options);
      if (response.ok) {
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          emptyResponse = true;
          lastError = new Error(`${model} returned an empty response.`);
          continue;
        }
        let switchReason = null;
        if (limited) {
          switchReason = 'rate_limit';
        } else if (vision && model !== preferred) {
          switchReason = 'vision_model';
        } else if (model !== preferred) {
          switchReason = 'model_unavailable';
        }
        return {
          content,
          model,
          provider: 'Groq',
          requestedModel: preferred,
          switched: model !== preferred,
          reason: switchReason,
          attemptedModels: attempted,
        };
      }
      lastError = new Error(data.error?.message || `Groq request failed (${response.status})`);
      lastError.status = response.status;
      if (response.status === 429) {
        limited = true;
        const retry = response.headers.get('retry-after');
        const messageDelay = data.error?.message?.match(/try again in ([\d.hms]+)/i)?.[1];
        const delay =
          durationMs(retry) ||
          (retry && Date.parse(retry) - now()) ||
          durationMs(messageDelay) ||
          60000;
        cooldowns.set(slot, { until: now() + Math.max(1000, delay), reason: 'rate_limit' });
        nextRetry = Math.min(nextRetry, Math.max(1000, delay));
        continue;
      }
      if (
        response.status === 404 ||
        response.status === 403 ||
        (response.status === 400 &&
          /decommission|not supported|model.*not.*available/i.test(lastError.message))
      ) {
        cooldowns.set(slot, { until: now() + 600000, reason: 'unavailable' });
        continue;
      }
      // An invalid key or malformed request will not be fixed by changing models.
      throw lastError;
    }
    if (limited) {
      const getNumberIsFiniteNextRetry = () => {
        if (Number.isFinite(nextRetry)) {
          return nextRetry;
        }
        return 60000;
      };

      const seconds = Math.ceil(getNumberIsFiniteNextRetry() / 1000);
      const error = new Error(
        `All available Groq models are currently rate limited. Try again in about ${seconds} seconds.`,
      );
      error.status = 429;
      throw error;
    }
    if (emptyResponse) {
      throw new Error('Available Groq models returned no answer. Please try again in a moment.');
    }
    throw lastError || new Error(getVision());
  }
  async function status(key) {
    const listed = await available(key);
    return FALLBACK_MODELS.filter((model) => !listed || listed.has(model)).map((model) => {
      const getRetryInSeconds = () => {
        if (blocked?.until > now()) {
          return Math.ceil((blocked.until - now()) / 1000);
        }
        return 0;
      };

      const getReason = () => {
        if (blocked?.until > now()) {
          return blocked.reason;
        }
        return null;
      };

      const blocked = cooldowns.get(`${keyId(key)}:${model}`);
      return {
        id: model,
        retryInSeconds: getRetryInSeconds(),
        reason: getReason(),
      };
    });
  }
  return { complete, status };
}
