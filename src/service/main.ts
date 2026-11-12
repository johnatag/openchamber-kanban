// Host-owned, bearer-authenticated loopback service.
import path from 'node:path';
import { homedir } from 'node:os';
import { loadFeedRoots } from './feedRootsFile.ts';
import { createServiceServer } from './server.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!port || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}
const lanesFile = process.env.AIDE_LANES_FILE ?? path.join(homedir(), '.local/share/aide/lanes.jsonl');
let feedRoots: string[] | null;
try { feedRoots = loadFeedRoots(process.env); }
catch (error) { console.error((error as Error).message); process.exit(1); }
createServiceServer(token, lanesFile, undefined, feedRoots).listen(port, '127.0.0.1');
