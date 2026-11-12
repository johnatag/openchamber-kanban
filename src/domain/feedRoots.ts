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

// Parse AIDE_FEED_ROOTS. Only undefined and the exact empty string mean no
// filtering (null); anything else, whitespace included, must be colon-separated
// absolute, already-normal directories or startup fails. Errors name the entry
// index and the rule, never the configured text.
const ruleBroken = (root: string): string | null => root === '' ? 'is empty' : !root.startsWith('/') ? 'is not absolute' :
  normalize(root) !== root ? 'is not normalised (no ".", "..", repeated or trailing "/", backslash, NUL or whitespace-only text)' : null;

export const parseFeedRoots = (value: string | undefined): string[] | null => {
  if (value === undefined || value === '') return null;
  const roots = value.split(':');
  roots.forEach((root, index) => {
    const rule = ruleBroken(root);
    if (rule) throw new Error('AIDE_FEED_ROOTS entry ' + (index + 1) + ' of ' + roots.length + ' ' + rule + '; the value is not shown');
  });
  return roots;
};

// Parse the text of the feed-roots file: one root per line; blank (whitespace-only)
// lines and lines starting with "#" are ignored. Errors name the line and rule only.
export const parseFeedRootsFile = (text: string): string[] => {
  const roots: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '' || line.startsWith('#')) return;
    const rule = ruleBroken(line);
    if (rule) throw new Error('feed-roots file line ' + (index + 1) + ' ' + rule + '; the text is not shown');
    roots.push(line);
  });
  if (!roots.length) throw new Error('feed-roots file contains no roots (only blank or comment lines); delete it to disable filtering');
  return roots;
};

export const insideRoots = (candidate: string | null, roots: readonly string[]): boolean => {
  if (candidate === null) return false;
  const path = normalize(candidate);
  return path !== null && roots.some(root => path === root || path.startsWith(root === '/' ? '/' : root + '/'));
};
