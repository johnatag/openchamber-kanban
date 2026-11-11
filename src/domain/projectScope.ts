import type { GuestProject } from '@openchamber/sdk';
import { ALL_PROJECTS } from './board.ts';
import type { ProjectTag } from '../store/prefs.ts';

export type ProjectScope = { projects: readonly GuestProject[]; projectId: string; projectTags: Record<string, ProjectTag> };
export const isWorkProject = (scope: ProjectScope, id: string | null) =>
  id !== null && scope.projects.some(project => project.id === id) && scope.projectTags[id] === 'work';
export const hasCockpitScope = (scope: ProjectScope) => scope.projectId === ALL_PROJECTS
  ? scope.projects.some(project => isWorkProject(scope, project.id)) : isWorkProject(scope, scope.projectId);

// Match a path component, not a string prefix; nested projects own their own lanes.
const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '') || '/';
export const projectForDirectory = (projects: readonly GuestProject[], directory: string | null) => {
  if (!directory) return null;
  const path = normalize(directory);
  return projects.filter(project => {
    const root = normalize(project.directory);
    return path === root || path.startsWith(root === '/' ? '/' : root + '/');
  }).sort((a, b) => normalize(b.directory).length - normalize(a.directory).length)[0] ?? null;
};
