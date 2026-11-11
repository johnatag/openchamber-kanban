import { loadProjectTags } from '../src/store/prefs.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardHost } from '../src/ui/board.ts';
import { mountKanbanBoard } from '../src/ui/board.ts';

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

const ok = (polls: { n: number }) => async (request: any) => { if (String(request.path).startsWith('/cockpit-tasks')) polls.n++; return { status: 200, body: JSON.stringify(String(request.path).startsWith('/cockpit-tasks') ? { status: 'ok', tasks: [] } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
const tagSel = (root: DomNode) => root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
// one shared Map, per-instance storage wrappers so one instance's writes can hang
const viewHost = (fake: ReturnType<typeof fakeHost>) => {
  let gate: Promise<void> | null = null; const sets: string[] = [];
  const storage = { ...fake.host.storage, set: async (k: string, v: any) => { sets.push(k); const g = gate; if (g) await g; return fake.host.storage.set(k, v); } };
  return { host: { ...fake.host, storage } as any, hang: () => { const d = deferred<void>(); gate = d.promise; return () => { gate = null; d.resolve(); }; }, sets };
};

test('R4 A queues Personal then Work behind a hung write; B persists Personal; A drains', async (t) => {
  let now = 1000; t.mock.method(Date, 'now', () => ++now);
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tag:p', 'work');
  fake.host.serviceRequest = ok(polls) as any;
  const A = viewHost(fake); const B = viewHost(fake);
  const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
  const b = setup(); const pb = mountKanbanBoard(B.host, b.element); await settle();
  const release = A.hang();
  click(a.root, 'Board'); await settle();                        // A write hangs on storage
  const tagA = tagSel(a.root); tagA.value = 'personal'; tagA.dispatchEvent(new Event('change')); await settle();
  tagA.value = 'work'; tagA.dispatchEvent(new Event('change')); await settle();   // user changes mind in A (t1)
  const tagB = tagSel(b.root); tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle(); // later, B (t2), persisted
  assert.equal((await loadProjectTags(fake.host))['p'], 'personal');
  release(); await settle(); await settle();
  const p1 = polls.n; t.mock.timers.tick(60000); await settle(); await settle();
  assert.equal((await loadProjectTags(fake.host)).p, 'personal');
  assert.equal(tagA.value, 'personal'); assert.equal(tagB.value, 'personal'); assert.equal(polls.n - p1, 0);
  assert.ok(fake.toasts.includes('Changed in another window'));
  pa.dispose(); pb.dispose();
});

test('R4 A queues Work behind a hung write; B persists Personal after; A drains', async (t) => {
  let now = 1000; t.mock.method(Date, 'now', () => ++now);
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tag:p', 'personal');
  fake.host.serviceRequest = ok(polls) as any;
  const A = viewHost(fake); const B = viewHost(fake);
  const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
  const b = setup(); const pb = mountKanbanBoard(B.host, b.element); await settle();
  const release = A.hang();
  click(a.root, 'Board'); await settle();
  const tagA = tagSel(a.root); tagA.value = 'work'; tagA.dispatchEvent(new Event('change')); await settle(); // t1 in A, hung
  const tagB = tagSel(b.root); tagB.value = 'work'; tagB.dispatchEvent(new Event('change')); await settle();
  tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle(); // t2,t3 in B, persisted
  assert.equal((await loadProjectTags(fake.host))['p'], 'personal');
  release(); await settle(); await settle();
  const p1 = polls.n; t.mock.timers.tick(60000); await settle(); await settle();
  assert.equal((await loadProjectTags(fake.host)).p, 'personal');
  assert.equal(tagA.value, 'personal'); assert.equal(tagB.value, 'personal'); assert.equal(polls.n - p1, 0);
  assert.ok(fake.toasts.includes('Changed in another window'));
  pa.dispose(); pb.dispose();
});

