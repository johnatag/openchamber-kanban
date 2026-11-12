import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { loadFeedRoots, feedRootsFilePath, type FeedRootsIo } from '../src/service/feedRootsFile.ts';
import { insideRoots, parseFeedRoots } from '../src/domain/feedRoots.ts';
import { readHarnessFeed } from '../src/service/harness.ts';
import { fetchHarnessLanes } from '../src/host/harnessService.ts';

beforeEach(() => { mock.method(os, 'uptime', () => 3600); });
afterEach(() => { mock.restoreAll(); });

// Synthetic rows only; no real lanes data.
const row = (id: string, patch: Record<string, unknown> = {}) => ({
  v: 1, id, title: 'title-' + id, project: null, kind: 'lane', pid: 2, startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(), outcome: 'done', report: null, log: null, ...patch,
});
const feed = async (rows: unknown[]) => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'kanban-roots-')), 'lanes.jsonl');
  await writeFile(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return file;
};
const ROOTS = ['/a/work', '/extra'];
const rows = () => [
  row('inside', { project: '/a/work' }),
  row('nested', { project: '/a/work/x/y' }),
  row('extra', { project: '/extra/z' }),
  row('outside', { project: '/a/personal/p' }),
  row('prefix-trick', { project: '/a/work-evil' }),
  row('traversal-out', { project: '/a/work/../personal' }),
  row('traversal-in', { project: '/a/personal/../work/q' }),
  row('relative', { project: 'a/work' }),
  row('no-project', { project: null }),
  row('report-outside', { project: '/a/work', report: '/a/personal/report.md', log: '/a/work/log.txt' }),
];
const VISIBLE = ['extra', 'inside', 'nested', 'report-outside', 'traversal-in'];

const assertFiltered = (response: any) => {
  assert.deepEqual(response.lanes.map((l: any) => l.id).sort(), VISIBLE);
  assert.ok(response.filtered, 'response says it filtered');
  assert.deepEqual(response.filtered.roots, ROOTS);
  // 4 dropped: outside, prefix trick, traversal out, no project (the relative project is rejected by the parser).
  assert.equal(response.filtered.dropped, 4);
  const text = JSON.stringify(response);
  for (const hidden of ['title-outside', 'title-prefix-trick', 'title-traversal-out', 'title-no-project']) assert.ok(!text.includes(hidden), hidden);
};

test('filter keeps rows inside the roots and reports a count, never hidden titles', async () => {
  const response = await readHarnessFeed(await feed(rows()), async () => new Map(), ROOTS);
  assertFiltered(response);
  assert.equal(response.rejected, 1);
  assert.equal(response.filtered!.dropped, 4);
});

test('negative control: an unfiltered read fails the same assertions', async () => {
  const response = await readHarnessFeed(await feed(rows()), async () => new Map());
  assert.throws(() => assertFiltered(response));
  assert.ok(response.lanes.some((l: any) => l.id === 'prefix-trick'));
  assert.equal((response as any).filtered, undefined);
});

test('report/log paths outside the roots are removed from an otherwise visible row', async () => {
  const response = await readHarnessFeed(await feed(rows()), async () => new Map(), ROOTS);
  const lane = response.lanes.find((l: any) => l.id === 'report-outside') as any;
  assert.equal(lane.report, null);
  assert.equal(lane.reportFile, null);
  assert.equal(lane.log, '/a/work/log.txt');
  assert.ok(!JSON.stringify(response).includes('/a/personal/report.md'));
});

test('hidden rows do not consume the newest-200 cap', async () => {
  const many = Array.from({ length: 210 }, (_, i) => row('other' + i, { project: '/a/personal', startedAt: new Date(Date.now() + 1000 + i).toISOString() }));
  const response = await readHarnessFeed(await feed([...many, row('mine', { project: '/a/work' })]), async () => new Map(), ROOTS);
  assert.deepEqual(response.lanes.map((l: any) => l.id), ['mine']);
  assert.equal(response.filtered!.dropped, 210);
});

test('missing feed file still reports the filter', async () => {
  const response = await readHarnessFeed(path.join(tmpdir(), 'does-not-exist-' + process.pid + '.jsonl'), async () => new Map(), ROOTS);
  assert.deepEqual(response, { lanes: [], file: 'missing', filtered: { roots: ROOTS, dropped: 0 } });
});

test('unset, blank or null roots leave behaviour unchanged', async () => {
  assert.equal(parseFeedRoots(undefined), null);
  assert.equal(parseFeedRoots(''), null);
  const response = await readHarnessFeed(await feed(rows()), async () => new Map(), parseFeedRoots(''));
  assert.equal(response.lanes.length, 9);
  assert.equal((response as any).filtered, undefined);
});

test('whitespace-only or padded values fail closed, and errors never echo the value', () => {
  for (const bad of [' ', '\n', '/a/secret-name/../x', 'secret-rel', '/ok:/sec ret//x']) {
    try { parseFeedRoots(bad); assert.fail('accepted ' + JSON.stringify(bad)); }
    catch (error) {
      const message = (error as Error).message;
      assert.match(message, /entry \d+ of \d+/);
      for (const frag of ['secret', 'sec ret', '/ok', '/a/']) assert.ok(!message.includes(frag), message);
    }
  }
});

test('malformed roots are rejected', () => {
  for (const bad of ['relative/dir', '/a/work/', '/a/../work', '/a/./work', '/a//work', '/a:', ':/a', '/a::/b', '/a:rel', 'C:\\work', '/a\0b', '.', ' ', '\n', '  /a']) {
    assert.throws(() => parseFeedRoots(bad), /AIDE_FEED_ROOTS/, JSON.stringify(bad));
  }
  assert.deepEqual(parseFeedRoots('/a/work:/extra'), ROOTS);
  assert.deepEqual(parseFeedRoots('/'), ['/']);
});

test('insideRoots matches path components after lexical normalisation', () => {
  assert.equal(insideRoots('/a/work', ['/a/work']), true);
  assert.equal(insideRoots('/a/work/x', ['/a/work']), true);
  assert.equal(insideRoots('/a/work-evil', ['/a/work']), false);
  assert.equal(insideRoots('/a/work/../work-evil', ['/a/work']), false);
  assert.equal(insideRoots('/a/work/../../etc', ['/a/work']), false);
  assert.equal(insideRoots('/../a/work', ['/a/work']), true);
  assert.equal(insideRoots('a/work', ['/a/work']), false);
  assert.equal(insideRoots(null, ['/a/work']), false);
  assert.equal(insideRoots('', ['/a/work']), false);
  assert.equal(insideRoots('/a\\work', ['/a/work']), false);
});

test('client accepts the filtered field and rejects a malformed one', async () => {
  const host = (body: unknown) => ({ serviceRequest: async () => ({ status: 200, body: JSON.stringify(body) }) }) as any;
  const ok = { lanes: [], file: 'ok', rejected: 0, rejectedLines: [], filtered: { roots: ROOTS, dropped: 3 } };
  assert.equal((await fetchHarnessLanes(host(ok))).filtered?.dropped, 3);
  await assert.rejects(fetchHarnessLanes(host({ ...ok, filtered: { roots: ROOTS, dropped: -1 } })), /Invalid/);
  await assert.rejects(fetchHarnessLanes(host({ ...ok, filtered: { roots: [1], dropped: 0 } })), /Invalid/);
  assert.equal((await fetchHarnessLanes(host({ lanes: [], file: 'missing', filtered: { roots: ROOTS, dropped: 0 } }))).filtered?.dropped, 0);
});

test('symlink aliases are not resolved: a row under a root that links elsewhere is shown (documented limitation)', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'kanban-link-'));
  const root = path.join(base, 'work'); const other = path.join(base, 'personal');
  await mkdir(root); await mkdir(other);
  await symlink(other, path.join(root, 'alias'));
  const response = await readHarnessFeed(await feed([row('via-alias', { project: path.join(root, 'alias', 'p') })]), async () => new Map(), [root]);
  assert.deepEqual(response.lanes.map((l: any) => l.id), ['via-alias']);
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /Symlinks are not resolved/);
});

const startService = async (env: Record<string, string>) => {
  const probe = net.createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as net.AddressInfo).port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['--experimental-strip-types', new URL('../src/service/main.ts', import.meta.url).pathname],
    { env: { PATH: process.env.PATH ?? '', OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 't', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr!.on('data', d => { stderr += d; });
  return { port, child, stderr: () => stderr, exited: new Promise<number | null>(r => child.on('exit', r)) };
};
const getLanes = async (port: number) => {
  for (let i = 0; i < 100; i++) {
    try { return await (await fetch('http://127.0.0.1:' + port + '/harness-lanes', { headers: { authorization: 'Bearer t' } })).json() as any; }
    catch { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error('service did not start');
};

test('service entrypoint wires AIDE_FEED_ROOTS from the environment into the route', async () => {
  const file = await feed(rows());
  const filteredRun = await startService({ AIDE_LANES_FILE: file, AIDE_FEED_ROOTS: ROOTS.join(':') });
  const plainRun = await startService({ AIDE_LANES_FILE: file });
  try {
    const filtered = await getLanes(filteredRun.port);
    assert.deepEqual(filtered.lanes.map((l: any) => l.id).sort(), VISIBLE);
    assert.deepEqual(filtered.filtered, { roots: ROOTS, dropped: 4 });
    // Control: without the env var the same entrypoint is unfiltered, so unwired parsing would fail the lines above.
    const plain = await getLanes(plainRun.port);
    assert.equal(plain.filtered, undefined);
    assert.ok(plain.lanes.some((l: any) => l.id === 'outside'));
  } finally { filteredRun.child.kill(); plainRun.child.kill(); }
});

test('service entrypoint exits 1 on a bad AIDE_FEED_ROOTS without echoing it', async () => {
  for (const bad of ['secret-relative', ' ']) {
    const run = await startService({ AIDE_FEED_ROOTS: bad });
    assert.equal(await run.exited, 1);
    assert.match(run.stderr(), /AIDE_FEED_ROOTS entry 1 of 1/);
    assert.ok(!run.stderr().includes('secret'));
  }
});

const xdgWith = async (content: string | null) => {
  const xdg = await mkdtemp(path.join(tmpdir(), 'kanban-xdg-'));
  if (content !== null) { await mkdir(path.join(xdg, 'aide-openchamber')); await writeFile(path.join(xdg, 'aide-openchamber', 'feed-roots'), content); }
  return xdg;
};

test('roots file: comments, blank lines and CRLF are ignored; absent file means no filtering', async () => {
  const xdg = await xdgWith('# profile work\n\n  \n/a/work\r\n/extra\n');
  assert.deepEqual(loadFeedRoots({ XDG_CONFIG_HOME: xdg }), ROOTS);
  assert.equal(loadFeedRoots({ XDG_CONFIG_HOME: await xdgWith(null) }), null);
  assert.equal(feedRootsFilePath({ XDG_CONFIG_HOME: 'relative' }, '/h'), '/h/.config/aide-openchamber/feed-roots');
});

test('roots file: env wins, even when empty, and the file is not read', async () => {
  const xdg = await xdgWith('not-absolute\n');
  assert.deepEqual(loadFeedRoots({ XDG_CONFIG_HOME: xdg, AIDE_FEED_ROOTS: '/env/root' }), ['/env/root']);
  assert.equal(loadFeedRoots({ XDG_CONFIG_HOME: xdg, AIDE_FEED_ROOTS: '' }), null);
  assert.throws(() => loadFeedRoots({ XDG_CONFIG_HOME: xdg }), /line 1/);
});

test('roots file: malformed line, rootless, oversize, symlink, directory and unreadable fail closed without echoing text', async () => {
  const fails = async (content: string, re: RegExp) => {
    const xdg = await xdgWith(content);
    try { loadFeedRoots({ XDG_CONFIG_HOME: xdg }); assert.fail('accepted'); }
    catch (error) { const m = (error as Error).message; assert.match(m, re); assert.ok(!m.includes('secret'), m); }
  };
  await fails('/a/work\n\n# c\nsecret-rel\n', /line 4 is not absolute/);
  await fails('/a/secret/../x\n', /line 1 is not normalised/);
  await fails('# only\n\n', /no roots/);
  await fails('/a/' + 'x'.repeat(64 * 1024) + '\n', /larger than 64 KiB/);
  // symlink to a perfectly valid file is refused
  const xdg = await xdgWith(null);
  await mkdir(path.join(xdg, 'aide-openchamber'));
  await writeFile(path.join(xdg, 'real'), '/a/work\n');
  await symlink(path.join(xdg, 'real'), path.join(xdg, 'aide-openchamber', 'feed-roots'));
  assert.throws(() => loadFeedRoots({ XDG_CONFIG_HOME: xdg }), /not a regular file/);
  // directory
  const dirXdg = await xdgWith(null);
  await mkdir(path.join(dirXdg, 'aide-openchamber', 'feed-roots'), { recursive: true });
  assert.throws(() => loadFeedRoots({ XDG_CONFIG_HOME: dirXdg }), /not a regular file/);
  // unreadable
  if (process.getuid?.() !== 0) {
    const un = await xdgWith('/a/work\n');
    await chmod(path.join(un, 'aide-openchamber', 'feed-roots'), 0);
    assert.throws(() => loadFeedRoots({ XDG_CONFIG_HOME: un }), /could not be read \(EACCES\)/);
  }
});

test('service entrypoint reads the roots file when the env var is absent (host env allow-list case)', async () => {
  const file = await feed(rows());
  const xdg = await xdgWith('# work profile\n/a/work\n/extra\n');
  const run = await startService({ AIDE_LANES_FILE: file, XDG_CONFIG_HOME: xdg });
  const bad = await startService({ XDG_CONFIG_HOME: await xdgWith('secret-rel\n') });
  try {
    const body = await getLanes(run.port);
    assert.deepEqual(body.lanes.map((l: any) => l.id).sort(), VISIBLE);
    assert.deepEqual(body.filtered, { roots: ROOTS, dropped: 4 });
    assert.equal(await bad.exited, 1);
    assert.match(bad.stderr(), /line 1 is not absolute/);
    assert.ok(!bad.stderr().includes('secret'));
  } finally { run.child.kill(); }
});

// A fake descriptor lets a test grow or rewrite the file between fstat and read.
const fakeIo = (first: string, opts: { second?: string; grewTo?: string; mtime2?: number } = {}): FeedRootsIo => {
  let content = Buffer.from(first); let pos = 0; let fstats = 0;
  const stat = (size: number, mtimeMs: number) => ({ isFile: () => true, size, mtimeMs, mode: 0o100600 });
  return {
    lstat: () => stat(0, 0), open: () => 7, close: () => {},
    fstat: () => {
      fstats += 1;
      if (fstats === 2 && opts.mtime2 !== undefined) return stat(content.length, opts.mtime2);
      return stat(content.length, 1);
    },
    read: (_fd, buffer, offset, length) => {
      if (opts.grewTo !== undefined && pos === 0) content = Buffer.from(opts.grewTo); // writer extends after the first fstat
      const n = Math.min(length, content.length - pos);
      content.copy(buffer, offset, pos, pos + n); pos += n; return n;
    },
  };
};
const env = { XDG_CONFIG_HOME: '/x' };

test('roots file: a file that grows between fstat and read is rejected, not parsed as a prefix', () => {
  assert.deepEqual(loadFeedRoots(env, '/h', fakeIo('/a/work\n')), ['/a/work']);
  assert.throws(() => loadFeedRoots(env, '/h', fakeIo('/', { grewTo: '/\n/a/personal\n' })), /changed while/);
  assert.throws(() => loadFeedRoots(env, '/h', fakeIo('/a/work\n', { mtime2: 2 })), /changed while/);
  // a short read that ends before the stated size is also a mismatch
  const short = fakeIo('/a/work\n'); const realRead = short.read;
  short.read = (fd, b, o, l) => realRead(fd, b, o, Math.min(l, 3)) && 0;
  assert.throws(() => loadFeedRoots(env, '/h', short), /changed while/);
});

test('roots file: reads in a loop over short reads and caps growth at 64 KiB + 1', () => {
  const chunky = fakeIo('/a/work\n'); const rr = chunky.read;
  chunky.read = (fd, b, o, l) => rr(fd, b, o, Math.min(l, 2));
  assert.deepEqual(loadFeedRoots(env, '/h', chunky), ['/a/work']);
  assert.throws(() => loadFeedRoots(env, '/h', fakeIo('/a\n', { grewTo: '/a/' + 'x'.repeat(70000) })), /larger than 64 KiB/);
});

test('roots file: a bare "/" is too broad in the file but still allowed from the env', async () => {
  assert.throws(() => loadFeedRoots(env, '/h', fakeIo('# all\n/\n')), /line 2 root too broad/);
  const xdg = await xdgWith('/a/work\n/\n');
  assert.throws(() => loadFeedRoots({ XDG_CONFIG_HOME: xdg }), /line 2 root too broad/);
  assert.deepEqual(loadFeedRoots({ AIDE_FEED_ROOTS: '/' }), ['/']);
});

test('roots file: group- or other-writable files are refused without echoing content', async () => {
  for (const mode of [0o620, 0o602, 0o666]) {
    const xdg = await xdgWith('/a/secret-root\n');
    await chmod(path.join(xdg, 'aide-openchamber', 'feed-roots'), mode);
    try { loadFeedRoots({ XDG_CONFIG_HOME: xdg }); assert.fail('accepted ' + mode.toString(8)); }
    catch (error) { assert.match((error as Error).message, /writable by group or other/); assert.ok(!(error as Error).message.includes('secret')); }
  }
  const ok = await xdgWith('/a/work\n');
  await chmod(path.join(ok, 'aide-openchamber', 'feed-roots'), 0o644);
  assert.deepEqual(loadFeedRoots({ XDG_CONFIG_HOME: ok }), ['/a/work']);
});
