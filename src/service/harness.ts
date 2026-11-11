import { readFile, stat } from 'node:fs/promises';
import { harnessStatus, newestHarnessLanes, parseHarnessFeed, type FileMetadata } from '../domain/harness.ts';

const metadata = async (file: string | null): Promise<FileMetadata | null> => {
  if (file === null) return null;
  try {
    const info = await stat(file);
    return { path: file, exists: info.isFile(), mtime: info.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
    return { path: file, exists: false, mtime: null };
  }
};
const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};

export const readHarnessFeed = async (file: string) => {
  let input: string;
  try { input = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lanes: [], file: 'missing' };
    throw error;
  }
  const parsed = parseHarnessFeed(input);
  const lanes = await Promise.all(newestHarnessLanes(parsed.lanes).map(async lane => {
    const [reportFile, logFile] = await Promise.all([metadata(lane.report), metadata(lane.log)]);
    return { ...lane, status: harnessStatus(lane, isAlive(lane.pid), reportFile?.exists ?? false), reportFile, logFile };
  }));
  return { lanes, file: 'ok', rejected: parsed.rejected, rejectedLines: parsed.rejectedLines };
};
