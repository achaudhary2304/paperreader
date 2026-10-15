export async function completeWithFallback({ compatibleClient, compatibleKey, compatibleConfigured, openRouterClient, groqClient, openRouterKey, groqKey, messages, options = {}, groqModel }) {
  const record = (provider, started, outcome, model) => {
    try { options.onTiming?.({ stage: options.timingStage || 'Inference', provider, model, ms: Math.round(performance.now() - started), outcome }); } catch { /* metrics must not interrupt inference */ }
  };
  if (compatibleConfigured) {
    const started = performance.now();
    try { const result = await compatibleClient.complete(compatibleKey, messages, options); record(result.provider || 'Custom API', started, 'ok', result.model); return result; }
    catch (error) { record('Custom API', started, 'error', options.model); throw error; }
  }
  if (options.providerPriority === 'groq' && groqKey && openRouterKey) {
    const started = performance.now();
    try {
      const model = options.groqModel || groqModel;
      const result = await groqClient.complete(groqKey, messages, { ...options, model });
      record('Groq', started, 'ok', result.model); return result;
    } catch (error) {
      record('Groq', started, 'error', options.groqModel || groqModel);
      options.signal?.throwIfAborted();
      options.onReset?.();
      const result = await completeWithFallback({ openRouterClient, groqClient, openRouterKey, messages,
        options: { ...options, providerPriority: 'openrouter' }, groqModel });
      return { ...result, switched: true, reason: 'provider_fallback', fallbackFrom: 'Groq' };
    }
  }
  if (!openRouterKey) {
    const started = performance.now();
    try { const result = await groqClient.complete(groqKey, messages, { ...options, model: options.groqModel || options.model }); record('Groq', started, 'ok', result.model); return result; }
    catch (error) { record('Groq', started, 'error', options.model || groqModel); throw error; }
  }

  const openRouterModel = options.model?.endsWith(':free') || options.model === 'openrouter/free' ? options.model : 'openrouter/free';
  const openRouterStarted = performance.now();
  try {
    const result = await openRouterClient.complete(openRouterKey, messages, { ...options, model: openRouterModel });
    record('OpenRouter', openRouterStarted, 'ok', result.model);
    return result;
  } catch (openRouterError) {
    record('OpenRouter', openRouterStarted, 'error', openRouterModel);
    options.signal?.throwIfAborted(); options.onReset?.();
    if (!groqKey) {
      const error = new Error(`${openRouterError.message} Groq fallback is unavailable because no Groq key is configured.`);
      error.status = openRouterError.status;
      throw error;
    }
    const groqStarted = performance.now();
    try {
      const result = await groqClient.complete(groqKey, messages, { ...options, model: options.groqModel || groqModel });
      record('Groq', groqStarted, 'ok', result.model);
      return { ...result, switched: true, reason: 'provider_fallback', fallbackFrom: 'OpenRouter' };
    } catch (groqError) {
      record('Groq', groqStarted, 'error', groqModel);
      const error = new Error(`OpenRouter failed: ${openRouterError.message} Groq fallback failed: ${groqError.message}`);
      error.status = groqError.status || openRouterError.status;
      throw error;
    }
  }
}
