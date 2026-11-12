import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

// Epoch seconds, matching ps's one-second precision. Kept at the OS boundary so
// a /proc-based reader can replace ps without changing Harness status rules.
export type ProcessStartTimeReader = (pids: readonly number[]) => Promise<ReadonlyMap<number, number>>;

export const parseProcessStartTimes = (output: string): Map<number, number> => {
  const starts = new Map<number, number>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/.exec(line);
    if (!match || match[2]!.startsWith('Z')) continue;
    const pid = Number(match[1]);
    const date = new Date(match[3]!);
    // Round-trip to reject dates that Date.parse normalizes (e.g. February 30).
    const normalized = date.toString().split(' ').slice(0, 5).join(' ');
    const fields = match[3]!.trim().split(/\s+/);
    const expected = [fields[0], fields[1], fields[2]!.padStart(2, '0'), fields[4], fields[3]].join(' ');
    if (Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647 &&
        Number.isFinite(date.getTime()) && normalized === expected) starts.set(pid, date.getTime() / 1000);
  }
  return starts;
};

const exec = promisify(execFile);
const platformPidMax = async (): Promise<number | null> => {
  if (process.platform === 'darwin') return 99999;
  if (process.platform === 'linux') {
    try {
      const value = (await readFile('/proc/sys/kernel/pid_max', 'utf8')).trim();
      const maximum = Number(value);
      if (/^\d+$/.test(value) && Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 2147483647) return maximum;
    } catch { /* Unknown limit: isolate each PID instead of risking the batch. */ }
  }
  return null;
};

export const processStartTimes: { read: ProcessStartTimeReader } = {
  read: async pids => {
    if (!pids.length) return new Map();
    const maximum = await platformPidMax();
    const eligible = [...new Set(pids)].filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid <= (maximum ?? 2147483647));
    if (!eligible.length) return new Map();
    const executable = existsSync('/bin/ps') ? '/bin/ps' : 'ps';
    const query = async (requested: number[]) => {
      try {
        const { stdout } = await exec(executable, ['-o', 'pid=', '-o', 'stat=', '-o', 'lstart=', '-p', requested.join(',')],
          { env: { ...process.env, LC_ALL: 'C' }, timeout: 2000, maxBuffer: 128 * 1024 });
        return { starts: parseProcessStartTimes(stdout), retry: false, stop: false };
      } catch (error) {
        const failure = error as { code?: unknown; stdout?: string; killed?: boolean; signal?: string | null };
        // Exit 1 (including empty output when all PIDs died) is normal.
        const retry = failure.code === 1 && !failure.killed && !failure.signal;
        if (!retry) console.error('Could not read process start times; harness liveness is unknown', error);
        return { starts: parseProcessStartTimes(failure.stdout ?? ''), retry, stop: !retry };
      }
    };
    const starts = new Map<number, number>();
    if (maximum !== null) {
      const batch = await query(eligible);
      if (!batch.retry || eligible.length === 1) return batch.starts;
      for (const [pid, start] of batch.starts) starts.set(pid, start);
    }
    // A rejected PID must never discard evidence for its neighbours.
    for (const pid of eligible) {
      const result = await query([pid]);
      for (const [found, start] of result.starts) starts.set(found, start);
      if (result.stop) break;
    }
    return starts;
  },
};
