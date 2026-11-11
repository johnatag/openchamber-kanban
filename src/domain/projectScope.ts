import type { GuestProject } from '@openchamber/sdk';
import { ALL_PROJECTS } from './board.ts';
import type { ProjectTag } from '../store/prefs.ts';

export type ProjectScope = { projects: readonly GuestProject[]; projectId: string; projectTags: Record<string, ProjectTag> };
export const isWorkProject = (scope: ProjectScope, id: string | null) =>
  id !== null && scope.projects.some(project => project.id === id) && scope.projectTags[id] === 'work';
export const hasCockpitScope = (scope: ProjectScope) => scope.projectId === ALL_PROJECTS
  ? scope.projects.some(project => isWorkProject(scope, project.id)) : isWorkProject(scope, scope.projectId);

// Match a path component, not a string prefix; nested projects own their own lanes.
const platformName = () => typeof process !== 'undefined' ? process.platform :
  /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux';
const normalize = (value: string, platform: string) => {
  const path = value.replaceAll('\\', '/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..' && !/^[A-Za-z]:$/.test(parts.at(-1)!)) parts.pop();
    else if (part === '..') { if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) parts.push(part); }
    else parts.push(part);
  }
  const result = (path.startsWith('/') ? '/' : '') + parts.join('/');
  return platform === 'darwin' || platform === 'win32' ? result.toLowerCase() : result;
};
export const projectForDirectory = (projects: readonly GuestProject[], directory: string | null, platform: string = platformName()) => {
  if (!directory) return null;
  const path = normalize(directory, platform);
  return projects.filter(project => {
    const root = normalize(project.directory, platform);
    return path === root || path.startsWith(root === '/' ? '/' : root + '/');
  }).sort((a, b) => normalize(b.directory, platform).length - normalize(a.directory, platform).length)[0] ?? null;
};
