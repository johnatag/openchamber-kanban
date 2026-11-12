import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Replace only the OS command boundary before the reader captures execFile.
let run: (file: string, args: string[]) => string = () => '';
const originalExecFile = childProcess.execFile;
childProcess.execFile = ((file: string, args: string[], _options: unknown, callback: Function) => {
  try { callback(null, run(file, args), ''); }
  catch (error) { callback(error, (error as { stdout?: string }).stdout ?? '', ''); }
}) as typeof childProcess.execFile;
Object.defineProperty(childProcess.execFile, promisify.custom, {
  value: async (file: string, args: string[]) => ({ stdout: run(file, args), stderr: '' }),
});
syncBuiltinESMExports();
const { processStartTimes } = await import('../src/service/processStartTimes.ts');
const { readHarnessFeed } = await import('../src/service/harness.ts');
childProcess.execFile = originalExecFile;
syncBuiltinESMExports();

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const stamp = new Date(2026, 10, 11, 12, 34, 56);
const row = (pid: number) => `${pid} S Wed Nov 11 12:34:56 2026\n`;
const failure = (code: number | string, stdout = '') => Object.assign(new Error('ps failed'), { code, stdout });
let calls: string[][];
beforeEach(() => {
  calls = [];
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  mock.method(fs, 'existsSync', () => true);
  syncBuiltinESMExports();
  run = (_file, args) => { calls.push(args); return ''; };
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  mock.restoreAll();
  syncBuiltinESMExports();
});

test('macOS stray PID 100000 cannot make a genuine lane lost; 99999 stays eligible', async t => {
  t.mock.method(os, 'uptime', () => 3600);
  t.mock.method(Date, 'now', () => stamp.getTime());
  t.mock.method(process, 'kill', () => true);
  t.mock.method(console, 'error', () => {});
  run = (_file, args) => {
    calls.push(args);
    if (args.at(-1)!.split(',').some(pid => Number(pid) > 99999)) throw failure(1);
    return args.at(-1)!.split(',').map(pid => row(Number(pid))).join('');
  };
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'kanban-pid-limit-'));
  try {
    const file = path.join(dir, 'feed.jsonl');
    await fsPromises.writeFile(file, [42, 99999, 100000].map(pid => JSON.stringify({
      v: 1, id: String(pid), title: 'Lane', project: null, kind: 'lane', pid,
      startedAt: stamp.toISOString(), report: null, log: null,
    })).join('\n'));
    const response = await readHarnessFeed(file);
    assert.deepEqual(response.lanes.map(lane => lane.status), ['running', 'running', 'lost']);
    assert.ok(calls.every(args => !args.at(-1)!.split(',').includes('100000')));
  } finally { await fsPromises.rm(dir, { recursive: true, force: true }); }
});

test('batch failure retries individual PIDs and retains readable rows', async t => {
  t.mock.method(console, 'error', () => {});
  run = (_file, args) => {
    calls.push(args);
    if (args.at(-1)!.includes(',')) throw failure(1, row(41));
    if (args.at(-1) === '42') return row(42);
    throw failure(1);
  };
  assert.deepEqual(await processStartTimes.read([41, 42, 43]), new Map([
    [41, stamp.getTime() / 1000], [42, stamp.getTime() / 1000],
  ]));
});

test('all dead PIDs returning exit 1 and empty stdout produce no log', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  run = () => { throw failure(1); };
  assert.deepEqual(await processStartTimes.read([41, 42]), new Map());
  assert.equal(errors.mock.callCount(), 0);
});

test('ps uses /bin/ps, falling back to PATH only when absent', async t => {
  const executables: string[] = [];
  run = (file) => { executables.push(file); return row(42); };
  await processStartTimes.read([42]);
  t.mock.method(fs, 'existsSync', () => false);
  syncBuiltinESMExports();
  await processStartTimes.read([42]);
  assert.deepEqual(executables, ['/bin/ps', 'ps']);
});

test('Linux reads pid_max before batching, including the maximum and excluding larger PIDs', async t => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  t.mock.method(fsPromises, 'readFile', async () => '200000\n');
  syncBuiltinESMExports();
  run = (_file, args) => {
    calls.push(args);
    return args.at(-1)!.split(',').map(pid => row(Number(pid))).join('');
  };
  assert.deepEqual(await processStartTimes.read([42, 200000, 200001]), new Map([
    [42, stamp.getTime() / 1000], [200000, stamp.getTime() / 1000],
  ]));
  assert.deepEqual(calls.map(args => args.at(-1)), ['42,200000']);
});

for (const limit of [null, 'bad', '0', '2147483648']) {
  test(`unavailable Linux PID limit (${limit}) uses isolated queries`, async t => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    t.mock.method(fsPromises, 'readFile', async () => {
      if (limit === null) throw new Error('unreadable');
      return limit;
    });
    syncBuiltinESMExports();
    run = (_file, args) => { calls.push(args); return row(42); };
    await processStartTimes.read([42, 43]);
    assert.deepEqual(calls.map(args => args.at(-1)), ['42', '43']);
  });
}

test('unknown platforms query per PID so a bad PID cannot poison another', async t => {
  Object.defineProperty(process, 'platform', { value: 'freebsd' });
  t.mock.method(console, 'error', () => {});
  run = (_file, args) => {
    calls.push(args);
    if (args.at(-1) !== '42') throw failure(1);
    return row(42);
  };
  assert.deepEqual(await processStartTimes.read([42, 100000]), new Map([[42, stamp.getTime() / 1000]]));
  assert.deepEqual(calls.map(args => args.at(-1)), ['42', '100000']);
});

test('inspection permission errors still surface and return no evidence', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  run = () => { throw failure('EPERM'); };
  assert.deepEqual(await processStartTimes.read([42]), new Map());
  assert.equal(errors.mock.callCount(), 1);
});

for (const [name, properties] of [
  ['missing executable', { code: 'ENOENT' }],
  ['inaccessible executable', { code: 'EACCES' }],
  ['timeout', { code: null, killed: true, signal: 'SIGTERM' }],
  ['signal despite exit code 1', { code: 1, signal: 'SIGTERM' }],
  ['killed despite exit code 1', { code: 1, killed: true }],
  ['output overflow', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }],
  ['other exit status', { code: 2 }],
] as const) {
  test(`${name} retains batch rows, stops querying and logs once per poll`, async t => {
    const errors = t.mock.method(console, 'error', () => {});
    run = (_file, args) => {
      calls.push(args);
      throw Object.assign(new Error(name), properties, { stdout: row(41) });
    };
    for (let poll = 1; poll <= 2; poll++) {
      assert.deepEqual(await processStartTimes.read([41, 42, 43]), new Map([[41, stamp.getTime() / 1000]]));
      assert.equal(calls.length, poll);
      assert.equal(errors.mock.callCount(), poll);
    }
  });
}

test('unknown PID limit stops isolated queries after an infrastructure failure', async t => {
  Object.defineProperty(process, 'platform', { value: 'freebsd' });
  const errors = t.mock.method(console, 'error', () => {});
  run = (_file, args) => {
    calls.push(args);
    if (args.at(-1) === '41') return row(41);
    throw failure('ENOENT');
  };
  assert.deepEqual(await processStartTimes.read([41, 42, 43]), new Map([[41, stamp.getTime() / 1000]]));
  assert.equal(calls.length, 2);
  assert.equal(errors.mock.callCount(), 1);
});

for (const platform of ['darwin', 'freebsd']) {
  test(`${platform} exit 1 with stderr retains rows, stops querying and logs once per poll`, async t => {
    Object.defineProperty(process, 'platform', { value: platform });
    const errors = t.mock.method(console, 'error', () => {});
    // Even whitespace is non-empty stderr, rather than a missing-PID result.
    for (const stderr of ['ps: keyword not found: bogus\n', ' ']) {
      calls = [];
      errors.mock.resetCalls();
      run = (_file, args) => {
        calls.push(args);
        if (args.at(-1) === '41') return row(41);
        throw Object.assign(failure(1, row(42)), { stderr });
      };
      for (let poll = 1; poll <= 2; poll++) {
        const expected = platform === 'darwin' ? [42] : [41, 42];
        assert.deepEqual(await processStartTimes.read([41, 42, 43]),
          new Map(expected.map(pid => [pid, stamp.getTime() / 1000])));
        assert.equal(calls.length, poll * (platform === 'darwin' ? 1 : 2));
        assert.equal(errors.mock.callCount(), poll);
      }
    }
  });
}
