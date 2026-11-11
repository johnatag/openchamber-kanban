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
  assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
  pa.dispose(); pb.dispose();
});

test('R4 A queues Work behind a hung write; B persists Personal after; A drains', async (t) => {
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
  assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
  pa.dispose(); pb.dispose();
});


const tryPersonal = async (stored: unknown, label: string, t: any, nowShift = 0) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', stored);
  fake.host.serviceRequest = ok(polls) as any;
  const realNow = Date.now; if (nowShift) Date.now = () => realNow() + nowShift;
  try {
    const a = setup(); const board = mountKanbanBoard(fake.host, a.element); await settle();
    t.after(() => board.dispose());
    const tag = tagSel(a.root); const before = polls.n;
    tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle(); await settle();
    t.mock.timers.tick(60000); await settle(); await settle();
    assert.equal((fake.stored.get('tag:p') as any).value, 'personal', label);
    assert.equal(tag.value, 'personal', label); assert.equal(polls.n, before, label);
    // second attempt
    tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle(); await settle(); t.mock.timers.tick(60000); await settle();
    assert.equal((fake.stored.get('tag:p') as any).value, 'personal', label);
    assert.equal(tag.value, 'personal', label); assert.equal(polls.n, before, label);
    board.dispose();
  } finally { Date.now = realNow; t.mock.timers.reset(); }
};
test('R5 future Work locks Personal out?', async (t) => { await tryPersonal({ value: 'work', at: Date.now() + 3600_000 }, 'future+1h', t); });
test('R5 huge at', async (t) => { await tryPersonal({ value: 'work', at: Number.MAX_VALUE }, 'MAX_VALUE', t); });
test('R5 clock moved back 5 min after a Work click', async (t) => { await tryPersonal({ value: 'work', at: Date.now() }, 'clock-5min', t, -300_000); });
test('R5 equal at', async (t) => { const now = Date.now(); const realNow = Date.now; Date.now = () => now; try { await tryPersonal({ value: 'work', at: now }, 'equal', t); } finally { Date.now = realNow; } });
test('R5 malformed at', async (t) => { await tryPersonal({ value: 'work', at: 'soon' }, 'string-at', t); await tryPersonal({ value: 'work', at: -5 }, 'neg-at', t); await tryPersonal({ value: 'work', at: Infinity }, 'inf-at(JSON null)', t); await tryPersonal({ value: 'work' }, 'no-at', t); await tryPersonal('work', 'legacy-string', t); });

test('R6 hung Work in A, clock +1h, B Personal, clock back, A drains', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'personal', at: 1 });
  fake.host.serviceRequest = ok(polls) as any;
  const realNow = Date.now; let shift = 0; Date.now = () => realNow() + shift;
  try {
    const A = viewHost(fake); const B = viewHost(fake);
    const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
    const b = setup(); const pb = mountKanbanBoard(B.host, b.element); await settle();
    const release = A.hang();
    click(a.root, 'Board'); await settle();
    const tagA = tagSel(a.root); tagA.value = 'work'; tagA.dispatchEvent(new Event('change')); await settle(); // t1, hung
    const tagB = tagSel(b.root); tagB.value = 'work'; tagB.dispatchEvent(new Event('change')); await settle();
    shift = 3600_000;
    tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle(); // latest user choice: Personal
    shift = 0;
    assert.equal((await loadProjectTags(fake.host)).p, 'personal');
    release(); await settle(); await settle();
    const p1 = polls.n; t.mock.timers.tick(60000); await settle(); await settle();
    assert.equal((await loadProjectTags(fake.host)).p, 'personal');
    assert.equal(tagA.value, 'personal'); assert.equal(tagB.value, 'personal'); assert.equal(polls.n - p1, 0);
    assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
    pa.dispose(); pb.dispose();
  } finally { Date.now = realNow; }
});

test('R6 Work lockout after a bumped Personal', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  const now = Date.now();
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'work', at: now + 299_000 });
  fake.host.serviceRequest = ok(polls) as any;
  const a = setup(); const board = mountKanbanBoard(fake.host, a.element); await settle();
  const tag = tagSel(a.root);
  tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle(); await settle();
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'personal', rev: 1 });
  for (let i = 0; i < 3; i++) { tag.value = 'work'; tag.dispatchEvent(new Event('change')); await settle(); await settle(); }
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'work', rev: 4 });
  assert.equal(tag.value, 'work'); assert.deepEqual(fake.toasts, []);
  board.dispose();
});

test('R7 Personal against rev MAX_SAFE_INTEGER', async (t) => { await tryPersonal({ value: 'work', rev: Number.MAX_SAFE_INTEGER }, 'rev-MAX', t); });
test('R7 Personal against odd revs', async (t) => {
  for (const rev of [-1, 1.5, '7', 2 ** 60, null]) await tryPersonal({ value: 'work', rev }, 'rev=' + String(rev), t);
});
test('R7 remount after rev-MAX Personal', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'work', rev: Number.MAX_SAFE_INTEGER });
  fake.host.serviceRequest = ok(polls) as any;
  const a = setup(); const b1 = mountKanbanBoard(fake.host, a.element); await settle();
  const tag = tagSel(a.root); tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle(); await settle();
  b1.dispose(); const p1 = polls.n;
  const c = setup(); const b2 = mountKanbanBoard(fake.host, c.element); await settle(); t.mock.timers.tick(60000); await settle();
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'personal', rev: Number.MAX_SAFE_INTEGER });
  assert.equal(tagSel(c.root).value, 'personal'); assert.equal(polls.n, p1);
  const choice = tagSel(c.root); choice.value = 'work'; choice.dispatchEvent(new Event('change')); await settle(); await settle();
  assert.equal(choice.value, 'personal'); assert.equal(polls.n, p1);
  assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
  b2.dispose();
});
test('R7 stuck Personal in A, later Work in B, A drains', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'work', rev: 3 });
  fake.host.serviceRequest = ok(polls) as any;
  const A = viewHost(fake); const B = viewHost(fake);
  const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
  const b = setup(); const pb = mountKanbanBoard(B.host, b.element); await settle();
  const release = A.hang(); click(a.root, 'Board'); await settle();
  const tagA = tagSel(a.root); tagA.value = 'personal'; tagA.dispatchEvent(new Event('change')); await settle();
  const tagB = tagSel(b.root); tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle();
  tagB.value = 'work'; tagB.dispatchEvent(new Event('change')); await settle(); await settle();
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'work', rev: 5 }); assert.equal(tagB.value, 'work');
  release(); await settle(); await settle(); const p1 = polls.n; t.mock.timers.tick(60000); await settle(); await settle();
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'personal', rev: 6 });
  assert.equal(tagA.value, 'personal'); assert.equal(tagB.value, 'personal'); assert.equal(polls.n, p1);
  assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
  const toastCount = fake.toasts.length; t.mock.timers.tick(60000); await settle(); assert.equal(fake.toasts.length, toastCount);
  pa.dispose(); pb.dispose();
});
test('R7 A Work stuck, B Personal then Work, A drains (CAS refuses?)', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'personal', rev: 1 });
  fake.host.serviceRequest = ok(polls) as any;
  const A = viewHost(fake); const B = viewHost(fake);
  const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
  const b = setup(); const pb = mountKanbanBoard(B.host, b.element); await settle();
  const release = A.hang(); click(a.root, 'Board'); await settle();
  const tagA = tagSel(a.root); tagA.value = 'work'; tagA.dispatchEvent(new Event('change')); await settle();
  const tagB = tagSel(b.root); tagB.value = 'work'; tagB.dispatchEvent(new Event('change')); await settle(); await settle();
  tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle(); await settle();
  release(); await settle(); await settle(); const p1 = polls.n; t.mock.timers.tick(60000); await settle(); await settle();
  assert.equal((await loadProjectTags(fake.host)).p, 'personal');
  assert.equal(tagA.value, 'personal'); assert.equal(tagB.value, 'personal'); assert.equal(polls.n, p1);
  assert.ok(fake.toasts.includes('Changed elsewhere, choose again'));
  pa.dispose(); pb.dispose();
});
test('R7 legacy {value,at} strip races a Personal from the other window', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] });
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tagMigration', true); fake.stored.set('tag:p', { value: 'work', at: 5 });
  const hold = deferred<void>(); const A = viewHost(fake); let held = false;
  const get = A.host.storage.get; A.host.storage.get = async (k: string) => { const v = await get(k); if (k === 'tag:p' && !held) { held = true; await hold.promise; } return v; };
  const a = setup(); const pa = mountKanbanBoard(A.host, a.element); await settle();
  fake.stored.set('tag:p', { value: 'personal', rev: 1 }); // B's Personal lands while A holds its read
  hold.resolve(); await settle(); await settle();
  assert.deepEqual(fake.stored.get('tag:p'), { value: 'personal', rev: 1 });
  pa.dispose();
});
