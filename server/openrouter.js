import { completionResponse, requestSignal } from './completionResponse.js';
export function isFreeModel(model) {
  return (
    (model.id === 'openrouter/free' || model.id?.endsWith(':free')) &&
    model.pricing?.prompt !== undefined &&
    model.pricing?.completion !== undefined &&
    Object.values(model.pricing).every(
      (value) =>
        value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) === 0,
    )
  );
}

export function smallestFreeTextModel(models) {
  return (
    models
      .filter((model) => !model.vision)
      .map((model) => ({
        id: model.id,
        size:
          Number(model.id.match(/(?:^|[-/])(\d+(?:\.\d+)?)b/i)?.[1]) || Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.size - b.size || a.id.localeCompare(b.id))[0]?.id || 'openrouter/free'
  );
}

export function createOpenRouterClient({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached;
  async function freeUsage(key) {
    const response = await fetchImpl('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      throw new Error('Could not check OpenRouter free request usage.');
    }
    const quota = (await response.json()).data?.free_model_daily_requests;
    if (
      !quota ||
      ![quota.limit, quota.remaining, quota.used].every((value) => Number.isFinite(Number(value)))
    ) {
      throw new Error('OpenRouter did not provide free request usage.');
    }
    return {
      limit: Number(quota.limit),
      remaining: Number(quota.remaining),
      used: Number(quota.used),
    };
  }
  async function models() {
    if (cached && cached.expires > now()) {
      return cached.promise;
    }
    const promise = (async () => {
      const response = await fetchImpl('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        throw new Error('Could not verify OpenRouter free-model pricing. Please retry.');
      }
      const data = await response.json();
      return (data.data || []).filter(isFreeModel).map((model) => ({
        id: model.id,
        name: model.name,
        contextLength: model.context_length,
        vision:
          model.architecture?.input_modalities?.includes('image') &&
          model.architecture?.output_modalities?.includes('text'),
      }));
    })();
    cached = { promise, expires: now() + 300000 };
    try {
      return await promise;
    } catch (error) {
      cached = undefined;
      throw error;
    }
  }

  async function complete(key, messages, options = {}) {
    const free = await models();
    const preferred = options.model || 'openrouter/free';
    if (!free.some((model) => model.id === preferred)) {
      throw new Error(
        'Only verified zero-priced OpenRouter free models are allowed. Choose a free model in Settings.',
      );
    }
    const vision =
      options.vision ||
      messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'image_url'),
      );
    const score = (id) => {
      if (/gemma-4-31b-it:free/i.test(id)) {
        return 6;
      } else if (/gemma.*-it:free/i.test(id)) {
        return 5;
      } else if (/qwen.*:free/i.test(id)) {
        return 4;
      } else if (/llama.*:free/i.test(id)) {
        return 3;
      } else if (/nemotron.*(?:super|ultra).*:free/i.test(id)) {
        return 2;
      } else if (/cohere.*:free/i.test(id)) {
        return 1;
      } else {
        return 0;
      }
    };
    const eligible = free.filter(
      (model) =>
        (!vision || (model.vision && model.id !== 'openrouter/free')) &&
        !/safety|guard|embed|reasoning|code|preview/i.test(model.id),
    );
    let preferredModel;
    if (
      vision &&
      (preferred === 'openrouter/free' || !free.find((model) => model.id === preferred)?.vision)
    ) {
      preferredModel = eligible
        .filter((model) => model.id !== 'openrouter/free')
        .sort((a, b) => score(b.id) - score(a.id))[0]?.id;
    } else {
      preferredModel = preferred;
    }
    if (!preferredModel) {
      throw new Error(
        'No verified free vision model is currently available on OpenRouter. Try again when one is listed.',
      );
    }
    const fallback = eligible
      .filter((model) => model.id !== preferredModel)
      .sort((a, b) => score(b.id) - score(a.id))
      .slice(0, 2)
      .map((model) => model.id);
    const candidates = [preferredModel, ...fallback];
    for (let index = 0; index < candidates.length; index++) {
      const getOptionsOnToken = () => {
        if (options.onToken) {
          return { stream: true };
        }
        return {};
      };
      const getReason = () => {
        if (vision && preferredModel !== preferred) {
          return 'vision_model';
        }
        return 'free_model_fallback';
      };

      const candidate = candidates[index];
      options.signal?.throwIfAborted();
      options.onReset?.();
      const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://127.0.0.1:5173',
          'X-OpenRouter-Title': 'PaperReader',
        },
        body: JSON.stringify({
          ...getOptionsOnToken(),
          model: candidate,
          models: candidates.slice(index, index + 3),
          messages,
          max_tokens: options.maxTokens || 1600,
          temperature: options.temperature ?? 0.2,
          provider: {
            max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
            allow_fallbacks: true,
          },
        }),
        signal: requestSignal(options.signal, 60000),
      });
      const data = await completionResponse(response, options);
      if (!response.ok) {
        let message = data.error?.message || `OpenRouter request failed (${response.status}).`;
        if (response.status === 429) {
          const usage = await freeUsage(key).catch(() => null);

          if (usage?.remaining === 0) {
            message = `OpenRouter daily free allowance is used up (${usage.used}/${usage.limit} requests). Try again after the daily reset.`;
          } else if (usage) {
            message = `OpenRouter temporarily rate-limited this request or has no free-model capacity. You still have ${usage.remaining}/${usage.limit} free requests left today. Wait a moment and try again.`;
          } else {
            message =
              'OpenRouter temporarily rate-limited this free request. Check your usage in Settings and try again shortly.';
          }
        }
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      const raw = data.choices?.[0]?.message?.content;
      let content;
      if (typeof raw === 'string') {
        content = raw;
      } else if (Array.isArray(raw)) {
        content = raw
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            } else {
              return part.text || part.content || '';
            }
          })
          .join('');
      } else {
        content = '';
      }
      if (!content?.trim()) {
        continue;
      }
      const model = data.model || candidate;
      const label =
        free.find((item) => item.id === model || item.id.replace(/:free$/, '') === model)?.name ||
        model;
      return {
        content: content.trim(),
        model,
        modelName: label,
        provider: 'OpenRouter',
        freeOnly: true,
        cost: data.usage?.cost,
        requestedModel: preferred,
        switched:
          index > 0 ||
          preferredModel !== preferred ||
          (preferred !== 'openrouter/free' &&
            model.replace(/:free$/, '') !== preferred.replace(/:free$/, '')),
        reason: getReason(),
      };
    }
    throw new Error(
      'The available free models returned no final answer. Please retry when free capacity is available.',
    );
  }
  return { complete, models, freeUsage };
}
