import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { readHarnessFeed } from '../src/service/harness.ts';
import { parseHarnessFeed } from '../src/domain/harness.ts';

const now = Date.now();
const lane = { v: 1, id: 'lane', title: 'Work', project: null, kind: 'lane', pid: process.pid,
  startedAt: new Date(now - 120_000).toISOString(), report: null, log: null };

test('a reused supervisor PID cannot keep a lost lane running', async t => {
  t.mock.method(process, 'kill', () => true);
  t.mock.method(os, 'uptime', () => 3600);
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-identity-'));
  try {
    const file = path.join(dir, 'feed.jsonl');
    await writeFile(file, JSON.stringify(lane));
    // Inject the OS boundary: this PID belongs to a process started after the run.
    const response = await readHarnessFeed(file, async () => new Map([[process.pid, now / 1000]]));
    assert.equal(response.lanes[0]?.status, 'lost');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('newest run wins over late records from older runs; last line wins within that run', () => {
  const newer = { ...lane, startedAt: new Date(now).toISOString(), title: 'New run' };
  const oldEnd = { ...lane, outcome: 'done', endedAt: new Date(now).toISOString() };
  const result = parseHarnessFeed([lane, newer, { ...newer, title: 'Latest line' }, oldEnd, lane]
    .map(value => JSON.stringify(value)).join('\n'));
  assert.equal(result.lanes[0]?.title, 'Latest line');
  assert.equal(result.lanes[0]?.endedAt, undefined);
  assert.equal(result.lanes[0]?.outcome, undefined);
});

const start = now / 1000 - 120;
for (const [name, supervisor, command, expected] of [
  ['supervisor at +2 seconds', start + 2, undefined, 'running'],
  ['supervisor beyond +2 seconds', start + 2.001, undefined, 'lost'],
  ['older supervisor', start - 1000, undefined, 'running'],
  ['command at -2 seconds', undefined, start - 2, 'running'],
  ['command before -2 seconds', undefined, start - 2.001, 'lost'],
  ['command at +60 seconds', undefined, start + 60, 'running'],
  ['command beyond +60 seconds', undefined, start + 60.001, 'lost'],
  ['unreadable starts', undefined, undefined, 'lost'],
  ['invalid starts', NaN, Infinity, 'lost'],
  ['reused supervisor with matching command', start + 3, start, 'running'],
  ['matching supervisor with reused command', start, start + 61, 'running'],
] as const) {
  test(`process identity: ${name}`, async t => {
    t.mock.method(os, 'uptime', () => 3600);
    t.mock.method(Date, 'now', () => now);
    t.mock.method(process, 'kill', () => true);
    const dir = await mkdtemp(path.join(tmpdir(), 'kanban-identity-rule-'));
    try {
      const file = path.join(dir, 'feed.jsonl');
      await writeFile(file, JSON.stringify({ ...lane, commandPid: 12345 }));
      const response = await readHarnessFeed(file, async pids => {
        assert.deepEqual(pids, [process.pid, 12345]);
        const starts = new Map<number, number>();
        if (supervisor !== undefined) starts.set(process.pid, supervisor);
        if (command !== undefined) starts.set(12345, command);
        return starts;
      });
      assert.equal(response.lanes[0]?.status, expected);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('future tolerance includes five minutes but untrusted future records are lost even with an outcome', async t => {
  t.mock.method(os, 'uptime', () => 3600);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(process, 'kill', () => true);
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-future-'));
  try {
    const file = path.join(dir, 'feed.jsonl');
    await writeFile(file, [
      { ...lane, id: 'boundary', startedAt: new Date(now + 300_000).toISOString() },
      ...[undefined, 'done', 'failed'].map((outcome, index) => ({ ...lane, id: String(index),
        startedAt: new Date(now + 300_001).toISOString(),
        ...(outcome ? { outcome, endedAt: new Date(now + 300_002).toISOString() } : {}) })),
    ].map(value => JSON.stringify(value)).join('\n'));
    const response = await readHarnessFeed(file, async () => new Map([[process.pid, now / 1000]]));
    assert.equal(response.lanes.find(record => record.id === 'boundary')?.status, 'running');
    assert.ok(response.lanes.filter(record => record.id !== 'boundary').every(record => record.status === 'lost'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('equivalent startedAt offsets identify the same run and last line wins', () => {
  const records = [
    { ...lane, startedAt: '2026-11-11T10:00:00Z' },
    { ...lane, startedAt: '2026-11-11T05:00:00-05:00', title: 'Last', outcome: 'done', endedAt: '2026-11-11T11:00:00Z' },
  ];
  const parsed = parseHarnessFeed(records.map(value => JSON.stringify(value)).join('\n'));
  assert.equal(parsed.lanes[0]?.title, 'Last');
  assert.equal(parsed.lanes[0]?.outcome, 'done');
});

test('one refresh reads all distinct supervisor and command PIDs in a single batch', async t => {
  t.mock.method(os, 'uptime', () => 3600);
  t.mock.method(process, 'kill', () => true);
  const dir = await mkdtemp(path.join(tmpdir(), 'kanban-batch-'));
  try {
    const file = path.join(dir, 'feed.jsonl');
    await writeFile(file, [
      { ...lane, id: 'one', pid: 101, commandPid: 102 },
      { ...lane, id: 'two', pid: 102, commandPid: 103 },
    ].map(value => JSON.stringify(value)).join('\n'));
    let reads = 0;
    const response = await readHarnessFeed(file, async pids => {
      reads++;
      assert.deepEqual(pids, [101, 102, 103]);
      return new Map(pids.map(pid => [pid, start]));
    });
    assert.equal(reads, 1);
    assert.deepEqual(response.lanes.map(record => record.status), ['running', 'running']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
