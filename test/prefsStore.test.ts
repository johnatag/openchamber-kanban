import type { JsonValue } from '@openchamber/sdk';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefsStore } from '../src/store/prefsStore.ts';
import { loadPrefs, parsePrefs } from '../src/store/prefs.ts';
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const fixture = () => {
  const stored = new Map<string, JsonValue>([['prefs', { cockpitEmail: 'saved@example.com', query: 'saved' }], ['tag:p', 'work'], ['tag:q', 'work']]);
  const loading = deferred();
  const writes: { key: string; value: JsonValue; gate: ReturnType<typeof deferred>; fail: boolean }[] = [];
  const host = { storage: {
    get: async (key: string) => { await loading.promise; return structuredClone(stored.get(key)); },
    set: async (key: string, value: JsonValue) => {
      const write = { key, value: structuredClone(value), gate: deferred(), fail: false }; writes.push(write);
      await write.gate.promise; if (write.fail) throw new Error('offline'); stored.set(key, write.value);
    }, keys: async () => [...stored.keys()], delete: async (key: string) => { stored.delete(key); },
  } };
  const flush = async () => { for (let i = 0; i < 50; i++) { await settle(); for (const write of writes) write.gate.resolve(); } };
  return { host, loading, writes, stored, flush };
};

test('patches wait for load; failed Personal stays in memory and is retried by the next writer', async () => {
  const f = fixture(); const store = createPrefsStore(f.host);
  const personal = store.patch({ projectTags: { p: 'personal' } }).catch(() => {});
  await settle(); assert.equal(f.writes.length, 0);
  f.loading.resolve(); await settle();
  assert.equal(store.view().cockpitEmail, 'saved@example.com');
  assert.equal(f.writes[0]!.key, 'tag:p'); f.writes[0]!.fail = true; f.writes[0]!.gate.resolve(); await personal;
  assert.equal(store.view().projectTags.p, 'personal'); assert.equal(f.stored.get('tag:p'), 'work');
  const query = store.patch({ query: 'new' }); await f.flush(); await query;
  assert.equal(f.stored.get('tag:p'), 'personal');
  assert.equal((f.stored.get('prefs') as any).projectTags, undefined);
  assert.deepEqual(await loadPrefs(f.host), store.view());
});

test('two stores re-read confirmed fields and only write their own patches', async () => {
  const f = fixture(); f.loading.resolve(); const a = createPrefsStore(f.host); const b = createPrefsStore(f.host);
  await Promise.all([a.load(), b.load()]);
  const email = a.patch({ cockpitEmail: 'new@example.com' }); await f.flush(); await email;
  const personal = a.patch({ projectTags: { p: 'personal' } }); await f.flush(); await personal;
  const query = b.patch({ query: 'other surface' }); await f.flush(); await query;
  const prefs = await loadPrefs(f.host);
  assert.equal(prefs.cockpitEmail, 'new@example.com'); assert.equal(prefs.query, 'other surface'); assert.equal(prefs.projectTags.p, 'personal');
});

test('seeded interleavings across two stores never replay stale Work tags or unrelated fields', async () => {
  let seed = 0x61b3;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 40; run++) {
    const f = fixture(); f.loading.resolve(); const stores = [createPrefsStore(f.host), createPrefsStore(f.host)];
    await Promise.all(stores.map(store => store.load()));
    const promises: Promise<void>[] = []; let personal = false;
    for (let step = 0; step < 30; step++) {
      const store = stores[random() < 0.5 ? 0 : 1]!;
      if (step % 7 === 0) {
        // Explicit tag choices form the oracle; only a new user Work choice may re-enable Work.
        const tag = random() < 0.8 ? 'personal' : 'work';
        const writing = store.patch({ projectTags: { p: tag } }); await f.flush(); await writing; personal = tag === 'personal';
      } else {
        promises.push(store.patch(random() < 0.5 ? { query: `query-${step}` } : { activeTab: 'harness' }));
        await settle();
        if (random() < 0.5) for (const write of f.writes) if (random() < 0.5) write.gate.resolve();
        await settle();
      }
      if (personal) assert.equal(f.stored.get('tag:p'), 'personal', `seed run ${run}, step ${step}`);
      assert.equal(f.stored.get('tag:q'), 'work');
    }
    await f.flush(); await Promise.all(promises);
    if (personal) assert.equal((await loadPrefs(f.host)).projectTags.p, 'personal');
  }
});

test('a failed load never writes defaults and a later writer retries loading safely', async () => {
  const f = fixture(); const get = f.host.storage.get; let fail = true;
  f.host.storage.get = async key => { if (fail) { fail = false; throw new Error('load unavailable'); } return get(key); };
  const store = createPrefsStore(f.host);
  await assert.rejects(store.patch({ projectTags: { p: 'personal' } }), /load unavailable/);
  assert.equal(f.writes.length, 0); assert.equal(store.view().projectTags.p, 'personal');
  const writing = store.patch({ query: 'retry' }); f.loading.resolve(); await f.flush(); await writing;
  assert.equal((await loadPrefs(f.host)).cockpitEmail, 'saved@example.com'); assert.equal(f.stored.get('tag:p'), 'personal');
});

test('legacy tags migrate once, existing per-project values win, and prefs never store tags', async () => {
  const data = new Map<string, JsonValue>([['prefs', { query: 'keep', projectTags: { p: 'work', q: 'work', bad: 'work' } }], ['tag:p', 'personal'], ['tag:bad', 'WORK']]);
  const host = { storage: { get: async (key: string) => data.get(key), keys: async () => [...data.keys()], set: async (key: string, value: JsonValue) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => { data.delete(key); } } };
  const first = await loadPrefs(host);
  assert.deepEqual(first.projectTags, { p: 'personal', q: 'work' }); assert.equal(first.query, 'keep');
  assert.equal(Object.hasOwn(data.get('prefs') as object, 'projectTags'), false);
  data.delete('tag:q'); await loadPrefs(host); assert.equal(data.has('tag:q'), false, 'migration cannot resurrect removed tags');
  assert.equal(parsePrefs(data.get('prefs')).query, 'keep');
});
