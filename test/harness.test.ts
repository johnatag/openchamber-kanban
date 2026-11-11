import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHarnessFeed, harnessStatus, newestHarnessLanes } from '../src/domain/harness.ts';
const lane = { v: 1, id: 'a', title: 'Work', project: '/tmp/project', kind: 'lane', pid: 123, startedAt: '2026-11-11T10:00:00-05:00', report: null, log: null };
test('feed accepts offsets and last valid record for an id wins; invalid records are counted with line numbers', () => {
  const invalid = [ '{', JSON.stringify({ ...lane, pid: 0 }), JSON.stringify({ ...lane, startedAt: '2026-11-11T10:00:00' }), JSON.stringify({ ...lane, project: 'relative' }) ];
  const result = parseHarnessFeed([JSON.stringify(lane), ...invalid, JSON.stringify({ ...lane, title: 'Updated', endedAt: '2026-11-11T16:00:00Z', outcome: 'done' })].join('\n'));
  assert.equal(result.lanes.length, 1);
  assert.equal(result.lanes[0]?.title, 'Updated');
  assert.equal(result.rejected, 4);
  assert.deepEqual(result.rejectedLines, [2, 3, 4, 5]);
});
test('every required field is required; malformed optional fields and impossible dates are rejected', () => {
  for (const key of Object.keys(lane)) {
    const record: Record<string, unknown> = { ...lane }; delete record[key];
    assert.equal(parseHarnessFeed(JSON.stringify(record)).rejected, 1, key);
  }
  for (const patch of [{ endedAt: null }, { outcome: 'unknown' }, { log: 'relative' }, { pid: 1.5 }, { kind: ['lane'] }, { startedAt: '2026-02-30T10:00:00Z' }]) {
    assert.equal(parseHarnessFeed(JSON.stringify({ ...lane, ...patch })).rejected, 1);
  }
});
test('status distinguishes alive, dead, report, ended and failed without claiming done', () => {
  const record = parseHarnessFeed(JSON.stringify(lane)).lanes[0]!;
  assert.equal(harnessStatus(record, true, false), 'running');
  assert.equal(harnessStatus(record, false, false), 'lost');
  assert.equal(harnessStatus(record, false, true), 'review');
  assert.equal(harnessStatus(record, true, true), 'running');
  assert.equal(harnessStatus({ ...record, endedAt: '2026-11-11T16:00:00Z' }, true, false), 'review');
  assert.equal(harnessStatus({ ...record, outcome: 'failed' }, true, true), 'failed');
});
test('newest cap uses actual timestamps across offsets and returns at most 200', () => {
  const records = Array.from({ length: 202 }, (_, i) => ({ ...lane, id: String(i), startedAt: new Date(i * 1000).toISOString() }));
  const result = newestHarnessLanes(parseHarnessFeed(records.map(r => JSON.stringify(r)).join('\n')).lanes);
  assert.equal(result.length, 200);
  assert.equal(result[0]?.id, '201'); assert.equal(result.at(-1)?.id, '2');
});

test('sorting compares instants rather than timezone strings', () => {
  const records = [
    { ...lane, id: 'earlier', startedAt: '2026-11-11T11:00:00+02:00' },
    { ...lane, id: 'later', startedAt: '2026-11-11T10:00:00Z' },
  ];
  assert.deepEqual(newestHarnessLanes(parseHarnessFeed(records.map(r => JSON.stringify(r)).join('\n')).lanes).map(r => r.id), ['later', 'earlier']);
});
