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

export const tagKey = (id: string, generation = 1) => `tag${generation === 1 ? '' : generation}:${id}`;
export type TagVersion = { rev: number; generation?: number };
export const newerTag = (a: TagVersion, b: TagVersion) => (a.generation ?? 1) > (b.generation ?? 1) || ((a.generation ?? 1) === (b.generation ?? 1) && a.rev > b.rev);
export const TAG_MIGRATION_KEY = 'tagMigration';
export type TagRecord = TagVersion & { value: ProjectTag | undefined };
const parseTagRecord = (raw: unknown): TagRecord => {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : { value: raw };
  return {
    value: record.value === 'work' || record.value === 'personal' ? record.value : undefined,
    rev: typeof record.rev === 'number' && Number.isSafeInteger(record.rev) && record.rev >= 0 ? record.rev : 0,
  };
};

const tagKeys = async (host: Storage) => (await host.storage.keys()).flatMap(key => {
  const match = /^tag(\d*):(.*)$/.exec(key);
  const generation = match?.[1] ? Number(match[1]) : 1;
  return match && Number.isSafeInteger(generation) && generation >= 1 ? [{ id: match[2]!, generation }] : [];
});
export const loadProjectTag = async (host: Storage, id: string): Promise<TagRecord> => {
  const generation = (await tagKeys(host)).filter(key => key.id === id).reduce((max, key) => Math.max(max, key.generation), 1);
  const record = parseTagRecord(await host.storage.get(tagKey(id, generation)));
  return generation === 1 ? record : { ...record, generation };
};

/** Personal always writes; Work and cleanup compare versions captured before queue delays. */
export const saveProjectTag = async (host: Storage, id: string, tag: ProjectTag | null, expected: number | TagVersion | null, reset = false) => {
  const stored = await loadProjectTag(host, id);
  const generation = stored.generation ?? 1;
  // null expects an absent key for migration, including no malformed/legacy value.
  const matches = expected === null ? generation === 1 && await host.storage.get(tagKey(id)) == null
    : !newerTag(stored, typeof expected === 'number' ? { rev: expected } : expected)
      && !newerTag(typeof expected === 'number' ? { rev: expected } : expected, stored);
  if (reset) {
    if (!matches || stored.rev !== Number.MAX_SAFE_INTEGER) return { ...stored, tag: stored.value, conflict: true };
    await host.storage.set(tagKey(id, generation + 1), { value: 'personal', rev: 0 });
    return { tag: 'personal' as const, rev: 0, generation: generation + 1, conflict: false };
  }
  if ((expected === null || tag !== 'personal') && (!matches || stored.rev === Number.MAX_SAFE_INTEGER)) {
    return { ...stored, tag: stored.value, conflict: true };
  }
  const rev = Math.min(stored.rev + 1, Number.MAX_SAFE_INTEGER);
  await host.storage.set(tagKey(id, generation), { value: tag, rev });
  return { tag: tag ?? undefined, rev, generation, conflict: false };
};

export const loadProjectTagRecords = async (host: Storage, ids?: readonly string[]): Promise<Record<string, TagRecord>> => {
  const projectIds = ids ?? [...new Set((await tagKeys(host)).map(key => key.id))];
  return Object.fromEntries(await Promise.all(projectIds.map(async id => [id, await loadProjectTag(host, id)])));
};
export const loadProjectTags = async (host: Storage, ids?: readonly string[]): Promise<Record<string, ProjectTag>> => {
  const records = await loadProjectTagRecords(host, ids);
  return Object.fromEntries(Object.entries(records).flatMap(([id, record]) => record.value === undefined ? [] : [[id, record.value]]));
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

export const loadPrefs = async (host: Storage, records?: Record<string, TagRecord>): Promise<Prefs> => {
  const prefs = parsePrefs(await host.storage.get(PREFS_KEY));
  return { ...prefs, projectTags: records ? Object.fromEntries(Object.entries(records).flatMap(([id, record]) => record.value === undefined ? [] : [[id, record.value]])) : await loadProjectTags(host) };
};

export const savePrefs = (host: Storage, prefs: Prefs) =>
  host.storage.set(PREFS_KEY, { activeTab: prefs.activeTab, projectId: prefs.projectId, query: prefs.query, openTaskId: prefs.openTaskId, cockpitEmail: prefs.cockpitEmail, cockpitMode: prefs.cockpitMode, cockpitSubtasks: prefs.cockpitSubtasks });
