import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { slimCockpitTasks, type CockpitResponse } from '../domain/cockpit.ts';

const ENDPOINT = 'https://cockpit.internal.angelsoftwares.ca/api/mcp/server';
const VERSION = '2025-03-26';
const ALLOWED_TOOLS = new Set(['list_tasks', 'get_task']);
class CockpitError extends Error {}
const fail = (reason: string): never => { throw new CockpitError(reason); };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

const readKey = async () => {
  const file = process.env.COCKPIT_API_KEY_FILE ?? path.join(homedir(), '.config/opencode/secrets/cockpit-api-key');
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16_384) return fail('Cockpit API key file is invalid');
      const buffer = Buffer.alloc(16_385);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const key = buffer.subarray(0, bytesRead).toString('utf8').trim();
      if (!key || bytesRead > 16_384 || /[\s\x00-\x1f\x7f]/.test(key)) return fail('Cockpit API key file is empty or invalid');
      return key;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof CockpitError) throw error;
    return fail('Cockpit API key file could not be read');
  }
};

// Options replace external boundaries / limits in tests; never supplied by an HTTP request.
export const createCockpitReader = (options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; maxBytes?: number } = {}) => {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  let cached: Extract<CockpitResponse, { status: 'ok' }> | null = null;
  let expires = 0;
  let flight: Promise<CockpitResponse> | null = null;

  const refresh = async (): Promise<CockpitResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let key: string | null = null;
    let session: string | null = null;
    try {
      key = await readKey();
      const rpc = async (method: string, params?: unknown, id?: number): Promise<any> => {
        const response = await request(ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': VERSION, ...(session ? { 'Mcp-Session-Id': session } : {}) },
          body: JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(id === undefined ? {} : { id }) }),
        });
        if (!response.ok) { await response.body?.cancel(); return fail(response.status === 401 || response.status === 403 ? 'Cockpit authentication failed' : 'Cockpit HTTP request failed'); }
        if (id === undefined) { await response.body?.cancel(); if (response.status !== 202) return fail('Invalid Cockpit initialization acknowledgement'); return; }
        if (method === 'initialize') session = response.headers.get('mcp-session-id');
        const type = response.headers.get('content-type')?.split(';')[0]?.trim();
        if (!response.body || (type !== 'application/json' && type !== 'text/event-stream')) { await response.body?.cancel(); return fail('Cockpit returned a non-JSON response'); }
        if (Number(response.headers.get('content-length') ?? 0) > maxBytes) { await response.body.cancel(); return fail('Cockpit response exceeded size limit'); }
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0; let buffer = '';
        const parse = (raw: string) => { try { return JSON.parse(raw); } catch { return fail('Cockpit returned malformed JSON'); } };
        const validate = (body: unknown) => {
          if (!record(body) || body.jsonrpc !== '2.0' || body.id !== id || 'error' in body || !('result' in body)) return fail('Cockpit returned an invalid JSON-RPC response');
          return body.result;
        };
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maxBytes) return fail('Cockpit response exceeded size limit');
            buffer += decoder.decode(chunk.value, { stream: true });
            if (type === 'text/event-stream') {
              let match: RegExpExecArray | null;
              while ((match = /\r?\n\r?\n/.exec(buffer))) {
                const event = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
                const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
                if (!data) continue;
                const message = parse(data);
                if (record(message) && !('id' in message) && message.jsonrpc === '2.0' && typeof message.method === 'string') continue;
                return validate(message);
              }
            }
          }
          buffer += decoder.decode();
          if (type === 'text/event-stream') return fail('Cockpit stream ended without a response');
          return validate(parse(buffer));
        } finally { await reader.cancel().catch(() => undefined); }
      };
      const initialized = await rpc('initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'openchamber-kanban', version: '1' } }, 1);
      if (!record(initialized) || initialized.protocolVersion !== VERSION || !record(initialized.capabilities) || !record(initialized.serverInfo)) return fail('Invalid Cockpit initialization response');
      await rpc('notifications/initialized');
      const callTool = async (name: string, args?: Record<string, unknown>) => {
        if (!ALLOWED_TOOLS.has(name)) return fail('Cockpit tool is not permitted');
        return rpc('tools/call', { name, ...(args ? { arguments: args } : {}) }, 2);
      };
      const result = await callTool('list_tasks');
      if (!record(result) || result.isError) return fail('Cockpit task tool failed');
      let payload: unknown = result.structuredContent;
      if (payload === undefined) {
        if (!Array.isArray(result.content)) return fail('Invalid Cockpit task result');
        const texts = result.content.filter((c: unknown) => record(c) && c.type === 'text' && typeof c.text === 'string');
        if (texts.length !== 1) return fail('Invalid Cockpit task result');
        try { payload = JSON.parse(texts[0].text); } catch { return fail('Cockpit task tool returned malformed JSON'); }
      }
      let tasks;
      try { tasks = slimCockpitTasks(record(payload) ? payload.tasks : payload); } catch { return fail('Cockpit returned invalid task records'); }
      // Even a remote server reflecting credentials in a projected field must not expose them.
      if (JSON.stringify(tasks).includes(JSON.stringify(key).slice(1, -1))) return fail('Cockpit returned unsafe task data');
      const records = record(payload) ? payload.tasks : payload;
      const cancelledHidden = (records as Record<string, unknown>[]).filter(task => task.cancelledAt != null).length;
      cached = { status: 'ok', tasks, cancelledHidden }; expires = now() + 60_000;
      return cached;
    } catch (error) {
      cached = null;
      return { status: 'unavailable', reason: controller.signal.aborted ? 'Cockpit request timed out' : error instanceof CockpitError ? error.message : 'Cockpit network request failed' };
    } finally {
      clearTimeout(timer);
      if (session && key) {
        try {
          const response = await request(ENDPOINT, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
            headers: { Authorization: `Bearer ${key}`, 'Mcp-Session-Id': session, 'MCP-Protocol-Version': VERSION } });
          await response.body?.cancel();
        } catch { /* Session termination is best-effort, including servers that do not support DELETE. */ }
      }
    }
  };
  return (): Promise<CockpitResponse> => {
    if (flight) return flight;
    if (cached && now() < expires) return Promise.resolve(cached);
    flight = refresh().finally(() => { flight = null; });
    return flight;
  };
};
