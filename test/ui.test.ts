import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardHost } from '../src/ui/board.ts';
import { mountKanbanBoard } from '../src/ui/board.ts';
import { createTask } from '../src/domain/task.ts';
import { mountHarnessFeed } from '../src/ui/harness.ts';

// DOM boundary for exercising real board, store and SDK controls without a browser host.
class DomNode extends EventTarget {
  tagName: string; children: DomNode[] = []; parentNode: DomNode | null = null;
  dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  className = ''; id = ''; hidden = false; disabled = false; value = ''; private text = '';
  classList = { add: (..._names: string[]) => {}, remove: (..._names: string[]) => {}, toggle: (..._args: unknown[]) => {} };
  constructor(tag: string) { super(); this.tagName = tag; }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(text: string) { this.text = text; this.replaceChildren(); }
  get firstChild(): DomNode | null { return this.children[0] ?? null; }
  append(...nodes: DomNode[]) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  appendChild(node: DomNode) { this.append(node); return node; }
  prepend(node: DomNode) { node.remove(); node.parentNode = this; this.children.unshift(node); }
  removeChild(node: DomNode) { this.children = this.children.filter((child) => child !== node); node.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...nodes: DomNode[]) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() {}
  querySelectorAll(selector: string): DomNode[] { return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  matches(selector: string) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector; }
}
const setup = () => {
  const head = new DomNode('head'); const sdkStyle = new DomNode('style'); sdkStyle.id = 'oc-sdk-ui-style'; head.append(sdkStyle);
  const doc = Object.assign(new EventTarget(), { hidden: false, head, createElement: (tag: string) => new DomNode(tag), createElementNS: (_ns: string, tag: string) => new DomNode(tag), getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null });
  const win = new EventTarget();
  Object.assign(globalThis, { document: doc, window: win, HTMLStyleElement: DomNode, HTMLElement: DomNode, HTMLInputElement: DomNode, HTMLTextAreaElement: DomNode, Node: DomNode });
  const root = new DomNode('root');
  return { root, doc, win, element: root as unknown as Element };
};
const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const session = (id: string) => ({ id, title: id, directory: '/project', createdAt: 1, updatedAt: 1, parentId: null, archivedAt: null, activity: 'running', outcome: null });
const fakeHost = () => {
  const stored = new Map<string, unknown>(); const toasts: string[] = [];
  let sessions = [session('one'), session('two')]; let keysCalls = 0;
  let keysGate: Promise<void> | null = null;
  let sessionGate: Promise<void> | null = null;
  let failNextTaskSave = false;
  const sessionListeners = new Set<(value: unknown) => void>();
  const host = {
    storage: { keys: async () => { keysCalls += 1; await keysGate; return [...stored.keys()]; }, get: async (key: string) => stored.get(key) ?? null, set: async (key: string, value: unknown) => { if (failNextTaskSave && key.startsWith('task:')) { failNextTaskSave = false; throw new Error('Storage unavailable'); } stored.set(key, value); }, delete: async (key: string) => { stored.delete(key); } },
    onProjects: async (listener: (value: unknown) => void) => { listener({ state: 'ready', projects: [{ id: 'p', name: 'Project', directory: '/project' }] }); return () => {}; },
    onSessions: async (_id: string, listener: (value: unknown) => void) => { await sessionGate; sessionListeners.add(listener); listener({ state: 'ready', sessions, coverage: [{ directory: '/project', state: 'ready' }] }); return () => { sessionListeners.delete(listener); }; },
    onWorktrees: async (_id: string, listener: (value: unknown) => void) => { listener({ state: 'ready', worktrees: [] }); return () => {}; },
    toast: async (request: { message: string }) => { toasts.push(request.message); }, setBadge: async () => {}, openSession: async () => {}, startSession: async () => { throw new Error('not used'); },
    serviceRequest: async () => ({ status: 200, body: JSON.stringify({ file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }),
  } as unknown as BoardHost;
  return { host, stored, toasts, failNextTaskSave: () => { failNextTaskSave = true; }, completeSession: (id: string) => { const snapshot = { state: 'ready', sessions: sessions.map((item) => item.id === id ? { ...item, activity: 'idle', outcome: 'completed' } : item), coverage: [{ directory: '/project', state: 'ready' }] }; for (const listener of sessionListeners) listener(snapshot); }, get keysCalls() { return keysCalls; }, setKeysGate: (gate: Promise<void> | null) => { keysGate = gate; }, setSessionGate: (gate: Promise<void> | null) => { sessionGate = gate; }, clearSessions: () => { sessions = []; } };
};
const click = (root: DomNode, label: string) => { const button = root.querySelectorAll('button').find((node) => node.textContent === label); assert.ok(button, label); button.dispatchEvent(new Event('click')); };

test('bulk import emits one summary and repeated import reports nothing', async () => {
  const dom = setup(); const fake = fakeHost(); const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); click(dom.root, 'Import running sessions'); await settle();
    assert.deepEqual(fake.toasts, ['Imported 2']);
    assert.equal([...fake.stored.keys()].filter((key) => key.startsWith('task:')).length, 2);
    click(dom.root, 'Import running sessions'); await settle();
    assert.deepEqual(fake.toasts, ['Imported 2', 'Nothing to import']);
  } finally { board.dispose(); }
});

test('refresh requested during import is queued and reloads saved records afterwards', async () => {
  const dom = setup(); const fake = fakeHost(); const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); fake.setSessionGate(gate.promise);
    click(dom.root, 'Import running sessions'); click(dom.root, 'Refresh');
    const externallySaved = createTask({ title: 'Saved in another board' }, 0);
    fake.stored.set(`task:${externallySaved.id}`, externallySaved);
    fake.setSessionGate(null); gate.resolve(); await settle();
    assert.equal(fake.keysCalls, 2);
    assert.match(dom.root.textContent, /Saved in another board/);
  } finally { board.dispose(); }
});

test('refresh requested during reload runs one follow-up reload', async () => {
  const dom = setup(); const fake = fakeHost(); const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); fake.setKeysGate(gate.promise);
    click(dom.root, 'Refresh'); click(dom.root, 'Refresh'); click(dom.root, 'Refresh');
    fake.setKeysGate(null); gate.resolve(); await settle();
    assert.equal(fake.keysCalls, 3);
  } finally { board.dispose(); }
});

test('harness polling pauses on frame pagehide and resumes on pageshow, then stops on dispose', async (t) => {
  const dom = setup(); t.mock.timers.enable({ apis: ['setTimeout'] }); let polls = 0;
  const fake = fakeHost(); fake.host.serviceRequest = async () => { polls += 1; return { status: 200, body: JSON.stringify({ file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  const feed = mountHarnessFeed(fake.host, dom.element);
  await settle(); assert.equal(polls, 1);
  dom.win.dispatchEvent(new Event('pagehide')); t.mock.timers.tick(30000); await settle(); assert.equal(polls, 1);
  dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, 2);
  feed.dispose(); t.mock.timers.tick(30000); dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, 2);
});


test('import while Start Agent is pending gives one wait summary without importing', async () => {
  const dom = setup(); const fake = fakeHost();
  const task = createTask({ title: 'Task', description: 'Do the work', projectId: 'p' }, 0);
  fake.stored.set(`task:${task.id}`, task);
  const gate = deferred<never>(); fake.host.startSession = () => gate.promise;
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); click(dom.root, 'Edit'); await settle(); click(dom.root, 'Start Agent'); await settle();
    click(dom.root, 'Import running sessions'); await settle();
    assert.deepEqual(fake.toasts, ['Wait for the agent that is starting']);
    assert.equal([...fake.stored.keys()].filter((key) => key.startsWith('task:')).length, 1);
  } finally { board.dispose(); }
});

test('harness announces truncated feeds, rejected line limits and non-regular files', async () => {
  const dom = setup(); const fake = fakeHost();
  fake.host.serviceRequest = async () => ({ status: 200, body: JSON.stringify({ file: 'ok', lanes: [], rejected: 51, rejectedLines: Array.from({ length: 50 }, (_, i) => i + 1), truncated: true }) });
  let feed = mountHarnessFeed(fake.host, dom.element); await settle();
  assert.match(dom.root.textContent, /last 4 MiB/); assert.match(dom.root.textContent, /51 malformed/); assert.match(dom.root.textContent, /first 50 shown/);
  feed.dispose();
  fake.host.serviceRequest = async () => ({ status: 200, body: JSON.stringify({ file: 'not-regular', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) });
  feed = mountHarnessFeed(fake.host, dom.element); await settle();
  assert.match(dom.root.textContent, /not a regular file/); feed.dispose();
});


test('harness pauses document polling and never overlaps or restarts a hidden in-flight request', async (t) => {
  const dom = setup(); t.mock.timers.enable({ apis: ['setTimeout'] }); let polls = 0;
  const gate = deferred<void>(); const fake = fakeHost();
  fake.host.serviceRequest = async () => { polls += 1; await gate.promise; return { status: 200, body: JSON.stringify({ file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  const feed = mountHarnessFeed(fake.host, dom.element);
  dom.doc.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(polls, 1);
  dom.doc.hidden = true; dom.doc.dispatchEvent(new Event('visibilitychange')); gate.resolve(); await settle();
  t.mock.timers.tick(30000); await settle(); assert.equal(polls, 1);
  dom.doc.hidden = false; dom.doc.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(polls, 2);
  feed.dispose();
});


test('failed optimistic save during import recovers from storage through the queued reload', async () => {
  const dom = setup(); const fake = fakeHost();
  const task = { ...createTask({ title: 'Existing agent', projectId: 'p', status: 'in_progress' }, 0), sessionId: 'one' };
  fake.stored.set(`task:${task.id}`, task);
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); fake.setSessionGate(gate.promise);
    click(dom.root, 'Import running sessions');
    fake.failNextTaskSave(); fake.completeSession('one'); await settle();
    const columns = () => dom.root.querySelectorAll('.kb-column');
    assert.match(columns().find((node) => node.dataset.status === 'review')!.textContent, /Existing agent/);
    fake.setSessionGate(null); gate.resolve(); await settle();
    assert.match(columns().find((node) => node.dataset.status === 'in_progress')!.textContent, /Existing agent/);
    assert.equal(fake.keysCalls, 2);
  } finally { board.dispose(); }
});

test('Cockpit prompts for email, saves prefs, filters and links board/Harness keys, opens PR and copies keys', async () => {
  const dom = setup(); const fake = fakeHost(); const opened: string[] = [];
  const { slimCockpitTasks } = await import('../src/domain/cockpit.ts');
  const base = { key: 'COC-385', title: 'Cockpit work', status: 'in_review', priority: 'high', assignees: [{ email: 'me@example.com', name: 'Me' }], parentTaskKey: null, prUrl: 'https://github.com/team/repo/pull/1', updatedAt: '2026-11-11T12:00:00Z', estimateHours: 3, spentHours: 1 };
  const remote = slimCockpitTasks([base, { ...base, key: 'COC-385.2', title: 'Child work', parentTaskKey: 'COC-385' }, { ...base, key: 'COC-40', title: 'Other work', assignees: [], status: 'in_progress' }]);
  fake.host.openUrl = async url => { opened.push(url); };
  fake.host.serviceRequest = async request => ({ status: 200, body: JSON.stringify(request.path === '/cockpit-tasks' ? { status: 'ok', tasks: remote } : { file: 'ok', lanes: [{ v: 1, id: 'lane', title: 'Review COC-385.2', branch: 'feat/COC-40', project: null, kind: 'review', pid: 1, startedAt: '2026-11-11T12:00:00Z', report: null, log: null, status: 'review', reportFile: null, logFile: null }], rejected: 0, rejectedLines: [], truncated: false }) });
  const local = createTask({ title: 'Local work', sourceBranch: 'feat/COC-385' }, 1); fake.stored.set(`task:${local.id}`, local);
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const section = dom.root.querySelector('.kb-cockpit')!;
    assert.match(section.textContent, /Set your Cockpit email/); assert.ok(!section.textContent.includes('Cockpit work'));
    assert.match(dom.root.querySelector('.kb-harness')!.textContent, /COC-385.2 · in_review/);
    assert.match(dom.root.querySelector('.kb-harness')!.textContent, /COC-40 · in_progress/);
    assert.match(dom.root.querySelector('.kb-columns')!.textContent, /COC-385 · in_review/);
    const email = section.querySelector('input')!; Object.assign(email, { value: 'ME@example.com', validity: { valid: true } });
    click(section, 'Save email'); await settle();
    assert.equal((fake.stored.get('prefs') as any).cockpitEmail, 'me@example.com');
    assert.match(section.textContent, /Cockpit work/); assert.match(section.textContent, /1\/3h/); assert.ok(!section.textContent.includes('Child work')); assert.ok(!section.textContent.includes('Other work'));
    click(section, 'Open PR'); await settle(); assert.deepEqual(opened, [base.prUrl]);
    click(section, 'Copy key'); await settle(); assert.deepEqual(fake.toasts, ['Copy Cockpit key']);
    const sub = section.querySelectorAll('input')[1]!; Object.assign(sub, { checked: true }); sub.dispatchEvent(new Event('change')); await settle();
    assert.match(section.textContent, /Child work/);
    const select = section.querySelector('select')!; select.value = 'all_in_progress'; select.dispatchEvent(new Event('change')); await settle();
    assert.match(section.textContent, /Other work/); assert.ok(!section.textContent.includes('Cockpit work'));
  } finally { board.dispose(); }
});

test('Cockpit polls every 60 seconds, pauses on both visibility hooks, clears stale links on failure and disposes', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const { mountCockpitFeed } = await import('../src/ui/cockpit.ts');
  let polls = 0; const snapshots: unknown[] = []; let fail = false;
  fake.host.serviceRequest = async () => { polls++; return { status: 200, body: JSON.stringify(fail ? { status: 'unavailable', reason: 'Cockpit authentication failed' } : { status: 'ok', tasks: [] }) }; };
  const feed = mountCockpitFeed(fake.host, dom.element, async () => {}, tasks => { snapshots.push(tasks); });
  feed.setPrefs({ cockpitEmail: 'me@example.com', cockpitMode: 'mine', cockpitSubtasks: false });
  await settle(); assert.equal(polls, 1);
  t.mock.timers.tick(59_999); await settle(); assert.equal(polls, 1);
  fail = true; t.mock.timers.tick(1); await settle(); assert.equal(polls, 2); assert.match(dom.root.textContent, /Cockpit unavailable: Cockpit authentication failed/); assert.deepEqual(snapshots.at(-1), []);
  dom.win.dispatchEvent(new Event('pagehide')); t.mock.timers.tick(120_000); await settle(); assert.equal(polls, 2);
  dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, 3);
  dom.doc.hidden = true; dom.doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(120_000); await settle(); assert.equal(polls, 3);
  dom.doc.hidden = false; dom.doc.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(polls, 4);
  feed.dispose(); dom.win.dispatchEvent(new Event('pageshow')); t.mock.timers.tick(120_000); await settle(); assert.equal(polls, 4);
});
