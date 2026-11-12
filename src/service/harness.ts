import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import os from 'node:os';
import { harnessStatus, newestHarnessLanes, parseHarnessFeed, type FileMetadata } from '../domain/harness.ts';

import { processStartTimes, type ProcessStartTimeReader } from './processStartTimes.ts';

const FEED_BYTES = 4 * 1024 * 1024;
const BOOT_TOLERANCE_MS = 1000;

const metadata = async (file: string | null): Promise<FileMetadata | null> => {
  if (file === null) return null;
  try {
    const info = await stat(file);
    return { path: file, exists: info.isFile(), mtime: info.mtimeMs, size: info.size };
  } catch (error) {
    return { path: file, exists: false, mtime: null,
      ...((error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { error: 'unknown' as const }) };
  }
};
const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

export const readHarnessFeed = async (file: string, readStartTimes: ProcessStartTimeReader = processStartTimes.read) => {
  let input: string;
  let truncated = false;
  let cutFirstLine = false;
  try {
    // Check before opening: a FIFO must never wait for a writer. Nonblocking
    // open and a second stat also protect against replacement after this check.
    if (!(await stat(file)).isFile()) return { lanes: [], file: 'not-regular' };
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { lanes: [], file: 'not-regular' };
      truncated = info.size > FEED_BYTES;
      const buffer = Buffer.alloc(Math.min(info.size, FEED_BYTES));
      const offset = Math.max(0, info.size - FEED_BYTES);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, offset + used);
        if (!bytesRead) break;
        used += bytesRead;
      }
      // Reserve the first byte of a capped window as boundary context. This
      // keeps all reads within 4 MiB and avoids rejecting a complete first line.
      cutFirstLine = truncated && buffer[0] !== 10;
      input = buffer.subarray(truncated ? 1 : 0, used).toString('utf8');
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lanes: [], file: 'missing' };
    throw error;
  }
  const parsed = parseHarnessFeed(input, cutFirstLine);
  const now = Date.now();
  let bootTime = Infinity;
  try { bootTime = now - os.uptime() * 1000; }
  catch (error) { console.error('Could not determine boot time; harness liveness is unknown', error); }
  const newest = newestHarnessLanes(parsed.lanes);
  const starts = await readStartTimes([...new Set(newest.flatMap(lane =>
    lane.commandPid == null ? [lane.pid] : [lane.pid, lane.commandPid]))]);
  const lanes = await Promise.all(newest.map(async lane => {
    const [reportFile, logFile] = await Promise.all([metadata(lane.report), metadata(lane.log)]);
    const started = Date.parse(lane.startedAt);
    const matchesProcess = (pid: number, earliest: number, latest: number) => {
      const processStarted = starts.get(pid);
      return processStarted !== undefined && Number.isFinite(processStarted) &&
        processStarted >= earliest && processStarted <= latest && isAlive(pid);
    };
    const future = started > now + 300_000;
    const alive = !future && started >= bootTime - BOOT_TOLERANCE_MS &&
      (matchesProcess(lane.pid, -Infinity, started / 1000 + 2) ||
       (lane.commandPid != null && matchesProcess(lane.commandPid, started / 1000 - 2, started / 1000 + 60)));
    return { ...lane, status: future ? 'lost' as const : harnessStatus(lane, alive), reportFile, logFile };
  }));
  return { lanes, file: 'ok', rejected: parsed.rejected, rejectedLines: parsed.rejectedLines, truncated };
};
