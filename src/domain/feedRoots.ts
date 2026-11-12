// Per-profile feed filter: lexical path-component containment, no filesystem access.

const normalize = (value: string): string | null => {
  if (!value.startsWith('/') || value.includes('\0') || value.includes('\\')) return null;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
};

// Parse AIDE_FEED_ROOTS. Unset or blank means no filtering (null); anything else
// must be colon-separated absolute, already-normal directories or startup fails.
export const parseFeedRoots = (value: string | undefined): string[] | null => {
  if (value === undefined || value.trim() === '') return null;
  const roots = value.split(':');
  for (const root of roots) {
    if (root === '' || normalize(root) !== root) {
      throw new Error('AIDE_FEED_ROOTS must be colon-separated absolute normalised directories (no empty entries, ".", "..", repeated or trailing "/"); got ' + JSON.stringify(root));
    }
  }
  return roots;
};

export const insideRoots = (candidate: string | null, roots: readonly string[]): boolean => {
  if (candidate === null) return false;
  const path = normalize(candidate);
  return path !== null && roots.some(root => path === root || path.startsWith(root === '/' ? '/' : root + '/'));
};
