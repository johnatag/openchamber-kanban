import { loadProjectTags } from '../src/store/prefs.ts';
import { filterCockpitTasks } from '../src/domain/cockpit.ts';
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
  focus() { (document as unknown as { activeElement: DomNode }).activeElement = this; }
  querySelectorAll(selector: string): DomNode[] { return this.children.flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  matches(selector: string) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector; }
}
const setup = () => {
  const head = new DomNode('head'); const sdkStyle = new DomNode('style'); sdkStyle.id = 'oc-sdk-ui-style'; head.append(sdkStyle);
  const doc = Object.assign(new EventTarget(), { hidden: false, activeElement: null as DomNode | null, head, createElement: (tag: string) => new DomNode(tag), createElementNS: (_ns: string, tag: string) => new DomNode(tag), getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null });
  const win = new EventTarget();
  Object.assign(globalThis, { document: doc, window: win, HTMLStyleElement: DomNode, HTMLElement: DomNode, HTMLInputElement: DomNode, HTMLTextAreaElement: DomNode, Node: DomNode });
  const root = new DomNode('root');
  return { root, doc, win, element: root as unknown as Element };
};
const settle = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
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
    assert.equal(fake.keysCalls, 4);
    assert.match(dom.root.textContent, /Saved in another board/);
  } finally { board.dispose(); }
});

test('refresh requested during reload runs one follow-up reload', async () => {
  const dom = setup(); const fake = fakeHost(); const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); fake.setKeysGate(gate.promise);
    click(dom.root, 'Refresh'); click(dom.root, 'Refresh'); click(dom.root, 'Refresh');
    fake.setKeysGate(null); gate.resolve(); await settle();
    assert.equal(fake.keysCalls, 6);
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
    assert.equal(fake.keysCalls, 4);
  } finally { board.dispose(); }
});

test('Cockpit prompts for email, saves prefs, filters and links board/Harness keys, opens PR and copies keys', async () => {
  const dom = setup(); const fake = fakeHost(); const opened: string[] = [];
  const { slimCockpitTasks } = await import('../src/domain/cockpit.ts');
  const base = { key: 'COC-385', title: 'Cockpit work', status: 'in_review', priority: 'high', assignees: [{ email: 'me@example.com', name: 'Me' }], parentTaskKey: null, prUrl: 'https://github.com/team/repo/pull/1', updatedAt: '2026-11-11T12:00:00Z', estimateHours: 3, spentHours: 1 };
  const remote = slimCockpitTasks([base, { ...base, key: 'COC-385.2', title: 'Child work', parentTaskKey: 'COC-385' }, { ...base, key: 'COC-40', title: 'Other work', assignees: [], status: 'in_progress' }]);
  fake.host.openUrl = async url => { opened.push(url); };
  fake.host.serviceRequest = async request => ({ status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: remote } : { file: 'ok', lanes: [{ v: 1, id: 'lane', title: 'Review COC-385.2', branch: 'feat/COC-40', project: '/project', kind: 'review', pid: 1, startedAt: '2026-11-11T12:00:00Z', report: null, log: null, status: 'review', reportFile: null, logFile: null }], rejected: 0, rejectedLines: [], truncated: false }) });
  fake.stored.set('prefs', { projectTags: { p: 'work' } });
  const local = createTask({ title: 'Local work', projectId: 'p', sourceBranch: 'feat/COC-385' }, 1); fake.stored.set(`task:${local.id}`, local);
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const section = dom.root.querySelector('.kb-cockpit')!;
    assert.match(section.textContent, /Set your Cockpit email/); assert.ok(!section.textContent.includes('Cockpit work'));
    const email = section.querySelector('input')!; Object.assign(email, { value: 'ME@example.com', validity: { valid: true } });
    click(section, 'Save email'); await settle();
    assert.equal((fake.stored.get('prefs') as any).cockpitEmail, 'me@example.com');
    assert.match(dom.root.querySelector('.kb-harness')!.textContent, /COC-385.2 · in_review/);
    assert.match(dom.root.querySelector('.kb-harness')!.textContent, /COC-40 · in_progress/);
    assert.match(dom.root.querySelector('.kb-columns')!.textContent, /COC-385 · in_review/);

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
  feed.setEnabled(true);
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

const tabs = (root: DomNode) => root.querySelectorAll('button').filter(node => node.getAttribute('role') === 'tab');
const selectedTab = (root: DomNode) => tabs(root).find(node => node.getAttribute('aria-selected') === 'true');
const setScope = async (fake: ReturnType<typeof fakeHost>, root: DomNode, projectId: string) => {
  fake.stored.set('prefs', { ...(fake.stored.get('prefs') as object), projectId });
  click(root, 'Refresh'); await settle();
};
const cancelledTask = (parentTaskKey: string | null = null, email = 'me@example.com') => ({ status: 'in_progress' as const, assignees: [{ email }], parentTaskKey });
const openCockpitTask = { key: 'COC-12', title: 'Remote', status: 'in_progress', assignees: [{ email: 'me@example.com' }], updatedAt: '2026-11-11T12:00:00Z' };
const harnessLane = (id: string, project: string | null) => ({ v: 1, id, title: id, project, branch: 'feat/COC-12', kind: 'review', pid: 1, startedAt: '2026-11-11T12:00:00Z', report: null, log: null, status: 'review', reportFile: null, logFile: null });

test('tabs default to Board, hide empty sources, support arrow keys and persist the selection', async () => {
  const dom = setup(); const fake = fakeHost();
  fake.host.serviceRequest = async () => ({ status: 200, body: JSON.stringify({ file: 'ok', lanes: [harnessLane('Lane', '/project/sub')], rejected: 0, rejectedLines: [], truncated: false }) });
  let board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    assert.ok(tabs(dom.root).find(t => t.textContent === 'Cockpit')?.hidden);
    assert.equal(dom.root.querySelectorAll('div').filter(n => n.getAttribute('role') === 'tablist').length, 1);
    const boardTab = selectedTab(dom.root)!;
    boardTab.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowRight' })); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Harness');
    assert.equal((fake.stored.get('prefs') as any).activeTab, 'harness');
    for (const tab of tabs(dom.root)) {
      const panel = dom.root.querySelectorAll('div').find(node => node.id === tab.getAttribute('aria-controls'))!;
      assert.equal(panel.getAttribute('role'), 'tabpanel');
      assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
      assert.equal(panel.hidden, tab.getAttribute('aria-selected') !== 'true');
    }
    selectedTab(dom.root)!.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight' })); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    click(dom.root, 'Harness'); await settle(); board.dispose();
    board = mountKanbanBoard(fake.host, dom.element); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Harness');
    await setScope(fake, dom.root, 'missing-project');
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    assert.ok(tabs(dom.root).find(t => t.textContent === 'Harness')?.hidden);
  } finally { board.dispose(); }
});

test('Personal and untagged projects never call Cockpit, Work requires email, and retagging persists', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); let polls = 0;
  fake.host.serviceRequest = async request => {
    if (request.path.split('?')[0] === '/cockpit-tasks') polls++;
    return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [openCockpitTask], cancelledHidden: 3 } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) };
  };
  fake.stored.set('prefs', { cockpitEmail: 'me@example.com' });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); t.mock.timers.tick(120000); await settle(); assert.equal(polls, 0);
    await setScope(fake, dom.root, 'p'); assert.equal(polls, 0);
    const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
    assert.ok(tag); assert.equal(tag.value, 'personal');
    tag.value = 'work'; tag.dispatchEvent(new Event('change')); await settle();
    assert.equal((await loadProjectTags(fake.host))['p'], 'work'); assert.equal(polls, 1);
    click(dom.root, 'Cockpit'); assert.match(dom.root.querySelector('.kb-cockpit')!.textContent, /3 cancelled hidden/);
    tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    t.mock.timers.tick(120000); dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, 1);
    // Another window's newer Work click may replace this window's Personal choice.
    fake.stored.set('tag:p', { value: 'work', rev: 100 }); fake.stored.set('prefs', { projectId: 'p', cockpitEmail: '' }); click(dom.root, 'Refresh'); await settle();
    t.mock.timers.tick(120000); await settle(); assert.equal(polls, 1);
    click(dom.root, 'Cockpit'); assert.match(dom.root.querySelector('.kb-cockpit')!.textContent, /Set your Cockpit email/);
    const email = dom.root.querySelector('.kb-cockpit')!.querySelector('input')!;
    Object.assign(email, { value: 'me@example.com', validity: { valid: true } }); click(dom.root, 'Save email'); await settle(); assert.equal(polls, 2);
    await setScope(fake, dom.root, '__all__'); t.mock.timers.tick(60000); await settle(); assert.ok(polls > 2);
    await setScope(fake, dom.root, '__none__'); const before = polls; t.mock.timers.tick(120000); await settle(); assert.equal(polls, before);
  } finally { board.dispose(); }
});

test('Harness paths follow project filters, nested project ownership and unmatched lanes only appear in All projects', async () => {
  const dom = setup(); const fake = fakeHost();
  fake.host.onProjects = async listener => { listener({ kind: 'projects', state: 'ready', projects: [{ id: 'p', name: 'Work', directory: '/project' }, { id: 'nested', name: 'Personal', directory: '/project/home' }] }); return () => {}; };
  fake.stored.set('prefs', { projectTags: { p: 'work', nested: 'personal' } });
  fake.host.serviceRequest = async () => ({ status: 200, body: JSON.stringify({ file: 'ok', lanes: [harnessLane('Root lane', '/project'), harnessLane('Child lane', '/project/child'), harnessLane('Personal lane', '/project/home/sub'), harnessLane('Prefix lane', '/projects'), harnessLane('Unknown lane', '/elsewhere'), harnessLane('No project lane', null)], rejected: 0, rejectedLines: [], truncated: false }) });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const titles = () => dom.root.querySelector('.kb-harness')!.querySelectorAll('.kb-card-title').map(n => n.textContent);
    assert.equal(titles().length, 6);
    await setScope(fake, dom.root, 'p'); assert.deepEqual(titles(), ['Root lane', 'Child lane']);
    await setScope(fake, dom.root, 'nested'); assert.deepEqual(titles(), ['Personal lane']);
    await setScope(fake, dom.root, '__none__'); assert.deepEqual(titles(), []);
    assert.ok(tabs(dom.root).find(t => t.textContent === 'Harness')?.hidden);
  } finally { board.dispose(); }
});

test('board Cockpit badges only annotate Work cards even in All projects', async () => {
  const dom = setup(); const fake = fakeHost();
  fake.stored.set('prefs', { cockpitEmail: 'me@example.com', projectTags: { p: 'work' } });
  for (const [title, projectId] of [['Work card', 'p'], ['Personal card', 'home'], ['Untagged card', null]] as const) {
    const task = createTask({ title, projectId, sourceBranch: 'feat/coc-12_fix' }, 1); fake.stored.set(`task:${task.id}`, task);
  }
  fake.host.serviceRequest = async request => ({ status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [{ key: 'COC-12', title: 'Remote', status: 'in_review', priority: null, assignees: [], parentTaskKey: null, prUrl: null, updatedAt: '2026-11-11T12:00:00Z', estimateHours: null, spentHours: null }] } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const cards = dom.root.querySelector('.kb-columns')!.querySelectorAll('.kb-card');
    assert.match(cards.find(c => c.textContent.includes('Work card'))!.textContent, /COC-12 · in_review/);
    for (const title of ['Personal card', 'Untagged card']) assert.ok(!cards.find(c => c.textContent.includes(title))!.textContent.includes('COC-12 ·'));
  } finally { board.dispose(); }
});

test('scope changes discard in-flight Cockpit data and never restart polling in Personal scope', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  fake.stored.set('prefs', { projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  const gate = deferred<void>(); let polls = 0;
  fake.host.serviceRequest = async request => {
    if (request.path.split('?')[0] !== '/cockpit-tasks') return { status: 200, body: JSON.stringify({ file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) };
    polls++; await gate.promise;
    return { status: 200, body: JSON.stringify({ status: 'ok', tasks: [], cancelledHidden: 9 }) };
  };
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); assert.equal(polls, 1);
    await setScope(fake, dom.root, '__none__'); gate.resolve(); await settle();
    assert.ok(!dom.root.querySelector('.kb-cockpit')!.textContent.includes('9 cancelled hidden'));
    t.mock.timers.tick(120000); dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, 1);
    await setScope(fake, dom.root, 'p'); await settle(); assert.equal(polls, 2);
    assert.match(dom.root.querySelector('.kb-cockpit')!.textContent, /9 cancelled hidden/);
  } finally { board.dispose(); }
});

test('failed project tag storage leaves Personal scope intact and surfaces the error', async () => {
  const dom = setup(); const fake = fakeHost(); let polls = 0;
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = async request => { if (request.path.split('?')[0] === '/cockpit-tasks') polls++; return { status: 200, body: JSON.stringify({ file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); fake.host.storage.set = async () => { throw new Error('Storage unavailable'); };
    const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
    tag.value = 'work'; tag.dispatchEvent(new Event('change')); await settle();
    assert.equal(tag.value, 'personal'); assert.equal(polls, 0);
    assert.match(dom.root.textContent, /Something went wrong.*Storage unavailable/);
  } finally { board.dispose(); }
});

test('cancelled counts follow filters, never keep a tab visible, and reappearing tabs do not steal selection', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); let tasks: unknown[] = [];
  fake.stored.set('prefs', { projectTags: { p: 'work' }, cockpitEmail: 'me@example.com', activeTab: 'cockpit' });
  fake.host.serviceRequest = async request => ({ status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks, cancelledHidden: filterCockpitTasks([cancelledTask(), cancelledTask('COC-12'), cancelledTask(null, 'someone@example.com')], new URL(request.path, 'http://local').searchParams.get('email') ?? '', new URL(request.path, 'http://local').searchParams.get('mode') === 'all_in_progress' ? 'all_in_progress' : 'mine', new URL(request.path, 'http://local').searchParams.get('subtasks') === 'true').length } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); assert.ok(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden);
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    const section = dom.root.querySelector('.kb-cockpit')!;
    assert.match(section.textContent, /1 cancelled hidden/);
    tasks = [openCockpitTask]; t.mock.timers.tick(60000); await settle();
    assert.equal(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden, false);
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    click(dom.root, 'Refresh'); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    click(dom.root, 'Cockpit');
    Object.assign(section.querySelector('input')!, { validity: { valid: true } });
    const sub = section.querySelectorAll('input')[1]!; Object.assign(sub, { checked: true }); sub.dispatchEvent(new Event('change')); await settle();
    assert.match(section.textContent, /2 cancelled hidden/);
    const mode = section.querySelector('select')!; mode.value = 'all_in_progress'; mode.dispatchEvent(new Event('change')); await settle();
    assert.match(section.textContent, /3 cancelled hidden/);
    const search = dom.root.querySelectorAll('input').find(n => n.getAttribute('placeholder') === 'Search tasks, branch, session…' || (n as any).placeholder === 'Search tasks, branch, session…')!;
    assert.ok(search.parentNode!.parentNode!.hidden);
    const cockpitTab = selectedTab(dom.root)!; cockpitTab.focus();
    tasks = []; t.mock.timers.tick(60000); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    assert.equal(dom.doc.activeElement, selectedTab(dom.root));
    assert.equal(search.parentNode!.parentNode!.hidden, false);
  } finally { board.dispose(); }
});

test('REVIEW race: tag Work->Personal then quick tab click; queued tab save preserves Personal across reload', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  let polls = 0;
  fake.host.serviceRequest = async request => { if (request.path.split('?')[0] === '/cockpit-tasks') polls++; return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [], cancelledHidden: 1 } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  let board = mountKanbanBoard(fake.host, dom.element);
  await settle(); assert.equal(polls, 1);
  // Host storage that completes writes in issue order after a delay.
  const queue: [string, unknown][] = []; const gate = deferred<void>();
  const origSet = fake.host.storage.set;
  fake.host.storage.set = (async (key: string, value: unknown) => { queue.push([key, value]); await gate.promise; }) as any;
  const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
  tag.value = 'personal'; tag.dispatchEvent(new Event('change'));
  click(dom.root, 'Board'); // Save a tab while the tag write is pending.
  gate.resolve(); await settle();
  for (const [k, v] of queue) fake.stored.set(k, v);
  fake.host.storage.set = origSet;
  assert.equal((await loadProjectTags(fake.host))['p'], 'personal');
  board.dispose();
  const before = polls;
  board = mountKanbanBoard(fake.host, dom.element); await settle();
  assert.equal(polls - before, 0);
  board.dispose();
});

test('REVIEW race: Cockpit email save in flight preserves a Work->Personal tag change', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com', activeTab: 'cockpit' });
  let polls = 0;
  fake.host.serviceRequest = async request => { if (request.path.split('?')[0] === '/cockpit-tasks') polls++; return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [], cancelledHidden: 1 } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  const board = mountKanbanBoard(fake.host, dom.element);
  await settle();
  const gates: ReturnType<typeof deferred<void>>[] = [];
  const origSet = fake.host.storage.set;
  fake.host.storage.set = (async (key: string, value: unknown) => { const g = deferred<void>(); gates.push(g); await g.promise; fake.stored.set(key, value); }) as any;
  const email = dom.root.querySelector('.kb-cockpit')!.querySelector('input')!;
  Object.assign(email, { value: 'other@example.com', validity: { valid: true } }); click(dom.root, 'Save email');
  await settle(); // The email snapshot is already in storage when Personal is chosen.
  const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
  tag.value = 'personal'; tag.dispatchEvent(new Event('change'));
  const p1 = polls;
  // Complete in reverse order if writes overlap; a serial writer starts the second later.
  gates[1]?.resolve(); await settle();
  gates[0]!.resolve(); await settle();
  gates[1]?.resolve(); await settle();
  fake.host.storage.set = origSet;
  assert.equal(tag.value, 'personal');
  assert.equal(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden, true);
  assert.equal(polls - p1, 0);
  assert.equal((await loadProjectTags(fake.host))['p'], 'personal');
  assert.equal((fake.stored.get('prefs') as any).cockpitEmail, 'other@example.com');
  board.dispose();
});


test('Personal stays in memory on failure and Cockpit stays off', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); let polls = 0;
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = async request => { if (request.path.split('?')[0] === '/cockpit-tasks') polls++; return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [openCockpitTask] } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>();
    fake.host.storage.set = async () => { await gate.promise; throw new Error('Storage unavailable'); };
    const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
    tag.value = 'personal'; tag.dispatchEvent(new Event('change'));
    assert.equal(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden, true);
    const before = polls; t.mock.timers.tick(120000); dom.win.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(polls, before);
    gate.resolve(); await settle();
    assert.equal(tag.value, 'personal'); assert.equal(polls, before); assert.match(dom.root.textContent, /Storage unavailable/);
  } finally { board.dispose(); }
});

test('deleted tags require non-empty ready lists at least ten minutes apart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const dom = setup(); const fake = fakeHost(); let emit!: (snapshot: any) => void;
  fake.host.onProjects = async listener => { emit ??= listener; listener({ kind: 'projects', state: 'loading', projects: [] }); return () => {}; };
  fake.stored.set('prefs', { projectTags: { p: 'work', gone: 'work' } });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); assert.deepEqual([(await loadProjectTags(fake.host))['p'], (await loadProjectTags(fake.host))['gone']], ['work', 'work']);
    emit({ state: 'ready', projects: [{ id: 'p', name: 'Renamed', directory: '/project' }] }); await settle();
    assert.deepEqual([(await loadProjectTags(fake.host))['p'], (await loadProjectTags(fake.host))['gone']], ['work', 'work']);
    emit({ state: 'ready', projects: [] }); await settle();
    emit({ state: 'ready', projects: [{ id: 'p', name: 'P', directory: '/project' }] }); await settle();
    assert.deepEqual([(await loadProjectTags(fake.host))['p'], (await loadProjectTags(fake.host))['gone']], ['work', 'work']);
    emit({ state: 'ready', projects: [{ id: 'p', name: 'P', directory: '/project' }] }); await settle();
    assert.equal((await loadProjectTags(fake.host))['gone'], 'work', 'quick repeated snapshots cannot prune');
    t.mock.timers.tick(599_999);
    emit({ state: 'ready', projects: [{ id: 'p', name: 'P', directory: '/project' }] }); await settle();
    assert.equal((await loadProjectTags(fake.host))['gone'], 'work');
    t.mock.timers.tick(1);
    emit({ state: 'ready', projects: [{ id: 'p', name: 'P', directory: '/project' }] }); await settle();
    assert.deepEqual(fake.stored.get('tag:gone'), { value: null, rev: 2 }); assert.equal((await loadProjectTags(fake.host))['gone'], undefined); assert.equal((await loadProjectTags(fake.host))['p'], 'work');
  } finally { board.dispose(); }
});

test('unrelated board renders preserve Harness cards and their Copied state', async (t) => {
  const dom = setup(); const fake = fakeHost();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => {} } } });
  t.after(() => { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); });
  fake.host.serviceRequest = async () => ({ status: 200, body: JSON.stringify({ file: 'ok', lanes: [{ ...harnessLane('Report', '/project'), report: '/tmp/report.md', reportFile: { path: '/tmp/report.md', exists: true, mtime: 1 } }], rejected: 0, rejectedLines: [], truncated: false }) });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const section = dom.root.querySelector('.kb-harness')!;
    click(section, 'Copy report path'); await settle();
    assert.match(section.textContent, /Copied/);
    const search = dom.root.querySelectorAll('input').find(n => n.getAttribute('role') === 'searchbox')!;
    search.value = 'unrelated'; search.dispatchEvent(new Event('input')); await settle();
    assert.match(section.textContent, /Copied/);
  } finally { board.dispose(); }
});

test('a refresh started before Personal cannot restore stale loaded preferences', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); let polls = 0;
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = async request => { if (request.path.split('?')[0] === '/cockpit-tasks') polls++; return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [openCockpitTask] } : { file: 'missing', lanes: [] }) }; };
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); const get = fake.host.storage.get;
    fake.host.storage.get = async key => { const snapshot = await get(key); if (key === 'prefs') await gate.promise; return snapshot; };
    click(dom.root, 'Refresh'); await settle();
    const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
    tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle();
    const before = polls; gate.resolve(); await settle();
    t.mock.timers.tick(120000); dom.win.dispatchEvent(new Event('pageshow')); await settle();
    assert.equal(tag.value, 'personal'); assert.equal(polls, before);
    assert.equal((await loadProjectTags(fake.host))['p'], 'personal');
  } finally { board.dispose(); }
});

test('a failed email write rolls back only its fields and the queue still saves Personal', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = async request => ({ status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [openCockpitTask] } : { file: 'missing', lanes: [] }) });
  const board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); const gate = deferred<void>(); const set = fake.host.storage.set; let first = true;
    fake.host.storage.set = async (key, value) => { if (key === 'prefs' && first) { first = false; await gate.promise; throw new Error('Storage unavailable'); } await set(key, value); };
    const email = dom.root.querySelector('.kb-cockpit')!.querySelector('input')!;
    Object.assign(email, { value: 'new@example.com', validity: { valid: true } }); click(dom.root, 'Save email'); await settle();
    const tag = dom.root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
    tag.value = 'personal'; tag.dispatchEvent(new Event('change'));
    gate.resolve(); await settle();
    const prefs = fake.stored.get('prefs') as any;
    assert.equal((await loadProjectTags(fake.host))['p'], 'personal'); assert.equal(prefs.cockpitEmail, 'me@example.com');
    assert.equal(tag.value, 'personal'); assert.equal(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden, true);
    assert.match(dom.root.textContent, /Storage unavailable/);
  } finally { board.dispose(); }
});

test('a saved Harness tab restores while its initial load is pending, then never jumps back after hiding', async () => {
  const dom = setup(); const fake = fakeHost(); const gate = deferred<void>(); let lanes: unknown[] = [];
  fake.stored.set('prefs', { activeTab: 'harness' });
  fake.host.serviceRequest = async () => { await gate.promise; return { status: 200, body: JSON.stringify({ file: 'ok', lanes, rejected: 0, rejectedLines: [] }) }; };
  let board = mountKanbanBoard(fake.host, dom.element);
  try {
    await settle(); assert.equal(selectedTab(dom.root)?.textContent, 'Harness');
    gate.resolve(); await settle(); assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    lanes = [harnessLane('Returns', '/project')]; dom.win.dispatchEvent(new Event('pageshow')); await settle();
    assert.equal(tabs(dom.root).find(n => n.textContent === 'Harness')!.hidden, false);
    assert.equal(selectedTab(dom.root)?.textContent, 'Board');
    board.dispose(); board = mountKanbanBoard(fake.host, dom.element); await settle();
    assert.equal(selectedTab(dom.root)?.textContent, 'Harness');
  } finally { board.dispose(); }
});
