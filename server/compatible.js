export function createCompatibleClient({ fetchImpl = fetch } = {}) {
  async function complete(key, messages, options = {}) {
    const base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
    const model = options.vision ? process.env.LLM_VISION_MODEL : process.env.LLM_MODEL;
    if (!base || !model) throw new Error(options.vision ? 'Set LLM_VISION_MODEL to use images with this provider.' : 'Set LLM_BASE_URL and LLM_MODEL.');
    const url = new URL(base);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('LLM_BASE_URL must use HTTPS, or HTTP on this computer.');
    }
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages, max_tokens: options.maxTokens || 1800, temperature: options.temperature ?? .2 }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error?.message || `LLM request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const raw = data.choices?.[0]?.message?.content;
    const content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(part => part.text || '').join('') : '';
    if (!content.trim()) throw new Error(`${model} returned an empty answer.`);
    return { content: content.trim(), model, provider: process.env.LLM_PROVIDER_NAME || 'Custom API' };
  }
  return { complete };
}
