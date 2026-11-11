// Host-owned, bearer-authenticated loopback service.
import path from 'node:path';
import { homedir } from 'node:os';
import { createServiceServer } from './server.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!port || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}
const lanesFile = process.env.AIDE_LANES_FILE ?? path.join(homedir(), '.local/share/aide/lanes.jsonl');
createServiceServer(token, lanesFile).listen(port, '127.0.0.1');
