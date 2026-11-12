import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseProcessStartTimes, processStartTimes } from '../src/service/processStartTimes.ts';
import { readHarnessFeed } from '../src/service/harness.ts';

test('ps rows parse C-locale dates to epoch seconds in local time; unreadable or malformed rows are ignored', () => {
  assert.deepEqual(parseProcessStartTimes([
    '   101 S Wed Nov 11 12:34:56 2026',
    '102 S Thu Jan  1 00:00:00 2026',
    '103 -', '104 unknown', '105 S Wed Nov 11 25:00:00 2026',
    '106 S Mon Feb 30 12:00:00 2026', '107 S Wed Nov 11 12:34:56 2026 garbage',
    '0 S Wed Nov 11 12:34:56 2026', '2147483648 S Wed Nov 11 12:34:56 2026',
    '108 S Mer Nov 11 12:34:56 2026',
  ].join('\n')), new Map([
    [101, new Date(2026, 10, 11, 12, 34, 56).getTime() / 1000],
    [102, new Date(2026, 0, 1).getTime() / 1000],
  ]));
});

test('real live child is identified, or lost when this machine denies process inspection', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const spawned = once(child, 'spawn');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-live-child-'));
  try {
    await spawned;
    assert.ok(child.pid);
    const starts = await processStartTimes.read([child.pid]);
    const startedAt = new Date().toISOString();
    if (starts.has(child.pid)) {
      assert.ok(Math.abs(starts.get(child.pid)! - Date.parse(startedAt) / 1000) < 5);
    } else {
      const error = errors.mock.calls[0]?.arguments[1] as NodeJS.ErrnoException | undefined;
      assert.equal(error?.code, 'EPERM', 'a readable ps response must identify the live child');
      t.diagnostic('OS denied ps: verified fail-closed behavior with a live child; positive real-process identification remains unverified here.');
    }
    // Keep the real process reader and PID probe; isolate only the unrelated
    // uptime boundary, which this sandbox also denies.
    t.mock.method(os, 'uptime', () => 3600);
    const file = path.join(dir, 'feed.jsonl');
    await writeFile(file, JSON.stringify({ v: 1, id: 'child', title: 'Child', project: null, kind: 'lane',
      pid: child.pid, commandPid: child.pid, startedAt, report: null, log: null }));
    const response = await readHarnessFeed(file);
    assert.equal(response.lanes[0]?.status, starts.has(child.pid) ? 'running' : 'lost');
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});

test('ps state excludes zombies while retaining living process start times', () => {
  const output = [
    '41 S Wed Nov 11 12:34:56 2026',
    '42 Z Wed Nov 11 12:34:56 2026',
    '43 Z+ Wed Nov 11 12:34:56 2026',
    '44 Ss+ Wed Nov 11 12:34:56 2026',
  ].join('\n');
  const start = new Date(2026, 10, 11, 12, 34, 56).getTime() / 1000;
  assert.deepEqual(parseProcessStartTimes(output), new Map([[41, start], [44, start]]));
});
