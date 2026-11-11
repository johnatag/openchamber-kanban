import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHarnessLanes } from '../src/host/harnessService.ts';

test('harness host uses only the fixed route and distinguishes missing feed from failure', async () => {
  const result = await fetchHarnessLanes({ serviceRequest: async request => {
    assert.deepEqual(request, { method: 'GET', path: '/harness-lanes' });
    return { status: 200, body: JSON.stringify({ lanes: [], file: 'missing' }) };
  } });
  assert.equal(result.file, 'missing');
  await assert.rejects(() => fetchHarnessLanes({ serviceRequest: async () => ({ status: 500, body: '{}' }) }));
  await assert.rejects(() => fetchHarnessLanes({ serviceRequest: async () => ({ status: 200, body: '{"lanes":[{}],"file":"ok"}' }) }));
});
