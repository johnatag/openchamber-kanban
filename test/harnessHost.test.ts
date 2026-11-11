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

test('harness response accepts bounded rejection details, truncation and nonregular refusal', async () => {
  const fetchBody = (body: unknown) => fetchHarnessLanes({ serviceRequest: async () => ({ status: 200, body: JSON.stringify(body) }) });
  const body = { lanes: [], file: 'ok', rejected: 80, rejectedLines: Array.from({ length: 50 }, (_, i) => i + 1), truncated: true };
  assert.equal((await fetchBody(body)).truncated, true);
  assert.equal((await fetchBody({ lanes: [], file: 'not-regular' })).file, 'not-regular');
  await assert.rejects(() => fetchBody({ ...body, rejectedLines: Array.from({ length: 51 }, (_, i) => i + 1) }));
  await assert.rejects(() => fetchBody({ ...body, truncated: 'yes' }));
});
