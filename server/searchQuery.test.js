import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSearchPlan, searchTerms } from './searchQuery.js';
import { createResearchAgents } from './researchAgents.js';

const question = 'What should I know about this topic beyond the passage?';

test('the default Search question researches the selected method rather than conversational words', () => {
  const plan = fallbackSearchPlan(question, '“Integrated Gradients”');
  assert.equal(plan.externalQuery, 'integrated gradients');
  assert.deepEqual(searchTerms(question), []);
  assert(plan.paperQueries.includes('“Integrated Gradients”'));
});

test('deictic questions retain the selected topic and explicit named questions retain their own topic', () => {
  assert.equal(
    fallbackSearchPlan('What are its limitations?', 'Integrated Gradients').externalQuery,
    'integrated gradients limitations',
  );
  assert.equal(
    fallbackSearchPlan('How does DeepLIFT compare to Integrated Gradients?', '').externalQuery,
    'deeplift compare integrated gradients',
  );
  assert.equal(
    fallbackSearchPlan('Explain', '', [{ role: 'user', content: 'Integrated Gradients' }])
      .externalQuery,
    'integrated gradients',
  );
});

test('generic selected-passage questions avoid an unnecessary planner call on every provider configuration', async () => {
  for (const freeOnly of [true, false]) {
    let calls = 0;
    const agents = createResearchAgents({
      infer: async () => {
        calls++;
        throw new Error('Unexpected inference');
      },
      freeOnly: () => freeOnly,
      compatibleConfigured: () => false,
      clean: (s, max) => String(s).slice(0, max),
    });
    const plan = await agents.planSearch('test', question, 'Integrated Gradients', '', []);
    assert.equal(plan.externalQuery, 'integrated gradients');
    assert.equal(calls, 0);
  }
});

test('boilerplate queries returned by a planner are replaced with a topic-based fallback', async () => {
  const agents = createResearchAgents({
    infer: async () =>
      JSON.stringify({ paperQueries: ['Integrated Gradients'], externalQuery: question }),
    freeOnly: () => false,
    compatibleConfigured: () => false,
    clean: (s, max) => String(s).slice(0, max),
  });
  const plan = await agents.planSearch(
    'test',
    'What are its limitations?',
    'Integrated Gradients',
    '',
    [],
  );
  assert.equal(plan.externalQuery, 'integrated gradients limitations');
});
