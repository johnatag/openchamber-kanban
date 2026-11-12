import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
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
  assert.equal(parseFeedRoots('  '), null);
  const response = await readHarnessFeed(await feed(rows()), async () => new Map(), parseFeedRoots(''));
  assert.equal(response.lanes.length, 9);
  assert.equal((response as any).filtered, undefined);
});

test('malformed roots are rejected', () => {
  for (const bad of ['relative/dir', '/a/work/', '/a/../work', '/a/./work', '/a//work', '/a:', ':/a', '/a::/b', '/a:rel', 'C:\\work', '/a\0b', '.']) {
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
