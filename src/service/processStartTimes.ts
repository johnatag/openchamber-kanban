import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Epoch seconds, matching ps's one-second precision. Kept at the OS boundary so
// a /proc-based reader can replace ps without changing Harness status rules.
export type ProcessStartTimeReader = (pids: readonly number[]) => Promise<ReadonlyMap<number, number>>;

export const parseProcessStartTimes = (output: string): Map<number, number> => {
  const starts = new Map<number, number>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const date = new Date(match[2]!);
    // Round-trip to reject dates that Date.parse normalizes (e.g. February 30).
    const normalized = date.toString().split(' ').slice(0, 5).join(' ');
    const fields = match[2]!.trim().split(/\s+/);
    const expected = [fields[0], fields[1], fields[2]!.padStart(2, '0'), fields[4], fields[3]].join(' ');
    if (Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647 &&
        Number.isFinite(date.getTime()) && normalized === expected) starts.set(pid, date.getTime() / 1000);
  }
  return starts;
};

const exec = promisify(execFile);
export const processStartTimes: { read: ProcessStartTimeReader } = {
  read: async pids => {
    if (!pids.length) return new Map();
    try {
      const { stdout } = await exec('ps', ['-o', 'pid=', '-o', 'lstart=', '-p', [...new Set(pids)].join(',')],
        { env: { ...process.env, LC_ALL: 'C' }, timeout: 2000, maxBuffer: 128 * 1024 });
      return parseProcessStartTimes(stdout);
    } catch (error) {
      // ps can return 1 when requested PIDs have vanished; retain any readable rows.
      const failure = error as { code?: unknown; stdout?: string };
      if (failure.code === 1 && failure.stdout) return parseProcessStartTimes(failure.stdout);
      console.error('Could not read process start times; harness liveness is unknown', error);
      return new Map();
    }
  },
};
