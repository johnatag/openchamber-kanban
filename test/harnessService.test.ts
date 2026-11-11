import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createServiceServer } from '../src/service/server.ts';

test('service uses its fixed feed, returns metadata only, handles missing and rejects file overrides', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-feed-'));
  const file = path.join(dir, 'lanes.jsonl');
  const report = path.join(dir, 'report.md');
  const server = createServiceServer('test-token', file);
  try {
    const get = (route: string, authorized = true, method = 'GET', headers: Record<string, string> = {}): Promise<{ status: number; json: () => Promise<any> }> =>
      new Promise(resolve => {
        const request = new IncomingMessage(new Socket());
        request.method = method; request.url = route;
        request.headers = { ...(authorized ? { authorization: 'Bearer test-token' } : {}), ...headers };
        const response = new ServerResponse(request);
        response.end = ((body: string) => {
          resolve({ status: response.statusCode, json: async () => JSON.parse(body) });
          return response;
        }) as typeof response.end;
        server.emit('request', request, response);
      });
    assert.throws(() => createServiceServer('test-token', 'relative.jsonl'), /absolute/);
    assert.equal((await get('/harness-lanes', false)).status, 401);
    assert.equal((await get('/harness-lanes', true, 'POST')).status, 400);
    assert.equal((await get('/harness-lanes', true, 'GET', { 'content-length': '30' })).status, 400);
    assert.deepEqual(await (await get('/harness-lanes')).json(), { lanes: [], file: 'missing' });
    await writeFile(report, 'SECRET report content');
    const base = { v: 1, id: 'live', title: 'Work', project: null, kind: 'lane', pid: process.pid, startedAt: '2026-11-11T10:00:00Z', report, log: null };
    await writeFile(file, JSON.stringify(base) + '\nmalformed\n');
    const response = await get('/harness-lanes');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.lanes[0].status, 'running');
    assert.deepEqual(body.lanes[0].reportFile.path, report);
    assert.equal(body.lanes[0].reportFile.exists, true);
    assert.equal(typeof body.lanes[0].reportFile.mtime, 'number');
    assert.equal(JSON.stringify(body).includes('SECRET'), false);
    assert.equal(body.rejected, 1); assert.deepEqual(body.rejectedLines, [2]);
    for (const query of ['file', 'path', 'directory', 'AIDE_LANES_FILE']) {
      assert.equal((await get('/harness-lanes?' + query + '=/etc/passwd')).status, 400);
    }
    await writeFile(file, JSON.stringify({ ...base, endedAt: '2026-11-11T11:00:00Z' }));
    assert.equal((await (await get('/harness-lanes')).json()).lanes[0].status, 'review');
    await rm(file);
    await writeFile(file, Array.from({length: 201}, (_, i) => JSON.stringify({ ...base, id: String(i), report: null })).join('\n'));
    assert.equal((await (await get('/harness-lanes')).json()).lanes.length, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
