import type { GuestSessionActivity } from '@openchamber/sdk';
import { DEFAULT_SYNC_OPTIONS, statusForSession, type AgentOutcome, type SyncOptions } from './sync.ts';
import { DEFAULT_TASK_TITLE, TITLE_MAX, type Task, type TaskStatus } from './task.ts';

export type OrphanCandidate = {
  id: string;
  title: string;
  parentId: string | null;
  archivedAt: number | null;
  activity: GuestSessionActivity;
  outcome: AgentOutcome;
};

/** Structural eligibility only: a real top-level session, not archived, that no task already points to. */
export const isAdoptable = (session: Pick<OrphanCandidate, 'id' | 'parentId' | 'archivedAt'>, linkedSessionIds: ReadonlySet<string>): boolean =>
  session.parentId === null && session.archivedAt === null && !linkedSessionIds.has(session.id);

/**
 * The column a newly-adopted task should land in, from the session's
 * current activity — reuses the same mapping the live sync uses, just
 * starting from a status ("backlog") no real task has, so the first
 * matching rule always fires. `null` means not active enough yet to adopt
 * (for example, just created with no turn started).
 */
export const initialStatusForNewSession = (
  session: Pick<OrphanCandidate, 'activity' | 'outcome'>,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS,
): TaskStatus | null => statusForSession('backlog', session.activity, session.outcome, options);

/**
 * The host falls back to the session's own id as its `title` until OpenCode
 * generates a real one from the conversation, so a brand-new session's
 * `title` is rarely empty — it's the id itself. Treating only an *empty*
 * title as "no title yet" let that straight through as a confusing
 * `ses_...`-looking task title. `projectName`, when known, makes a much
 * more useful placeholder than the id ever was.
 */
export const titleForOrphanSession = (session: Pick<OrphanCandidate, 'id' | 'title'>, projectName?: string | null): string => {
  const title = session.title.trim();
  if (title && title !== session.id) return title.slice(0, 200);
  return projectName ? `New session in ${projectName}` : `New session (${session.id.slice(0, 8)})`;
};

/**
 * The title given to the session `Start Agent` creates. A task you haven't
 * renamed yet is still titled `DEFAULT_TASK_TITLE` ("New task") — sending
 * that straight through would leave every unrenamed task's session titled
 * identically and unhelpfully, so a real one is derived from the
 * description instead: its first line, the same text the agent is about to
 * read as its own first message. Falls back to the placeholder only when
 * there's truly nothing else to go on (no title, no description).
 */
export const sessionTitleForTask = (task: Pick<Task, 'title' | 'description'>): string => {
  const title = task.title.trim();
  if (title && title !== DEFAULT_TASK_TITLE) return title.slice(0, TITLE_MAX);
  const firstLine = task.description.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine) return firstLine.slice(0, TITLE_MAX);
  return title || DEFAULT_TASK_TITLE;
};

/** Explicit import takes only currently active sessions, regardless of age. */
export const selectSessionsToImport = <T extends OrphanCandidate>(sessions: readonly T[], excludedIds: ReadonlySet<string>) => {
  const claimed = new Set(excludedIds);
  const selected: { session: T; status: TaskStatus }[] = [];
  for (const session of sessions) {
    if (!isAdoptable(session, claimed)) continue;
    if (!['running', 'retrying', 'waiting-question', 'waiting-permission'].includes(session.activity)) continue;
    const status = initialStatusForNewSession(session);
    if (!status) continue;
    claimed.add(session.id);
    selected.push({ session, status });
  }
  return selected;
};
