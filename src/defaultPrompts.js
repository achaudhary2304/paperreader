export const DEFAULT_PROMPTS = {
  explain: 'What does this passage mean?',
  concept: 'Which concepts do I need to understand this?',
  math: 'Can you walk through the reasoning or equation here?',
  literature: 'Which related papers help explain this?',
  search: 'What should I know about this topic beyond the passage?',
};

export function getDefaultPrompt(mode, overrides = {}) {
  const value = overrides?.[mode];
  if (typeof value === 'string') {
    return value;
  } else {
    return DEFAULT_PROMPTS[mode];
  }
}
