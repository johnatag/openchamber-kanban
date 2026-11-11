import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { readHarnessFeed } from './harness.ts';
import { parseGitRefOutput } from '../domain/worktree.ts';

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

type GitResult = { ok: true; stdout: string } | { ok: false; status: number; error: string };

const git = (directory: string, args: string[]): Promise<GitResult> => new Promise((resolve) => {
  execFile('git', ['-C', directory, ...args], {
    timeout: 8_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  }, (error, stdout, stderr) => {
    if (!error) { resolve({ ok: true, stdout }); return; }
    if ('code' in error && error.code === 'ENOENT') { resolve({ ok: false, status: 500, error: 'git is not installed' }); return; }
    if (/not a git repository/i.test(stderr)) { resolve({ ok: false, status: 422, error: 'not a git repository' }); return; }
    resolve({ ok: false, status: 500, error: stderr.trim() || error.message });
  });
});

export const createServiceServer = (token: string, lanesFile: string) => {
  if (!path.isAbsolute(lanesFile)) throw new Error('AIDE_LANES_FILE must be absolute');
  return http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { json(res, 401, { error: 'unauthorized' }); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { json(res, 200, { ok: true }); return; }
    if (url.pathname === '/harness-lanes') {
      if (req.method !== 'GET' || url.search || req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0) {
        json(res, 400, { error: 'harness-lanes accepts GET without parameters or body' }); return;
      }
      void readHarnessFeed(lanesFile).then(
        (body) => json(res, 200, body),
        (error: unknown) => {
          console.error('Could not read harness feed', error);
          json(res, 500, { error: 'Could not read harness feed' });
        },
      );
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/branches') { json(res, 404, { error: 'not-found' }); return; }
    const directory = url.searchParams.get('directory') ?? '';
    if (!path.isAbsolute(directory)) { json(res, 400, { error: 'bad-request' }); return; }
    // Most-recently-active branches first, capped — some repositories have thousands, far more than a dropdown can usefully hold.
    void git(directory, ['for-each-ref', '--sort=-committerdate', '--count=200', '--format=%(refname)', 'refs/heads', 'refs/remotes']).then((result) => {
      if (!result.ok) { json(res, result.status, { error: result.error }); return; }
      json(res, 200, { branches: parseGitRefOutput(result.stdout) });
    });
  });
};
