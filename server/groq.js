import { completionResponse, requestSignal } from './completionResponse.js';
import { createHash } from 'node:crypto';

export const FALLBACK_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const BROWSER_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
const VISION_MODELS = new Set(['qwen/qwen3.8-27b']);

function durationMs(value) {
  const str = String(value || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(str)) return Number(str) * 1000;
  let total = 0;
  for (const match of str.matchAll(/([\d.]+)\s*(h|m|s)/g)) total += Number(match[1]) * ({ h: 3600000, m: 60000, s: 1000 }[match[2]]);
  return total;
}

export function createGroqClient({ fetchImpl = fetch, now = Date.now } = {}) {
  const cooldowns = new Map();
  const modelLists = new Map();
  const keyId = key => createHash('sha256').update(key).digest('hex');

  async function available(key) {
    const id = keyId(key);
    const saved = modelLists.get(id);
    if (saved && saved.expires > now()) return saved.promise;
    const promise = (async () => {
      try {
        const response = await fetchImpl('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        const data = await response.json();
        return new Set(data.data?.filter(model => model.active !== false).map(model => model.id) || []);
      } catch { return null; }
    })();
    modelLists.set(id, { promise, expires: now() + 600000 });
    return promise;
  }

  async function complete(key, messages, options = {}) {
    const preferred = options.model || FALLBACK_MODELS[0];
    const browser = options.extra?.tools?.some(tool => tool.type === 'browser_search');
    const vision = options.vision || messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
    const listed = key ? await available(key) : null;
    const candidates = key ? [...new Set([vision && !VISION_MODELS.has(preferred) ? 'qwen/qwen3.8-27b' : preferred, ...FALLBACK_MODELS])].filter(model => (!listed || listed.has(model)) && (!browser || BROWSER_MODELS.has(model)) && (!vision || VISION_MODELS.has(model))) : [];
    const attempted = [];
    let limited = false;
    let emptyResponse = false;
    let lastError;
    let nextRetry = Infinity;
    for (const model of candidates) {
      options.signal?.throwIfAborted(); options.onReset?.();
      const slot = `${keyId(key)}:${model}`;
      const blocked = cooldowns.get(slot);
      if (blocked?.until > now()) {
        if (blocked.reason === 'rate_limit') { limited = true; nextRetry = Math.min(nextRetry, blocked.until - now()); }
        continue;
      }
      attempted.push(model);
      const extra = { ...options.extra };
      if (!model.startsWith('openai/') && !model.startsWith('qwen/')) delete extra.reasoning_effort;
      const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, ...(options.onToken ? { stream: true } : {}), temperature: options.temperature ?? .25, max_tokens: options.maxTokens || 1800, ...extra }),
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
        return { content, model, provider: 'Groq', requestedModel: preferred, switched: model !== preferred, reason: limited ? 'rate_limit' : vision && model !== preferred ? 'vision_model' : model !== preferred ? 'model_unavailable' : null, attemptedModels: attempted };
      }
      lastError = new Error(data.error?.message || `Groq request failed (${response.status})`);
      lastError.status = response.status;
      if (response.status === 429) {
        limited = true;
        const retry = response.headers.get('retry-after');
        const messageDelay = data.error?.message?.match(/try again in ([\d.hms]+)/i)?.[1];
        const delay = durationMs(retry) || (retry && Date.parse(retry) - now()) || durationMs(messageDelay) || 60000;
        cooldowns.set(slot, { until: now() + Math.max(1000, delay), reason: 'rate_limit' });
        nextRetry = Math.min(nextRetry, Math.max(1000, delay));
        continue;
      }
      if (response.status === 404 || response.status === 403 || (response.status === 400 && /decommission|not supported|model.*not.*available/i.test(lastError.message))) {
        cooldowns.set(slot, { until: now() + 600000, reason: 'unavailable' });
        continue;
      }
      // An invalid key or malformed request will not be fixed by changing models.
      throw lastError;
    }
    if (limited) {
      const seconds = Math.ceil((Number.isFinite(nextRetry) ? nextRetry : 60000) / 1000);
      const error = new Error(`All available Groq models are currently rate limited. Try again in about ${seconds} seconds.`);
      error.status = 429;
      throw error;
    }
    if (emptyResponse) throw new Error('Available Groq models returned no answer. Please try again in a moment.');
    throw lastError || new Error(vision ? 'No Groq vision model is available for this key right now.' : 'No supported Groq models are available for this request.');
  }
  async function status(key) {
    const listed = await available(key);
    return FALLBACK_MODELS.filter(model => !listed || listed.has(model)).map(model => {
      const blocked = cooldowns.get(`${keyId(key)}:${model}`);
      return { id: model, retryInSeconds: blocked?.until > now() ? Math.ceil((blocked.until - now()) / 1000) : 0, reason: blocked?.until > now() ? blocked.reason : null };
    });
  }
  return { complete, status };
}
