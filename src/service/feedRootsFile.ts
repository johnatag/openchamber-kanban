import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseFeedRoots, parseFeedRootsFile } from '../domain/feedRoots.ts';

export const FEED_ROOTS_MAX_BYTES = 64 * 1024;

// The host forwards only an allow-list of environment variables to extension
// services (XDG_CONFIG_HOME is on it), so the roots can also come from a file.
export const feedRootsFilePath = (env: NodeJS.ProcessEnv, home = homedir()) =>
  path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'aide-openchamber', 'feed-roots');

// Env wins when set (even empty, which disables filtering). Otherwise a present
// file must be a small regular non-symlink file of valid roots, or this throws.
export const loadFeedRoots = (env: NodeJS.ProcessEnv, home = homedir()): string[] | null => {
  if (env.AIDE_FEED_ROOTS !== undefined) return parseFeedRoots(env.AIDE_FEED_ROOTS);
  const file = feedRootsFilePath(env, home);
  try { lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('feed-roots file could not be inspected (' + (error as NodeJS.ErrnoException).code + ')');
  }
  let fd: number | null = null;
  try {
    if (!lstatSync(file).isFile()) throw new Error('feed-roots file is not a regular file (symlinks are refused)');
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('feed-roots file is not a regular file');
    if (info.size > FEED_ROOTS_MAX_BYTES) throw new Error('feed-roots file is larger than 64 KiB');
    const buffer = Buffer.alloc(info.size);
    let used = 0;
    while (used < buffer.length) {
      const n = readSync(fd, buffer, used, buffer.length - used, used);
      if (!n) break;
      used += n;
    }
    return parseFeedRootsFile(buffer.subarray(0, used).toString('utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) throw new Error('feed-roots file could not be read (' + code + ')');
    throw error;
  } finally { if (fd !== null) closeSync(fd); }
};
