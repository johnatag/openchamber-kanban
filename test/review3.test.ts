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
// Storage whose preference/tag writes wait on a gate each, completing in issue order unless told otherwise.
const gatedPrefs = (fake: ReturnType<typeof fakeHost>) => {
  const orig = fake.host.storage.set; const pending: { value: unknown; g: ReturnType<typeof deferred<void>>; fail: boolean }[] = [];
  fake.host.storage.set = (async (key: string, value: any) => { if (key !== 'prefs' && !key.startsWith('tag:')) return orig(key, value); const p = { value: structuredClone(value), g: deferred<void>(), fail: false }; pending.push(p); await p.g.promise; if (p.fail) throw new Error('Storage unavailable'); fake.stored.set(key, p.value); }) as any;
  return { pending, restore: () => { fake.host.storage.set = orig; } };
};
const flush = async (q: { pending: any[] }, fail: number[] = []) => { for (let i = 0; i < 20; i++) { const p = q.pending.find((x: any) => !x.done); if (!p) break; p.done = true; p.fail = fail.includes(q.pending.indexOf(p)); p.g.resolve(); await settle(); } };

test('R3 two instances (panel + page) on one storage key', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = ok(polls) as any;
  const a = setup(); const panel = mountKanbanBoard(fake.host, a.element); await settle();
  const b = setup(); const page = mountKanbanBoard(fake.host, b.element); await settle();
  assert.equal(polls.n, 2);
  const tagB = tagSel(b.root); tagB.value = 'personal'; tagB.dispatchEvent(new Event('change')); await settle();
  
  let p1 = polls.n; t.mock.timers.tick(60000); await settle();
  assert.equal(polls.n - p1, 0, 'stale panel must recheck storage before polling');
  click(a.root, 'Board'); await settle(); // panel writes an unrelated field
  
  panel.dispose(); page.dispose();
  const c = setup(); p1 = polls.n; const again = mountKanbanBoard(fake.host, c.element); await settle();
  assert.equal(tagSel(c.root).value, 'personal'); assert.equal(polls.n - p1, 0);
  again.dispose();
});

test('R3 remount while a Personal write is still in flight', async (t) => {
  const fake = fakeHost(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', projectTags: { p: 'work' }, cockpitEmail: 'me@example.com' });
  fake.host.serviceRequest = ok(polls) as any;
  const a = setup(); const first = mountKanbanBoard(fake.host, a.element); await settle();
  const q = gatedPrefs(fake);
  const tag = tagSel(a.root); tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle();
  first.dispose(); // close panel; write still pending
  const b = setup(); let p1 = polls.n; const second = mountKanbanBoard(fake.host, b.element); await settle();
  
  await flush(q); // old Personal write lands
  click(b.root, 'Board'); await settle(); await flush(q); q.restore();
  second.dispose(); const c = setup(); p1 = polls.n; const third = mountKanbanBoard(fake.host, c.element); await settle(); assert.equal(tagSel(c.root).value, 'personal'); assert.equal(polls.n - p1, 0); third.dispose();
  second.dispose();
});



test('seeded panel/page interleavings with a slow writer preserve the latest click and gate every poll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1000; t.mock.method(Date, 'now', () => ++now);
  let seed = 0xb407;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 20; run++) {
    const fake = fakeHost(); const polls = { n: 0 }; fake.host.serviceRequest = ok(polls) as any;
    fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tag:p', 'work');
    const windows = [0, 1].map(() => {
      let gate: Promise<void> | null = null;
      return {
        host: { ...fake.host, storage: { ...fake.host.storage, set: async (key: string, value: any) => { if (gate) await gate; await fake.host.storage.set(key, value); } } },
        hang: () => { const d = deferred<void>(); gate = d.promise; return () => { gate = null; d.resolve(); }; },
      };
    });
    const doms = [setup(), setup()];
    const boards = doms.map((dom, i) => mountKanbanBoard(windows[i]!.host, dom.element)); await settle();
    let latest: 'personal' | 'work' = 'work'; let latestAt = 0;
    const choose = async (index: number, value: 'work' | 'personal') => {
      const tag = tagSel(doms[index]!.root); tag.value = value; const clickedAt = now + 1;
      tag.dispatchEvent(new Event('change')); await settle(); return clickedAt;
    };
    const verify = async (step: number) => {
      assert.equal((await loadProjectTags(fake.host)).p, latest, `seed run ${run}, step ${step}`);
      if (latestAt) assert.deepEqual(fake.stored.get('tag:p'), { value: latest, at: latestAt });
      const before = polls.n;
      t.mock.timers.tick(60_000); doms.forEach(dom => dom.win.dispatchEvent(new Event('pageshow'))); await settle();
      if (latest === 'personal') assert.equal(polls.n, before, `no polls: run ${run}, step ${step}`);
    };
    try {
      for (let step = 0; step < 25; step++) {
        const index = random() < 0.5 ? 0 : 1;
        if (step % 6 === 0) {
          // Block the queue before its tag read, across completed writes in the other window.
          const release = windows[index]!.hang();
          try {
            click(doms[index]!.root, 'Board'); await settle();
            await choose(index, random() < 0.5 ? 'personal' : 'work');
            for (const value of ['work', random() < 0.8 ? 'personal' : 'work'] as const) {
              latestAt = await choose(1 - index, value); latest = value;
              await verify(step);
            }
          } finally { release(); }
          await settle(); await settle(); await verify(step);
          assert.equal(tagSel(doms[index]!.root).value, latest, 'slow writer adopts the winner');
        } else {
          click(doms[index]!.root, 'Board'); await settle(); await verify(step);
        }
      }
    } finally { boards.forEach(board => board.dispose()); }
  }
});

test('storage preflight fails closed and an in-memory failed Personal save overrides stored Work', async (t) => {
  const fake = fakeHost(); const dom = setup(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tag:p', 'work');
  fake.host.serviceRequest = ok(polls) as any;
  const board = mountKanbanBoard(fake.host, dom.element); await settle();
  try {
    const before = polls.n; const get = fake.host.storage.get;
    fake.host.storage.get = async key => { if (key.startsWith('tag:')) throw new Error('offline'); return get(key); };
    t.mock.timers.tick(60_000); await settle(); assert.equal(polls.n, before);
    assert.match(dom.root.textContent, /Could not verify project type/);
    fake.host.storage.get = get;
    fake.host.storage.set = async () => { throw new Error('save failed'); };
    const tag = tagSel(dom.root); tag.value = 'personal'; tag.dispatchEvent(new Event('change')); await settle();
    assert.equal((await loadProjectTags(fake.host))['p'], 'work'); assert.equal(tag.value, 'personal');
    dom.win.dispatchEvent(new Event('pageshow')); t.mock.timers.tick(120_000); await settle(); assert.equal(polls.n, before);
  } finally { board.dispose(); }
});


test('failed and refused storage checks retry after 60 seconds and remain gated', async (t) => {
  const fake = fakeHost(); const dom = setup(); t.mock.timers.enable({ apis: ['setTimeout'] }); const polls = { n: 0 };
  fake.stored.set('prefs', { projectId: 'p', cockpitEmail: 'me@example.com' }); fake.stored.set('tag:p', 'work');
  fake.host.serviceRequest = ok(polls) as any;
  const board = mountKanbanBoard(fake.host, dom.element); await settle();
  try {
    const before = polls.n; const get = fake.host.storage.get;
    fake.host.storage.get = async key => { if (key.startsWith('tag:')) throw new Error('offline'); return get(key); };
    t.mock.timers.tick(60_000); await settle(); assert.equal(polls.n, before);
    fake.host.storage.get = get;
    t.mock.timers.tick(59_999); await settle(); assert.equal(polls.n, before);
    t.mock.timers.tick(1); await settle(); assert.equal(polls.n, before + 1, 'transient error recovers on timer');
    fake.stored.set('tag:p', { value: 'personal', at: 100 });
    t.mock.timers.tick(60_000); await settle(); assert.equal(polls.n, before + 1);
    t.mock.timers.tick(60_000); await settle(); assert.equal(polls.n, before + 1, 'denied checks never poll');
    fake.stored.set('tag:p', { value: 'work', at: 101 });
    t.mock.timers.tick(60_000); await settle(); assert.equal(polls.n, before + 2, 'refused check recovers on timer');
  } finally { board.dispose(); }
});
