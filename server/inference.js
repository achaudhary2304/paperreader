export async function completeWithFallback({ compatibleClient, compatibleKey, compatibleConfigured, openRouterClient, groqClient, openRouterKey, groqKey, messages, options = {}, groqModel }) {
  const record = (provider, started, outcome, model) => {
    try { options.onTiming?.({ stage: options.timingStage || 'Inference', provider, model, ms: Math.round(performance.now() - started), outcome }); } catch { /* metrics must not interrupt inference */ }
  };
  if (compatibleConfigured) {
    const started = performance.now();
    try { const result = await compatibleClient.complete(compatibleKey, messages, options); record(result.provider || 'Custom API', started, 'ok', result.model); return result; }
    catch (error) { record('Custom API', started, 'error', options.model); throw error; }
  }
  if (!openRouterKey) {
    const started = performance.now();
    try { const result = await groqClient.complete(groqKey, messages, options); record('Groq', started, 'ok', result.model); return result; }
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
    if (!groqKey) {
      const error = new Error(`${openRouterError.message} Groq fallback is unavailable because no Groq key is configured.`);
      error.status = openRouterError.status;
      throw error;
    }
    const groqStarted = performance.now();
    try {
      const result = await groqClient.complete(groqKey, messages, { ...options, model: groqModel });
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
