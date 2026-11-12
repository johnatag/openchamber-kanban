export type HarnessLane = {
  v: 1; id: string; title: string; project: string | null;
  kind: 'lane' | 'review' | 'gate'; pid: number; startedAt: string;
  report: string | null; log: string | null;
  branch?: string | null;
  commandPid?: number | null;
  endedAt?: string; outcome?: 'done' | 'failed';
};
export type HarnessStatus = 'running' | 'review' | 'failed' | 'lost';
export type FileMetadata = { path: string; exists: boolean; mtime: number | null; size?: number; error?: 'unknown' };
export type HarnessCard = HarnessLane & { status: HarnessStatus; reportFile: FileMetadata | null; logFile: FileMetadata | null };
export type HarnessResponse = { lanes: HarnessCard[]; file: 'ok' | 'missing' | 'not-regular'; rejected: number; rejectedLines: number[]; truncated?: boolean };

const absoluteOrNull = (value: unknown) => value === null ||
  (typeof value === 'string' && !value.includes('\0') && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const iso = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days &&
    Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 &&
    (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60));
};

export const parseHarnessLane = (value: unknown): HarnessLane | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.v !== 1 || !text(r.id) || !text(r.title) || !absoluteOrNull(r.project) ||
      (typeof r.kind !== 'string' || !['lane', 'review', 'gate'].includes(r.kind)) || !Number.isSafeInteger(r.pid) || Number(r.pid) <= 0 || Number(r.pid) > 2147483647 ||
      !iso(r.startedAt) || !absoluteOrNull(r.report) || !absoluteOrNull(r.log) ||
      ('commandPid' in r && r.commandPid !== null && (!Number.isSafeInteger(r.commandPid) || Number(r.commandPid) <= 0 || Number(r.commandPid) > 2147483647)) ||
      ('branch' in r && r.branch !== null && !text(r.branch)) ||
      ('endedAt' in r && !iso(r.endedAt)) || ('outcome' in r && r.outcome !== 'done' && r.outcome !== 'failed')) return null;
  return {
    v: 1, id: r.id, title: r.title, project: r.project as string | null,
    kind: r.kind as HarnessLane['kind'], pid: r.pid as number, startedAt: r.startedAt,
    report: r.report as string | null, log: r.log as string | null,
    ...('commandPid' in r ? { commandPid: r.commandPid as number | null } : {}),
    ...('branch' in r ? { branch: r.branch as string | null } : {}),
    ...('endedAt' in r ? { endedAt: r.endedAt as string } : {}),
    ...('outcome' in r ? { outcome: r.outcome as HarnessLane['outcome'] } : {}),
  };
};

export const parseHarnessFeed = (input: string, cutFirstLine = false) => {
  const lanes = new Map<string, HarnessLane>();
  const rejectedLines: number[] = [];
  let rejected = 0;
  const lines = input.split('\n');
  // A final newline terminates a record; it isn't an extra record.
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((line, index) => {
    let lane: HarnessLane | null = null;
    try { if (!cutFirstLine || index > 0) lane = parseHarnessLane(JSON.parse(line)); } catch { /* Count invalid JSON below. */ }
    if (lane) lanes.set(lane.id, lane);
    else {
      rejected += 1;
      if (rejectedLines.length < 50) rejectedLines.push(index + 1);
    }
  });
  return { lanes: [...lanes.values()], rejected, rejectedLines };
};

export const newestHarnessLanes = (lanes: readonly HarnessLane[]) =>
  [...lanes].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 200);

export const harnessStatus = (lane: HarnessLane, alive: boolean): HarnessStatus => {
  if (lane.outcome === 'failed') return 'failed';
  if (lane.endedAt && lane.outcome === 'done') return 'review';
  if (!lane.endedAt && alive) return 'running';
  return 'lost';
};
