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

export const loadPrefs = async (host: Storage) => parsePrefs(await host.storage.get(PREFS_KEY));

export const savePrefs = (host: Storage, prefs: Prefs) =>
  host.storage.set(PREFS_KEY, { activeTab: prefs.activeTab, projectTags: prefs.projectTags, projectId: prefs.projectId, query: prefs.query, openTaskId: prefs.openTaskId, cockpitEmail: prefs.cockpitEmail, cockpitMode: prefs.cockpitMode, cockpitSubtasks: prefs.cockpitSubtasks });
