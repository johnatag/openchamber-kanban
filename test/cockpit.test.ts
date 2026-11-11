import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCockpitReader } from '../src/service/cockpit.ts';
import { createServiceServer } from '../src/service/server.ts';
import { filterCockpitTasks, linkedCockpitTasks, slimCockpitTasks } from '../src/domain/cockpit.ts';

const task = (overrides: Record<string, unknown> = {}) => ({ key: 'COC-385', title: 'Work', status: 'in_progress', priority: 'high', assignees: [{ email: 'me@example.com', name: 'Me', secret: 'hidden' }], parentTaskKey: null, prUrl: 'https://github.com/team/repo/pull/1', updatedAt: '2026-11-11T12:00:00Z', estimateHours: 3, spentHours: 1, context: 'PRIVATE TEXT', description: 'PRIVATE TEXT', devPlan: 'PRIVATE TEXT', chatHistory: 'PRIVATE TEXT', ...overrides });
// Real node:http request/response streams, delivered in process: no listening socket
// is permitted by the execution sandbox. Only the external HTTP transport is replaced.
const serverFetch = (server: http.Server): typeof fetch => async (input, init = {}) => new Promise<Response>((resolve, reject) => {
  const request = new http.IncomingMessage(new Socket());
  request.method = init.method ?? 'GET'; request.url = new URL(String(input)).pathname + new URL(String(input)).search;
  request.headers = Object.fromEntries(new Headers(init.headers));
  if (init.body) request.headers['content-length'] = String(Buffer.byteLength(String(init.body)));
  const response = new http.ServerResponse(request);
  let resolved = false; let cancelled = false;
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: c => { streamController = c; }, cancel: () => { cancelled = true; } });
  const headers = () => { if (!resolved) { resolved = true; resolve(new Response(stream, { status: response.statusCode, headers: response.getHeaders() as Record<string, string> })); } };
  response.write = ((body: string) => { headers(); if (!cancelled) streamController.enqueue(Buffer.from(body)); return true; }) as typeof response.write;
  response.end = ((body?: string) => { headers(); if (!cancelled) { if (body) streamController.enqueue(Buffer.from(body)); streamController.close(); } return response; }) as typeof response.end;
  init.signal?.addEventListener('abort', () => { if (!resolved) reject(new Error('aborted')); else if (!cancelled) streamController.error(new Error('aborted')); }, { once: true });
  server.emit('request', request, response);
  if (init.body) request.push(Buffer.from(String(init.body)));
  request.push(null);
});
const close = async (server: http.Server) => { server.close(); };

const fixture = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cockpit-'));
  const file = path.join(dir, 'key'); const secret = 'fake-api-secret'; await writeFile(file, secret);
  const before = process.env.COCKPIT_API_KEY_FILE; process.env.COCKPIT_API_KEY_FILE = file;
  const calls: Record<string, any>[] = []; const headers: http.IncomingHttpHeaders[] = [];
  let mode = 'ok'; let lists = 0; const deletes: http.IncomingHttpHeaders[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { deletes.push(req.headers); res.writeHead(405); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push(body); headers.push(req.headers);
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    if (mode === '401') { res.writeHead(401); res.end(secret); return; }
    if (mode === 'redirect') { res.writeHead(302, { location: 'http://example.invalid/' }); res.end(); return; }
    if (mode === 'timeout') return;
    if (mode === 'stream-timeout') { res.setHeader('content-type', 'text/event-stream'); res.write(': waiting\n\n'); return; }
    res.setHeader('content-type', mode === 'sse' ? 'text/event-stream' : 'application/json');
    if (mode === 'non-json') { res.setHeader('content-type', 'text/html'); res.end(secret); return; }
    if (mode === 'bad-json') { res.end('{'); return; }
    if (mode === 'huge') { res.end('x'.repeat(2048)); return; }
    if (mode === 'rpc-error') { res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: secret, code: -1 } })); return; }
    if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    let result: unknown;
    if (body.method === 'initialize') { if (mode !== 'stateless') res.setHeader('Mcp-Session-Id', 'test-session'); result = { protocolVersion: mode === 'bad-version' ? 'invalid' : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }; }
    else { lists++; result = mode === 'tool-error' ? { isError: true, content: [{ type: 'text', text: secret }] } : { content: [{ type: 'text', text: JSON.stringify({ tasks: mode === 'bad-task' ? [task({ status: 'garbage' })] : [task(mode === 'reflected-key' ? { title: secret } : {}), task({ key: 'COC-99', cancelledAt: '2026-11-11' }), { cancelledAt: 'yesterday', assignees: null }] }) }] }; }
    if (mode === 'structured' && body.method === 'tools/call') result = { structuredContent: { tasks: [task()] } };
    const response = JSON.stringify({ jsonrpc: '2.0', id: mode === 'bad-id' ? 999 : body.id, result });
    if (mode === 'sse') { res.write(': heartbeat\r\n\r\nevent: message\r\ndata: ' + response + '\r\n\r\n'); /* Deliberately keep stream open. */ }
    else res.end(response);
  });
  const transport = serverFetch(server);
  const localFetch: typeof fetch = (input, init) => { assert.equal(String(input), 'https://cockpit.internal.angelsoftwares.ca/api/mcp/server'); return transport("http://fake-mcp/api", init); };
  return { file, secret, calls, headers, deletes, fetch: localFetch, get lists() { return lists; }, setMode: (value: string) => { mode = value; }, cleanup: async () => { await close(server); await rm(dir, { recursive: true, force: true }); if (before === undefined) delete process.env.COCKPIT_API_KEY_FILE; else process.env.COCKPIT_API_KEY_FILE = before; } };
};

test('MCP handshake, slimming, cancellation, single-flight, exact cache boundary and key rotation', async () => {
  const f = await fixture(); let now = 0;
  try {
    const read = createCockpitReader({ fetch: f.fetch, now: () => now });
    const results = await Promise.all([read(), read(), read()]);
    assert.deepEqual(results[0], { status: 'ok', cancelledTasks: [{ status: 'in_progress', assignees: [{ email: 'me@example.com' }], parentTaskKey: null }], tasks: [{ key: 'COC-385', title: 'Work', status: 'in_progress', priority: 'high', assignees: [{ email: 'me@example.com', name: 'Me' }], parentTaskKey: null, prUrl: 'https://github.com/team/repo/pull/1', updatedAt: '2026-11-11T12:00:00Z', estimateHours: 3, spentHours: 1 }] });
    assert.equal(f.lists, 1); assert.deepEqual(f.calls.map(c => c.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.deepEqual(f.calls[2]?.params, { name: 'list_tasks' });
    assert.equal(f.headers[1]?.['mcp-session-id'], 'test-session'); assert.equal(f.headers[2]?.['mcp-session-id'], 'test-session');
    const output = JSON.stringify(results); assert.ok(!output.includes('PRIVATE TEXT')); assert.ok(!output.includes(f.secret)); assert.ok(!output.includes('hidden'));
    now = 59_999; await read(); assert.equal(f.lists, 1);
    now = 60_000; await read(); assert.equal(f.lists, 2);
    now = 120_000; f.setMode('401'); assert.equal((await read()).status, 'unavailable');
    f.setMode('ok'); assert.equal((await read()).status, 'ok'); assert.equal(f.lists, 3);
    now = 180_000; await writeFile(f.file, ''); assert.equal((await read()).status, 'unavailable');
    await rm(f.file); assert.equal((await read()).status, 'unavailable');
  } finally { await f.cleanup(); }
});

test('JSON and open SSE streams both complete the handshake and tools call', async () => {
  const f = await fixture();
  try { for (const mode of ['sse', 'stateless', 'structured']) { f.setMode(mode); assert.equal((await createCockpitReader({ fetch: f.fetch })()).status, 'ok', mode); } } finally { await f.cleanup(); }
});

test('all failures are unavailable, contain a safe reason, and never log or echo secrets', async (t) => {
  const f = await fixture(); const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  t.mock.method(console, 'log', (...args: unknown[]) => { logs.push(args); });
  try {
    for (const mode of ['401', 'redirect', 'timeout', 'stream-timeout', 'bad-version', 'reflected-key', 'non-json', 'bad-json', 'huge', 'rpc-error', 'bad-id', 'tool-error', 'bad-task']) {
      f.setMode(mode); const response = await createCockpitReader({ fetch: f.fetch, timeoutMs: 100, maxBytes: mode === 'huge' ? 1024 : undefined })();
      assert.equal(response.status, 'unavailable', mode); assert.ok('reason' in response && response.reason.length > 0, mode); assert.ok(!('tasks' in response)); assert.ok(!JSON.stringify(response).includes(f.secret));
    }
    const network = await createCockpitReader({ fetch: async () => { throw new Error(f.secret); } })();
    assert.equal(network.status, 'unavailable'); assert.ok(!JSON.stringify(network).includes(f.secret));
    assert.ok(!JSON.stringify(logs).includes(f.secret));
  } finally { await f.cleanup(); }
});

test('HTTP API cannot select tools, origin, credential path or send writes', async () => {
  const f = await fixture(); const server = createServiceServer('local-token', '/missing', createCockpitReader({ fetch: f.fetch })); const localFetch = serverFetch(server); const origin = 'http://local-service';
  try {
    assert.equal((await localFetch(origin + '/cockpit-tasks')).status, 401);
    for (const suffix of ['?tool=delete_task', '?key=COC-1', '?url=http://evil', '?file=/tmp/key']) assert.equal((await localFetch(origin + '/cockpit-tasks' + suffix, { headers: { authorization: 'Bearer local-token' } })).status, 400);
    assert.equal((await localFetch(origin + '/cockpit-tasks', { method: 'POST', body: '{}', headers: { authorization: 'Bearer local-token' } })).status, 400);
    assert.equal(f.calls.length, 0);
    const result = await (await localFetch(origin + '/cockpit-tasks', { headers: { authorization: 'Bearer local-token' } })).json(); assert.equal(result.status, 'ok');
    assert.equal('cancelledTasks' in result, false);
    assert.equal(result.cancelledHidden, 0);
    const mine = await (await localFetch(origin + '/cockpit-tasks?email=me%40example.com&mode=mine&subtasks=false', { headers: { authorization: 'Bearer local-token' } })).json();
    assert.equal(mine.cancelledHidden, 1);
    assert.deepEqual(Object.keys(mine).sort(), ['cancelledHidden', 'status', 'tasks']);
    assert.deepEqual(f.calls.filter(c => c.method === 'tools/call').map(c => c.params.name), ['list_tasks']);
  } finally { await close(server); await f.cleanup(); }
});

test('mine/all-in-progress and subtasks preserve Cockpit order, with exact whole-key linking', () => {
  const tasks = slimCockpitTasks([task(), task({ key: 'COC-3', status: 'todo' }), task({ key: 'COC-385.2', parentTaskKey: 'COC-385' }), task({ key: 'COC-38', assignees: [] }), task({ key: 'COC-4', status: 'done' }), task({ key: 'COC-5', cancelledAt: 'yesterday' })]);
  assert.deepEqual(filterCockpitTasks(tasks, ' ME@EXAMPLE.COM ', 'mine', false).map(t => t.key), ['COC-385', 'COC-3']);
  assert.deepEqual(filterCockpitTasks(tasks, '', 'mine', true), []);
  assert.deepEqual(filterCockpitTasks(tasks, 'me@example.com', 'all_in_progress', true).map(t => t.key), ['COC-385', 'COC-385.2', 'COC-38']);
  assert.deepEqual(linkedCockpitTasks(tasks, 'Work COC-385.2', 'feat/COC-38').map(t => t.key), ['COC-385.2', 'COC-38']);
  assert.deepEqual(linkedCockpitTasks(tasks, 'feature-COC-385').map(t => t.key), ['COC-385']);
  assert.deepEqual(linkedCockpitTasks(tasks, 'XCOC-385 COC-3850 COC-385.20 COC-385.2x'), []);
});


test('key linking accepts case-insensitive branch keys with dot and underscore suffixes without prefix collisions', () => {
  const tasks = slimCockpitTasks([task({ key: 'COC-12' }), task({ key: 'COC-123' }), task({ key: 'COC-12.2' })]);
  assert.deepEqual(linkedCockpitTasks(tasks, null, 'feat/coc-12_fix').map(t => t.key), ['COC-12']);
  assert.deepEqual(linkedCockpitTasks(tasks, null, 'feat/COC-12.fix').map(t => t.key), ['COC-12']);
  assert.deepEqual(linkedCockpitTasks(tasks, null, 'feat/coc-12.2_fix').map(t => t.key), ['COC-12.2']);
  assert.deepEqual(linkedCockpitTasks(tasks, null, 'feat/coc-123_fix').map(t => t.key), ['COC-123']);
  assert.deepEqual(linkedCockpitTasks(tasks, 'XCOC-12 COC-12x COC-12.20'), []);
});

test('MCP sessions close after successful and failed refreshes, but never on cache hits or stateless responses', async () => {
  const f = await fixture(); let now = 0;
  try {
    const read = createCockpitReader({ fetch: f.fetch, now: () => now });
    assert.equal((await read()).status, 'ok');
    assert.equal(f.deletes.length, 1);
    assert.equal(f.deletes[0]?.['mcp-session-id'], 'test-session');
    assert.equal(f.deletes[0]?.['mcp-protocol-version'], '2025-03-26');
    await read(); assert.equal(f.deletes.length, 1);
    now = 60000; f.setMode('tool-error'); assert.equal((await read()).status, 'unavailable');
    assert.equal(f.deletes.length, 2);
    f.setMode('stateless'); await read(); assert.equal(f.deletes.length, 2);
  } finally { await f.cleanup(); }
});


test('key titles keep exact case and branches require a non-alphanumeric left boundary', () => {
  const tasks = slimCockpitTasks([task({ key: 'COC-12' }), task({ key: 'COC-123' }), task({ key: 'COC-12.2' }), task({ key: 'FIX-1' })]);
  for (const [title, expected] of [['_COC-12', ['COC-12']], ['COC-12.', ['COC-12']], ['fix-1 typo', []], ['xCOC-12', []], ['COC-12.20 COC-1234', []]] as const)
    assert.deepEqual(linkedCockpitTasks(tasks, title).map(t => t.key), expected);
  assert.deepEqual(linkedCockpitTasks(tasks, '', 'agent/coc-12_fix').map(t => t.key), ['COC-12']);
  assert.deepEqual(linkedCockpitTasks(tasks, '', 'xcoc-12'), []);
});

test('hanging MCP DELETE never holds a read or subsequent refresh open', async () => {
  const f = await fixture(); let now = 0; let signal: AbortSignal | undefined;
  try {
    const read = createCockpitReader({ now: () => now, fetch: async (input, init) => {
      if (init?.method !== 'DELETE') return f.fetch(input, init);
      signal = init.signal!;
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
    const timeout = new Promise<string>(resolve => { const timer = setTimeout(() => resolve('blocked'), 100); timer.unref(); });
    const first = await Promise.race([read(), timeout]);
    assert.notEqual(first, 'blocked'); assert.equal((first as any).status, 'ok');
    now = 60000; assert.equal((await Promise.race([read(), timeout]) as any).status, 'ok');
    assert.ok(signal); assert.equal(signal.aborted, false);
  } finally { await f.cleanup(); }
});


test('service logs never contain Cockpit request URLs or filter emails, including failures', async (t) => {
  const logs: unknown[][] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  const f = await fixture();
  const email = 'private-person@example.com';
  const url = 'http://local-service/cockpit-tasks?email=' + encodeURIComponent(email) + '&mode=mine&subtasks=false';
  const readers = [createCockpitReader({ fetch: f.fetch }), createCockpitReader({ fetch: async () => { throw new Error(url); } })];
  try {
    for (const reader of readers) {
      const server = createServiceServer('local-token', '/missing', reader); const request = serverFetch(server);
      try {
        assert.equal((await request(url)).status, 401);
        assert.equal((await request(url + '&extra=bad', { headers: { authorization: 'Bearer local-token' } })).status, 400);
        const response = await request(url, { headers: { authorization: 'Bearer local-token' } });
        assert.equal(response.status, 200); await response.json();
      } finally { await close(server); }
    }
    const output = JSON.stringify(logs, (_key, value) => value instanceof Error ? value.message : value);
    for (const secret of [email, encodeURIComponent(email), url, '/cockpit-tasks']) assert.equal(output.includes(secret), false);
  } finally { await f.cleanup(); }
});
