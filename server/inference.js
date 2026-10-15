export async function completeWithFallback({ compatibleClient, compatibleKey, compatibleConfigured, openRouterClient, groqClient, openRouterKey, groqKey, messages, options = {}, groqModel }) {
  if (compatibleConfigured) return compatibleClient.complete(compatibleKey, messages, options);
  if (!openRouterKey) return groqClient.complete(groqKey, messages, options);

  const openRouterModel = options.model?.endsWith(':free') || options.model === 'openrouter/free' ? options.model : 'openrouter/free';
  try {
    return await openRouterClient.complete(openRouterKey, messages, { ...options, model: openRouterModel });
  } catch (openRouterError) {
    if (!groqKey) {
      const error = new Error(`${openRouterError.message} Groq fallback is unavailable because no Groq key is configured.`);
      error.status = openRouterError.status;
      throw error;
    }
    try {
      const result = await groqClient.complete(groqKey, messages, { ...options, model: groqModel });
      return { ...result, switched: true, reason: 'provider_fallback', fallbackFrom: 'OpenRouter' };
    } catch (groqError) {
      const error = new Error(`OpenRouter failed: ${openRouterError.message} Groq fallback failed: ${groqError.message}`);
      error.status = groqError.status || openRouterError.status;
      throw error;
    }
  }
}
