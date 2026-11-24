import { completionResponse, requestSignal } from './completionResponse.js';
export function createCompatibleClient({ fetchImpl = fetch } = {}) {
  async function complete(key, messages, options = {}) {
    const getKey = () => {
      if (key) {
        return { Authorization: `Bearer ${key}` };
      }
      return {};
    };

    const getOptionsOnToken = () => {
      if (options.onToken) {
        return { stream: true };
      }
      return {};
    };

    const base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
    let model;
    if (options.vision) {
      model = process.env.LLM_VISION_MODEL;
    } else {
      model = process.env.LLM_MODEL;
    }
    if (!base || !model) {
      const getOptionsVision = () => {
        if (options.vision) {
          return 'Set LLM_VISION_MODEL to use images with this provider.';
        }
        return 'Set LLM_BASE_URL and LLM_MODEL.';
      };

      throw new Error(getOptionsVision());
    }
    const url = new URL(base);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new Error('LLM_BASE_URL must use HTTPS, or HTTP on this computer.');
    }
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getKey(),
      },
      body: JSON.stringify({
        model,
        messages,
        ...getOptionsOnToken(),
        max_tokens: options.maxTokens || 1800,
        temperature: options.temperature ?? 0.2,
      }),
      signal: requestSignal(options.signal, 60000),
    });
    const data = await completionResponse(response, options);
    if (!response.ok) {
      const error = new Error(data.error?.message || `LLM request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const raw = data.choices?.[0]?.message?.content;
    let content;
    if (typeof raw === 'string') {
      content = raw;
    } else if (Array.isArray(raw)) {
      content = raw.map((part) => part.text || '').join('');
    } else {
      content = '';
    }
    if (!content.trim()) {
      throw new Error(`${model} returned an empty answer.`);
    }
    return {
      content: content.trim(),
      model,
      provider: process.env.LLM_PROVIDER_NAME || 'Custom API',
    };
  }
  return { complete };
}
