import type { JsonValue } from '@openchamber/sdk';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCockpitTasks } from '../src/host/cockpitService.ts';
import { DEFAULT_PREFS, loadPrefs, savePrefs, parsePrefs } from '../src/store/prefs.ts';

test('Cockpit host uses only the fixed route and preserves unavailable reasons', async () => {
  const result = await fetchCockpitTasks({ serviceRequest: async request => {
    assert.deepEqual(request, { method: 'GET', path: '/cockpit-tasks' });
    return { status: 200, body: JSON.stringify({ status: 'unavailable', reason: 'Cockpit authentication failed' }) };
  } });
  assert.deepEqual(result, { status: 'unavailable', reason: 'Cockpit authentication failed' });
  for (const response of [{ status: 500, body: '{}' }, { status: 200, body: 'not JSON' }, { status: 200, body: '{"status":"ok"}' }, { status: 200, body: '{"status":"ok","tasks":[{}]}' }, { status: 200, body: JSON.stringify({ status: 'ok', tasks: [], cancelledTasks: [{ status: 'invalid', assignees: [] }] }) }]) {
    assert.equal((await fetchCockpitTasks({ serviceRequest: async () => response })).status, 'unavailable');
  }
  assert.equal((await fetchCockpitTasks({ serviceRequest: async () => { throw new Error('offline'); } })).status, 'unavailable');
});

test('Cockpit preferences round trip and malformed/legacy values use safe defaults', async () => {
  let saved: JsonValue | undefined;
  const host = { storage: { get: async () => saved, set: async (_key: string, value: JsonValue) => { saved = value; }, keys: async () => [], delete: async () => {} } };
  const prefs = { ...DEFAULT_PREFS, cockpitEmail: 'me@example.com', cockpitMode: 'all_in_progress' as const, cockpitSubtasks: true };
  await savePrefs(host, prefs); assert.deepEqual(await loadPrefs(host), prefs);
  assert.deepEqual(parsePrefs({ cockpitEmail: 3, cockpitMode: 'delete', cockpitSubtasks: 'true' }), DEFAULT_PREFS);
  assert.equal(parsePrefs({ cockpitEmail: '  ME@EXAMPLE.COM  ' }).cockpitEmail, 'me@example.com');
});
