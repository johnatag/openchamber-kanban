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

const tabs = (root: DomNode) => root.querySelectorAll('button').filter(node => node.getAttribute('role') === 'tab');
const ok = (polls: { n: number }) => async (request: any) => { if (request.path.split('?')[0] === '/cockpit-tasks') polls.n++; return { status: 200, body: JSON.stringify(request.path.split('?')[0] === '/cockpit-tasks' ? { status: 'ok', tasks: [] } : { file: 'missing', lanes: [], rejected: 0, rejectedLines: [], truncated: false }) }; };
const tagSel = (root: DomNode) => root.querySelectorAll('select').find(n => n.getAttribute('aria-label') === 'Project type')!;
// Storage whose 'prefs' writes wait on a gate each, completing in issue order unless told otherwise.
const gatedPrefs = (fake: ReturnType<typeof fakeHost>) => {
  const orig = fake.host.storage.set; const pending: { value: unknown; g: ReturnType<typeof deferred<void>>; fail: boolean }[] = [];
  fake.host.storage.set = (async (key: string, value: unknown) => { if (key !== 'prefs' && !key.startsWith('tag:')) return orig(key, value as any); const p = { value: structuredClone(value), g: deferred<void>(), fail: false }; pending.push(p); await p.g.promise; if (p.fail) throw new Error('Storage unavailable'); fake.stored.set(key, p.value); }) as any;
  return { pending, restore: () => { fake.host.storage.set = orig; } };
};
const flush = async (q: { pending: any[] }, fail: number[] = []) => { for (let i = 0; i < 20; i++) { const p = q.pending.find((x: any) => !x.done); if (!p) break; p.done = true; p.fail = fail.includes(q.pending.indexOf(p)); p.g.resolve(); await settle(); } };

test('REVIEW2b Board click during initial load (visible tab)', async () => {
  const dom = setup(); const fake = fakeHost();
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com', query: 'abc' });
  const gate = deferred<void>(); fake.setKeysGate(gate.promise);
  const board = mountKanbanBoard(fake.host, dom.element); await settle();
  click(dom.root, 'Board'); await settle();
  fake.setKeysGate(null); gate.resolve(); await settle(); await settle();
  board.dispose();
  const board2 = mountKanbanBoard(fake.host, dom.element); await settle(); await settle();
  assert.equal(tagSel(dom.root).value, 'work'); assert.equal((fake.stored.get('prefs') as any).query, 'abc'); assert.equal((fake.stored.get('prefs') as any).cockpitEmail, 'me@example.com');
  board2.dispose();
});

test('REVIEW2c slow write A, then tab click B (queued), then tag Personal C; B ok carries Personal, C fails', async (t) => {
  const dom = setup(); const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = ok(polls) as any;
  const board = mountKanbanBoard(fake.host, dom.element); await settle();
  const q = gatedPrefs(fake);
  click(dom.root, 'Board'); await settle();            // write A in flight (Work)
  click(dom.root, 'Board'); await settle();            // write B queued behind A
  const tag = tagSel(dom.root); tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle(); // write C queued
  const p1 = polls.n; await flush(q, [2]); q.restore(); t.mock.timers.tick(120000); await settle();
  assert.equal(tag.value, 'personal'); assert.equal(tabs(dom.root).find(n => n.textContent === 'Cockpit')!.hidden, true); assert.equal(polls.n - p1, 0);
  board.dispose();
});

