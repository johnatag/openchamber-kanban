export const COCKPIT_STATUSES = ['todo', 'in_progress', 'in_review', 'qa', 'done'] as const;
export type CockpitStatus = typeof COCKPIT_STATUSES[number];
export type CockpitTask = {
  key: string; title: string; status: CockpitStatus; priority: string | number | null;
  assignees: { email: string; name: string | null }[];
  parentTaskKey: string | null; prUrl: string | null; updatedAt: string;
  estimateHours: number | null; spentHours: number | null;
};
export type CockpitResponse = { status: 'ok'; tasks: CockpitTask[] } | { status: 'unavailable'; reason: string };
export type CockpitMode = 'mine' | 'all_in_progress';
const keyPattern = /^[A-Z]{2,6}-\d+(\.\d+)*$/;
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const nullableText = (v: unknown) => v == null || text(v);
const hours = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/** Explicit projection: no large text, cancellation metadata or unknown fields escape. */
export const slimCockpitTasks = (input: unknown): CockpitTask[] => {
  if (!Array.isArray(input)) throw new Error('Invalid Cockpit task list');
  const result: CockpitTask[] = [];
  const keys = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cockpit task');
    const r = value as Record<string, unknown>;
    if (!text(r.key, 128) || !keyPattern.test(r.key) || keys.has(r.key) || !text(r.title) ||
      !COCKPIT_STATUSES.includes(r.status as CockpitStatus) ||
      !(r.priority == null || text(r.priority, 128) || (typeof r.priority === 'number' && Number.isFinite(r.priority))) ||
      !Array.isArray(r.assignees) || r.assignees.some(a => !a || !text(a.email, 320) || !nullableText(a.name)) ||
      !(r.parentTaskKey == null || (text(r.parentTaskKey, 128) && keyPattern.test(r.parentTaskKey))) ||
      !nullableText(r.prUrl) || !text(r.updatedAt, 128) || !Number.isFinite(Date.parse(r.updatedAt)) ||
      !hours(r.estimateHours) || !hours(r.spentHours)) throw new Error('Invalid Cockpit task');
    keys.add(r.key);
    if (r.cancelledAt != null) continue;
    result.push({ key: r.key, title: r.title, status: r.status as CockpitStatus, priority: r.priority as CockpitTask['priority'] ?? null,
      assignees: r.assignees.map(a => ({ email: a.email, name: a.name ?? null })), parentTaskKey: r.parentTaskKey as string ?? null,
      prUrl: r.prUrl as string ?? null, updatedAt: r.updatedAt, estimateHours: r.estimateHours as number ?? null, spentHours: r.spentHours as number ?? null });
  }
  return result;
};
export const filterCockpitTasks = (tasks: readonly CockpitTask[], email: string, mode: CockpitMode, includeSubtasks: boolean) => {
  const normalized = email.trim().toLowerCase();
  return tasks.filter(t => t.status !== 'done' && (includeSubtasks || !t.parentTaskKey) &&
    (mode === 'all_in_progress' ? t.status === 'in_progress' : normalized !== '' && t.assignees.some(a => a.email.trim().toLowerCase() === normalized)));
};
export const linkedCockpitTasks = (tasks: readonly CockpitTask[], ...sources: (string | null | undefined)[]) => {
  const keys = new Set(sources.flatMap(s => [...(s ?? '').matchAll(/(?<![A-Za-z0-9_.])[A-Z]{2,6}-\d+(?:\.\d+)*(?![A-Za-z0-9_.])/g)].map(m => m[0])));
  return tasks.filter(t => keys.has(t.key));
};
