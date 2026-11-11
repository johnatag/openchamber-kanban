import type { HostClient } from '@openchamber/sdk';
import type { CockpitMode } from '../domain/cockpit.ts';
import { ALL_PROJECTS } from '../domain/board.ts';

type Storage = Pick<HostClient, 'storage'>;

export const PREFS_KEY = 'prefs';

export type Prefs = {
  cockpitEmail: string;
  cockpitMode: CockpitMode;
  cockpitSubtasks: boolean;
  projectId: string;
  query: string;
  /** Task whose detail view was open when the user left the board (e.g. via Open Chat). */
  openTaskId: string | null;
};

export const DEFAULT_PREFS: Prefs = { projectId: ALL_PROJECTS, query: '', openTaskId: null, cockpitEmail: '', cockpitMode: 'mine', cockpitSubtasks: false };

const str = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null);

export const parsePrefs = (value: unknown): Prefs => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFS };
  const record = value as Record<string, unknown>;
  return {
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
  host.storage.set(PREFS_KEY, { projectId: prefs.projectId, query: prefs.query, openTaskId: prefs.openTaskId, cockpitEmail: prefs.cockpitEmail, cockpitMode: prefs.cockpitMode, cockpitSubtasks: prefs.cockpitSubtasks });
