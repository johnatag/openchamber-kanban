import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseFeedRoots, parseFeedRootsFile } from '../domain/feedRoots.ts';

export const FEED_ROOTS_MAX_BYTES = 64 * 1024;

// The host forwards only an allow-list of environment variables to extension
// services (XDG_CONFIG_HOME is on it), so the roots can also come from a file.
export const feedRootsFilePath = (env: NodeJS.ProcessEnv, home = homedir()) =>
  path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'aide-openchamber', 'feed-roots');

type Stat = { isFile(): boolean; size: number; mtimeMs: number; mode: number };
export type FeedRootsIo = {
  lstat(file: string): Stat; open(file: string): number; fstat(fd: number): Stat;
  read(fd: number, buffer: Buffer, offset: number, length: number): number; close(fd: number): void;
};
const realIo: FeedRootsIo = {
  lstat: file => lstatSync(file), open: file => openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
  fstat: fd => fstatSync(fd), read: (fd, buffer, offset, length) => readSync(fd, buffer, offset, length, null), close: closeSync,
};

// Env wins when set (even empty, which disables filtering). Otherwise a present
// file must be a small, stable, regular non-symlink file of valid roots, or this throws.
export const loadFeedRoots = (env: NodeJS.ProcessEnv, home = homedir(), io: FeedRootsIo = realIo): string[] | null => {
  if (env.AIDE_FEED_ROOTS !== undefined) return parseFeedRoots(env.AIDE_FEED_ROOTS);
  const file = feedRootsFilePath(env, home);
  try { io.lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('feed-roots file could not be inspected (' + (error as NodeJS.ErrnoException).code + ')');
  }
  let fd: number | null = null;
  try {
    if (!io.lstat(file).isFile()) throw new Error('feed-roots file is not a regular file (symlinks are refused)');
    fd = io.open(file);
    const before = io.fstat(fd);
    if (!before.isFile()) throw new Error('feed-roots file is not a regular file');
    if (before.mode & 0o022) throw new Error('feed-roots file is writable by group or other; chmod it to 0600');
    if (before.size > FEED_ROOTS_MAX_BYTES) throw new Error('feed-roots file is larger than 64 KiB');
    // Read to EOF with a hard cap of one byte over the limit, whatever fstat said.
    const buffer = Buffer.alloc(FEED_ROOTS_MAX_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const n = io.read(fd, buffer, used, buffer.length - used);
      if (!n) break;
      used += n;
    }
    if (used > FEED_ROOTS_MAX_BYTES) throw new Error('feed-roots file is larger than 64 KiB');
    const after = io.fstat(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || used !== before.size) {
      throw new Error('feed-roots file changed while it was being read; restart the service once it is stable');
    }
    return parseFeedRootsFile(buffer.subarray(0, used).toString('utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) throw new Error('feed-roots file could not be read (' + code + ')');
    throw error;
  } finally { if (fd !== null) io.close(fd); }
};
