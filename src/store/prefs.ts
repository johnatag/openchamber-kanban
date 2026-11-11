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
export const saveProjectTag = async (host: Storage, id: string, tag: ProjectTag | null, expected: number) => {
  const stored = await loadProjectTag(host, id);
  if (tag !== 'personal' && stored.rev !== expected) return { tag: stored.value, rev: stored.rev, conflict: true };
  if (tag === null) {
    await host.storage.delete(tagKey(id));
    return { tag: undefined, rev: 0, conflict: false };
  }
  if (stored.rev === Number.MAX_SAFE_INTEGER) throw new Error('Project tag revision exhausted');
  const rev = stored.rev + 1;
  await host.storage.set(tagKey(id), { value: tag, rev });
  return { tag, rev, conflict: false };
};

export const loadProjectTags = async (host: Storage, ids?: readonly string[]): Promise<Record<string, ProjectTag>> => {
  const projectIds = ids ?? (await host.storage.keys()).filter(key => key.startsWith('tag:')).map(key => key.slice(4));
  const entries = await Promise.all(projectIds.map(async id => [id, (await loadProjectTag(host, id)).value] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectTag] => entry[1] !== undefined));
};

export const loadPrefs = async (host: Storage): Promise<Prefs> => {
  const raw = await host.storage.get(PREFS_KEY);
  const prefs = parsePrefs(raw);
  if (await host.storage.get(TAG_MIGRATION_KEY) !== true) {
    // Existing keys, including malformed values, win over the legacy snapshot.
    for (const [id, tag] of Object.entries(prefs.projectTags)) {
      if (await host.storage.get(tagKey(id)) == null) await host.storage.set(tagKey(id), { value: tag, rev: 0 });
    }
    await host.storage.set(TAG_MIGRATION_KEY, true);
  }
  if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'projectTags')) {
    // Read again so migration does not replay the other surface's old settings.
    await savePrefs(host, parsePrefs(await host.storage.get(PREFS_KEY)));
  }
  // Strip legacy timestamps on a fresh read; never carry them into revision ordering.
  const keys = (await host.storage.keys()).filter(key => key.startsWith('tag:'));
  const entries = await Promise.all(keys.map(async key => {
    const rawTag = await host.storage.get(key);
    const tag = parseTagRecord(rawTag);
    if (tag.value !== undefined && rawTag && typeof rawTag === 'object' && Object.hasOwn(rawTag, 'at')) {
      await host.storage.set(key, { value: tag.value, rev: tag.rev });
    }
    return [key.slice(4), tag.value] as const;
  }));
  const projectTags = Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectTag] => entry[1] !== undefined));
  return { ...prefs, projectTags };
};

export const savePrefs = (host: Storage, prefs: Prefs) =>
  host.storage.set(PREFS_KEY, { activeTab: prefs.activeTab, projectId: prefs.projectId, query: prefs.query, openTaskId: prefs.openTaskId, cockpitEmail: prefs.cockpitEmail, cockpitMode: prefs.cockpitMode, cockpitSubtasks: prefs.cockpitSubtasks });
