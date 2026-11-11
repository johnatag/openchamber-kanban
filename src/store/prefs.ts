import type { HostClient } from '@openchamber/sdk';
import type { CockpitMode } from '../domain/cockpit.ts';
import { ALL_PROJECTS } from '../domain/board.ts';

type Storage = Pick<HostClient, 'storage'>;

export const PREFS_KEY = 'prefs';

export type BoardTab = 'board' | 'harness' | 'cockpit';
export type ProjectTag = 'work' | 'personal';

export type Prefs = {
  activeTab: BoardTab;
  projectTags: Record<string, ProjectTag>;
  cockpitEmail: string;
  cockpitMode: CockpitMode;
  cockpitSubtasks: boolean;
  projectId: string;
  query: string;
  /** Task whose detail view was open when the user left the board (e.g. via Open Chat). */
  openTaskId: string | null;
};

export const DEFAULT_PREFS: Prefs = { activeTab: 'board', projectTags: {}, projectId: ALL_PROJECTS, query: '', openTaskId: null, cockpitEmail: '', cockpitMode: 'mine', cockpitSubtasks: false };

const str = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null);

export const parsePrefs = (value: unknown): Prefs => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFS };
  const record = value as Record<string, unknown>;
  return {
    activeTab: record.activeTab === 'harness' || record.activeTab === 'cockpit' ? record.activeTab : 'board',
    projectTags: record.projectTags && typeof record.projectTags === 'object' && !Array.isArray(record.projectTags)
      ? Object.fromEntries(Object.entries(record.projectTags).filter(([id, tag]) => id.length > 0 && id.length <= 512 && (tag === 'work' || tag === 'personal'))) as Record<string, ProjectTag> : {},
    cockpitEmail: (str(record.cockpitEmail, 320) ?? '').trim().toLowerCase(),
    cockpitMode: record.cockpitMode === 'all_in_progress' ? 'all_in_progress' : 'mine',
    cockpitSubtasks: record.cockpitSubtasks === true,
    projectId: str(record.projectId, 512) || DEFAULT_PREFS.projectId,
    query: str(record.query, 200) ?? '',
    openTaskId: str(record.openTaskId, 64),
  };
};

export const tagKey = (id: string) => `tag:${id}`;
export const TAG_MIGRATION_KEY = 'tagMigration';
type TagRecord = { value: ProjectTag | undefined; rev: number };
const parseTagRecord = (raw: unknown): TagRecord => {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : { value: raw };
  return {
    value: record.value === 'work' || record.value === 'personal' ? record.value : undefined,
    rev: typeof record.rev === 'number' && Number.isSafeInteger(record.rev) && record.rev >= 0 ? record.rev : 0,
  };
};

export const loadProjectTag = async (host: Storage, id: string) => parseTagRecord(await host.storage.get(tagKey(id)));

/** Personal always writes; Work and cleanup compare revisions captured before queue delays. */
export const saveProjectTag = async (host: Storage, id: string, tag: ProjectTag | null, expected: number | null) => {
  const raw = await host.storage.get(tagKey(id));
  const stored = parseTagRecord(raw);
  // null expects an absent key for migration, including no malformed/legacy value.
  const matches = expected === null ? raw == null : stored.rev === expected;
  if ((expected === null || tag !== 'personal') && (!matches || stored.rev === Number.MAX_SAFE_INTEGER)) {
    return { tag: stored.value, rev: stored.rev, conflict: true };
  }
  const rev = Math.min(stored.rev + 1, Number.MAX_SAFE_INTEGER);
  await host.storage.set(tagKey(id), { value: tag, rev });
  return { tag: tag ?? undefined, rev, conflict: false };
};

export const loadProjectTags = async (host: Storage, ids?: readonly string[]): Promise<Record<string, ProjectTag>> => {
  const projectIds = ids ?? (await host.storage.keys()).filter(key => key.startsWith('tag:')).map(key => key.slice(4));
  const entries = await Promise.all(projectIds.map(async id => [id, (await loadProjectTag(host, id)).value] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectTag] => entry[1] !== undefined));
};

/** Explicit startup migration; ordinary preference and tag reads never write. */
export const migratePrefs = async (host: Storage): Promise<void> => {
  if (await host.storage.get(TAG_MIGRATION_KEY) === true) return;
  const raw = await host.storage.get(PREFS_KEY);
  const prefs = parsePrefs(raw);
  for (const [id, tag] of Object.entries(prefs.projectTags)) {
    await saveProjectTag(host, id, tag, null);
  }
  // Re-read so migration cannot replay another surface's old settings.
  if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'projectTags')) {
    await savePrefs(host, parsePrefs(await host.storage.get(PREFS_KEY)));
  }
  await host.storage.set(TAG_MIGRATION_KEY, true);
};

export const loadPrefs = async (host: Storage): Promise<Prefs> => {
  const prefs = parsePrefs(await host.storage.get(PREFS_KEY));
  return { ...prefs, projectTags: await loadProjectTags(host) };
};

export const savePrefs = (host: Storage, prefs: Prefs) =>
  host.storage.set(PREFS_KEY, { activeTab: prefs.activeTab, projectId: prefs.projectId, query: prefs.query, openTaskId: prefs.openTaskId, cockpitEmail: prefs.cockpitEmail, cockpitMode: prefs.cockpitMode, cockpitSubtasks: prefs.cockpitSubtasks });
