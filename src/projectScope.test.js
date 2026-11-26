import test from 'node:test';
import assert from 'node:assert/strict';
import { questionProjectId } from './projectScope.js';

test('project questions can be enabled or disabled after a thread starts', () => {
  assert.equal(questionProjectId(null, true, 'project-a'), 'project-a');
  assert.equal(questionProjectId(null, false, 'project-a'), '');
  assert.equal(questionProjectId({ projectId: 'project-a' }, false, 'project-b'), 'project-a');
  assert.equal(
    questionProjectId({ projectId: '' }, true, 'project-b'),
    '',
    'a document-only thread must not inherit a stale checkbox from another chat',
  );
  const enabledThread = { projectId: 'project-b' };
  assert.equal(questionProjectId(enabledThread, true, 'project-b'), 'project-b');
  assert.equal(questionProjectId({ ...enabledThread, projectId: '' }, false, 'project-b'), '');
});
