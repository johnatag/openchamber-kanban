export type HarnessLane = {
  v: 1; id: string; title: string; project: string | null;
  kind: 'lane' | 'review' | 'gate'; pid: number; startedAt: string;
  report: string | null; log: string | null;
  endedAt?: string; outcome?: 'done' | 'failed';
};
export type HarnessStatus = 'running' | 'review' | 'failed' | 'lost';
export type FileMetadata = { path: string; exists: boolean; mtime: number | null };
export type HarnessCard = HarnessLane & { status: HarnessStatus; reportFile: FileMetadata | null; logFile: FileMetadata | null };
export type HarnessResponse = { lanes: HarnessCard[]; file: 'ok' | 'missing'; rejected: number; rejectedLines: number[] };

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
      (typeof r.kind !== 'string' || !['lane', 'review', 'gate'].includes(r.kind)) || !Number.isSafeInteger(r.pid) || Number(r.pid) <= 0 ||
      !iso(r.startedAt) || !absoluteOrNull(r.report) || !absoluteOrNull(r.log) ||
      ('endedAt' in r && !iso(r.endedAt)) || ('outcome' in r && r.outcome !== 'done' && r.outcome !== 'failed')) return null;
  return {
    v: 1, id: r.id, title: r.title, project: r.project as string | null,
    kind: r.kind as HarnessLane['kind'], pid: r.pid as number, startedAt: r.startedAt,
    report: r.report as string | null, log: r.log as string | null,
    ...('endedAt' in r ? { endedAt: r.endedAt as string } : {}),
    ...('outcome' in r ? { outcome: r.outcome as HarnessLane['outcome'] } : {}),
  };
};

export const parseHarnessFeed = (input: string) => {
  const lanes = new Map<string, HarnessLane>();
  const rejectedLines: number[] = [];
  const lines = input.split('\n');
  // A final newline terminates a record; it isn't an extra record.
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((line, index) => {
    let lane: HarnessLane | null = null;
    try { lane = parseHarnessLane(JSON.parse(line)); } catch { /* Count invalid JSON below. */ }
    if (lane) lanes.set(lane.id, lane);
    else rejectedLines.push(index + 1);
  });
  return { lanes: [...lanes.values()], rejected: rejectedLines.length, rejectedLines };
};

export const newestHarnessLanes = (lanes: readonly HarnessLane[]) =>
  [...lanes].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 200);

export const harnessStatus = (lane: HarnessLane, alive: boolean, reportExists: boolean): HarnessStatus => {
  if (lane.outcome === 'failed') return 'failed';
  if (!lane.endedAt && alive) return 'running';
  if (lane.endedAt || reportExists) return 'review';
  return 'lost';
};
