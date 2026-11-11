import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir, chmod } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readHarnessFeed } from '../src/service/harness.ts';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createServiceServer } from '../src/service/server.ts';

// Treat uptime as an external OS boundary; the sandbox may prohibit reading it.
beforeEach(() => { mock.method(os, 'uptime', () => 3600); });
afterEach(() => { mock.restoreAll(); });

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
    const base = { v: 1, id: 'live', title: 'Work', project: null, kind: 'lane', pid: process.pid, startedAt: new Date().toISOString(), report, log: null };
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


const feedLane = (patch: Record<string, unknown> = {}) => ({
  v: 1, id: 'lane', title: 'Work', project: null, kind: 'lane', pid: process.pid,
  startedAt: new Date().toISOString(), report: null, log: null, ...patch,
});

test('a successful PID probe cannot keep a pre-boot lane running, including PID 1', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-old-pid-'));
  const file = path.join(dir, 'lanes.jsonl');
  const report = path.join(dir, 'report.md');
  const kill = mock.method(process, 'kill', () => true);
  try {
    await writeFile(report, 'Review evidence');
    await writeFile(file, [
      feedLane({ id: 'current' }),
      feedLane({ id: 'old', startedAt: '2000-01-01T00:00:00Z' }),
      feedLane({ id: 'old-pid-one', pid: 1, startedAt: '2000-01-01T00:00:00Z' }),
      feedLane({ id: 'old-with-report', startedAt: '2000-01-01T00:00:00Z', report }),
    ].map(record => JSON.stringify(record)).join('\n'));
    const response = await readHarnessFeed(file);
    assert.deepEqual(Object.fromEntries(response.lanes.map(lane => [lane.id, lane.status])), {
      current: 'running', old: 'lost', 'old-pid-one': 'lost', 'old-with-report': 'review',
    });
  } finally { kill.mock.restore(); await rm(dir, { recursive: true, force: true }); }
});

test('EPERM is no liveness evidence and falls back to report evidence or lost', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-foreign-pid-'));
  const file = path.join(dir, 'lanes.jsonl');
  const report = path.join(dir, 'report.md');
  const kill = mock.method(process, 'kill', () => { throw Object.assign(new Error('foreign PID'), { code: 'EPERM' }); });
  try {
    await writeFile(report, 'Review evidence');
    await writeFile(file, [feedLane(), feedLane({ id: 'report', report })].map(record => JSON.stringify(record)).join('\n'));
    const response = await readHarnessFeed(file);
    assert.deepEqual(response.lanes.map(lane => lane.status), ['lost', 'review']);
  } finally { kill.mock.restore(); await rm(dir, { recursive: true, force: true }); }
});

test('a zero-byte report is metadata but never review evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-empty-report-'));
  const file = path.join(dir, 'lanes.jsonl');
  const report = path.join(dir, 'empty.md');
  const kill = mock.method(process, 'kill', () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
  try {
    await writeFile(report, '');
    await writeFile(file, JSON.stringify(feedLane({ report })));
    const response = await readHarnessFeed(file);
    assert.equal(response.lanes[0]?.status, 'lost');
    assert.equal(response.lanes[0]?.reportFile?.size, 0);
  } finally { kill.mock.restore(); await rm(dir, { recursive: true, force: true }); }
});

test('per-lane stat failures provide no evidence without breaking other lanes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-report-stat-'));
  const file = path.join(dir, 'lanes.jsonl');
  const empty = path.join(dir, 'empty.md');
  const loop = path.join(dir, 'loop');
  const locked = path.join(dir, 'locked');
  const kill = mock.method(process, 'kill', () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
  try {
    await writeFile(empty, '');
    await symlink(loop, loop);
    await mkdir(locked);
    await writeFile(path.join(locked, 'report.md'), 'unreadable evidence');
    await chmod(locked, 0);
    await writeFile(file, [
      feedLane({ id: 'empty', report: empty }),
      feedLane({ id: 'loop', report: loop, log: loop }),
      feedLane({ id: 'not-directory', report: path.join(empty, 'child') }),
      feedLane({ id: 'denied', report: path.join(locked, 'report.md') }),
      feedLane({ id: 'unaffected' }),
    ].map(record => JSON.stringify(record)).join('\n'));
    const response = await readHarnessFeed(file);
    assert.equal(response.lanes.length, 5);
    assert.ok(response.lanes.every(lane => lane.status === 'lost'));
    assert.equal(response.lanes.find(lane => lane.id === 'empty')?.reportFile?.size, 0);
    for (const id of ['loop', 'not-directory', 'denied']) {
      const metadata = response.lanes.find(lane => lane.id === id)?.reportFile;
      assert.equal(metadata?.exists, false, id);
      assert.equal(metadata?.mtime, null, id);
      assert.equal(metadata?.error, 'unknown', id);
    }
  } finally {
    kill.mock.restore(); await chmod(locked, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('the final 4 MiB are read and a cut first line is rejected even if its suffix is valid JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-tail-'));
  const file = path.join(dir, 'lanes.jsonl');
  try {
    const cut = JSON.stringify(feedLane({ id: 'cut' })) + '\n';
    const last = feedLane({ id: 'last' });
    const emptyLast = JSON.stringify(last) + '\n';
    last.title += 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(cut + emptyLast));
    const tail = cut + JSON.stringify(last) + '\n';
    assert.equal(Buffer.byteLength(tail), 4 * 1024 * 1024);
    await writeFile(file, 'discarded-prefix' + tail);
    const response = await readHarnessFeed(file);
    assert.equal(response.truncated, true);
    assert.deepEqual(response.lanes.map(lane => lane.id), ['last']);
    assert.equal(response.rejected, 1);
    assert.deepEqual(response.rejectedLines, [1]);
    await writeFile(file, JSON.stringify(feedLane()));
    assert.equal((await readHarnessFeed(file)).truncated, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('directories and devices are refused as feed files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-special-'));
  try {
    assert.deepEqual(await readHarnessFeed(dir), { lanes: [], file: 'not-regular' });
    assert.deepEqual(await readHarnessFeed('/dev/null'), { lanes: [], file: 'not-regular' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('a FIFO is refused without a blocking read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-fifo-'));
  try {
    const fifo = path.join(dir, 'feed.fifo');
    await promisify(execFile)('mkfifo', [fifo]);
    // Isolate the blocking FIFO regression so the unfixed reader cannot hang the test runner.
    const script = `import { readHarnessFeed } from ${JSON.stringify(new URL('../src/service/harness.ts', import.meta.url).href)}; console.log(JSON.stringify(await readHarnessFeed(${JSON.stringify(fifo)})));`;
    const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { timeout: 2_000 });
    assert.deepEqual(JSON.parse(result.stdout), { lanes: [], file: 'not-regular' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('unavailable boot time gives no liveness evidence and logs once for the feed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-uptime-error-'));
  const file = path.join(dir, 'lanes.jsonl');
  const report = path.join(dir, 'report.md');
  mock.method(os, 'uptime', () => { throw Object.assign(new Error('uptime denied'), { code: 'EPERM' }); });
  mock.method(process, 'kill', () => true);
  const logged = mock.method(console, 'error', () => {});
  try {
    await writeFile(report, 'Review evidence');
    await writeFile(file, [feedLane(), feedLane({ id: 'report', report })].map(record => JSON.stringify(record)).join('\n'));
    const response = await readHarnessFeed(file);
    assert.deepEqual(response.lanes.map(lane => lane.status), ['lost', 'review']);
    assert.equal(logged.mock.callCount(), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a complete record following the boundary newline in a capped window is retained', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-tail-boundary-'));
  const file = path.join(dir, 'lanes.jsonl');
  try {
    const record = feedLane({ id: 'complete' });
    const initial = JSON.stringify(record) + '\n';
    record.title += 'x'.repeat(4 * 1024 * 1024 - 1 - Buffer.byteLength(initial));
    await writeFile(file, 'discarded-prefix\n' + JSON.stringify(record) + '\n');
    const response = await readHarnessFeed(file);
    assert.equal(response.truncated, true);
    assert.deepEqual(response.lanes.map(lane => lane.id), ['complete']);
    assert.equal(response.rejected, 0);
    assert.deepEqual(response.rejectedLines, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('boot-time tolerance includes exactly one second and rejects the preceding millisecond', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-boot-boundary-'));
  const file = path.join(dir, 'lanes.jsonl');
  const now = Date.parse('2026-11-11T12:00:00Z');
  mock.method(Date, 'now', () => now);
  mock.method(process, 'kill', () => true);
  try {
    const boot = now - 3600 * 1000;
    await writeFile(file, [
      feedLane({ id: 'tolerance', startedAt: new Date(boot - 1000).toISOString() }),
      feedLane({ id: 'too-old', startedAt: new Date(boot - 1001).toISOString() }),
    ].map(record => JSON.stringify(record)).join('\n'));
    const response = await readHarnessFeed(file);
    assert.deepEqual(response.lanes.map(lane => lane.status), ['running', 'lost']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
