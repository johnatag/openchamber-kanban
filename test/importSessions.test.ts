import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSessionsToImport } from '../src/domain/autoTask.ts';

const base = { id: 'old', title: 'Work', parentId: null, archivedAt: null, activity: 'running' as const, outcome: null, createdAt: 1 };
test('import selects active top-level sessions regardless of age, excluding linked and dismissed ids', () => {
  const sessions = [base, { ...base, id: 'review', activity: 'waiting-question' as const },
    { ...base, id: 'child', parentId: 'old' }, { ...base, id: 'archived', archivedAt: 2 },
    { ...base, id: 'linked' }, { ...base, id: 'dismissed' }, { ...base, id: 'idle', activity: 'idle' as const }];
  const selected = selectSessionsToImport(sessions, new Set(['linked', 'dismissed']));
  assert.deepEqual(selected.map(({ session, status }) => [session.id, status]), [['old', 'in_progress'], ['review', 'review']]);
});
test('import is idempotent with existing claims and duplicate snapshots', () => {
  const selected = selectSessionsToImport([base, base], new Set());
  assert.equal(selected.length, 1);
  assert.deepEqual(selectSessionsToImport([base], new Set(selected.map(({ session }) => session.id))), []);
});

test('import only takes running, retrying and waiting sessions, regardless of previous outcome', () => {
  const sessions = [
    { ...base, id: 'completed', activity: 'idle' as const, outcome: 'completed' as const },
    { ...base, id: 'failed', activity: 'idle' as const, outcome: 'failed' as const },
    { ...base, id: 'idle', activity: 'idle' as const },
    { ...base, id: 'permission', activity: 'waiting-permission' as const },
    { ...base, id: 'retry', activity: 'retrying' as const, outcome: 'failed' as const },
  ];
  assert.deepEqual(selectSessionsToImport(sessions, new Set()).map(({ session, status }) => [session.id, status]),
    [['permission', 'review'], ['retry', 'in_progress']]);
});
