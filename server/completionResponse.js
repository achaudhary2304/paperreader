import { eventStream } from '../shared/eventStream.js';

export function requestSignal(signal, ms) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

export async function completionResponse(response, options) {
  if (!response.ok || !response.headers?.get('content-type')?.includes('text/event-stream')) return response.json().catch(() => ({}));
  let content = '', model, usage, finished = false;
  for await (const raw of eventStream(response.body)) {
    options.signal?.throwIfAborted();
    if (raw === '[DONE]') { finished = true; break; }
    const data = JSON.parse(raw);
    if (data.error) throw new Error(data.error.message || 'Provider stream failed.');
    model = data.model || model; usage = data.usage || usage;
    if (data.choices?.[0]?.finish_reason) finished = true;
    const token = data.choices?.[0]?.delta?.content;
    if (typeof token === 'string') { content += token; options.onToken?.(token); }
  }
  if (!finished) throw new Error('The provider stream ended before the answer completed. Please retry.');
  return { model, usage, choices: [{ message: { content } }] };
}
