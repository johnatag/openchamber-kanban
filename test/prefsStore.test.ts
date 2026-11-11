import { readFileSync } from 'node:fs';
import { loadProjectTag, loadProjectTags, saveProjectTag } from '../src/store/prefs.ts';
import type { JsonValue } from '@openchamber/sdk';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefsStore } from '../src/store/prefsStore.ts';
import { loadPrefs, migratePrefs, parsePrefs } from '../src/store/prefs.ts';
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const fixture = () => {
  const stored = new Map<string, JsonValue>([['tagMigration', true], ['prefs', { cockpitEmail: 'saved@example.com', query: 'saved' }], ['tag:p', 'work'], ['tag:q', 'work']]);
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
  assert.equal(store.view().projectTags.p, 'personal'); assert.equal((await loadProjectTags(f.host))['p'], 'work');
  const query = store.patch({ query: 'new' }); await f.flush(); await query;
  assert.equal((await loadProjectTags(f.host))['p'], 'personal');
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
      if (personal) assert.equal((await loadProjectTags(f.host))['p'], 'personal', `seed run ${run}, step ${step}`);
      assert.equal((await loadProjectTags(f.host))['q'], 'work');
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
  assert.equal((await loadPrefs(f.host)).cockpitEmail, 'saved@example.com'); assert.equal((await loadProjectTags(f.host))['p'], 'personal');
});

test('legacy tags migrate once, existing per-project values win, and prefs never store tags', async () => {
  const data = new Map<string, JsonValue>([['prefs', { query: 'keep', projectTags: { p: 'work', q: 'work', bad: 'work' } }], ['tag:p', 'personal'], ['tag:bad', 'WORK']]);
  const host = { storage: { get: async (key: string) => data.get(key), keys: async () => [...data.keys()], set: async (key: string, value: JsonValue) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => { data.delete(key); } } };
  const before = structuredClone([...data]);
  await loadPrefs(host); assert.deepEqual([...data], before, 'reads never migrate or strip prefs');
  await migratePrefs(host);
  const first = await loadPrefs(host);
  assert.deepEqual(first.projectTags, { p: 'personal', q: 'work' }); assert.equal(first.query, 'keep');
  assert.equal(Object.hasOwn(data.get('prefs') as object, 'projectTags'), false);
  data.delete('tag:q');
  data.set('prefs', { query: 'updated', projectTags: { q: 'work', resurrected: 'work' } });
  await migratePrefs(host); await loadPrefs(host); assert.equal(data.has('tag:q'), false, 'migration cannot resurrect removed tags');
  assert.equal(data.has('tag:resurrected'), false);
  assert.equal(data.get('tagMigration'), true);
  assert.equal(parsePrefs(data.get('prefs')).query, 'updated');
});

test('Personal advances revisions unconditionally and a fresh Work click succeeds', async () => {
  const f = fixture(); f.loading.resolve(); let conflicts = 0;
  const store = createPrefsStore(f.host, () => {}, () => { conflicts++; }); await store.load();
  f.stored.set('tag:p', { value: 'work', rev: 21 });
  const personal = store.patch({ projectTags: { p: 'personal' } });
  assert.equal(store.view().projectTags.p, 'personal');
  await f.flush(); await personal;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', rev: 22 });
  const work = store.patch({ projectTags: { p: 'work' } }); await f.flush(); await work;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'work', rev: 23 });
  assert.equal(store.view().projectTags.p, 'work'); assert.equal(conflicts, 0);
});

test('missing and malformed revisions are zero; safe integer boundaries never overflow', async () => {
  const f = fixture(); f.loading.resolve();
  for (const rev of [undefined, '1', -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 0, 1, Number.MAX_SAFE_INTEGER - 1]) {
    f.stored.set('tag:p', { value: 'personal', rev } as any);
    const expected = typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 0 ? rev : 0;
    assert.equal((await loadProjectTag(f.host, 'p')).rev, expected);
    const writing = saveProjectTag(f.host, 'p', 'work', expected); await f.flush();
    assert.equal((await writing).conflict, false);
    assert.deepEqual(f.stored.get('tag:p'), { value: 'work', rev: expected + 1 });
  }
  f.stored.set('tag:p', { value: 'work', rev: Number.MAX_SAFE_INTEGER });
  assert.equal((await saveProjectTag(f.host, 'p', 'work', Number.MAX_SAFE_INTEGER)).conflict, true);
  assert.equal((await saveProjectTag(f.host, 'p', null, Number.MAX_SAFE_INTEGER)).conflict, true);
  const personal = saveProjectTag(f.host, 'p', 'personal', 0); await f.flush();
  assert.equal((await personal).conflict, false);
  assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', rev: Number.MAX_SAFE_INTEGER });
  assert.equal((await saveProjectTag(f.host, 'p', 'work', Number.MAX_SAFE_INTEGER)).conflict, true);
});

test('refresh and unrelated writes adopt Work only above the last local Personal revision', async () => {
  const f = fixture(); f.loading.resolve(); const store = createPrefsStore(f.host); await store.load();
  f.stored.set('tag:p', { value: 'work', rev: 10 });
  const personal = store.patch({ projectTags: { p: 'personal' } }); await f.flush(); await personal;
  for (const rev of [0, 10, 11, Number.MAX_VALUE]) {
    f.stored.set('tag:p', { value: 'work', rev });
    await store.reload(); assert.equal(store.view().projectTags.p, 'personal');
    const query = store.patch({ query: 'keep Personal' }); await f.flush(); await query;
    assert.equal(store.view().projectTags.p, 'personal');
  }
  f.stored.set('tag:p', { value: 'work', rev: 12 });
  await store.reload(); assert.equal(store.view().projectTags.p, 'work');
  f.stored.set('tag:p', { value: 'personal', rev: 0 });
  await store.reload(); assert.equal(store.view().projectTags.p, 'personal', 'Personal always adopts');
});

test('queued cleanup and Work capture revisions before waiting; only Work conflicts notify', async () => {
  for (const tag of [null, 'work'] as const) {
    const f = fixture(); f.loading.resolve(); let conflicts = 0;
    const store = createPrefsStore(f.host, () => {}, () => { conflicts++; }); await store.load();
    const blocked = store.patch({ query: 'block queue' }); await settle();
    const queued = store.patch({ projectTags: { p: tag } }); await settle();
    f.stored.set('tag:p', { value: 'personal', rev: 1 });
    await f.flush(); await Promise.all([blocked, queued]);
    assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', rev: 1 });
    assert.equal(store.view().projectTags.p, 'personal'); assert.equal(conflicts, tag === null ? 0 : 1);
    const retry = store.patch({ projectTags: { p: tag } }); await f.flush(); await retry;
    assert.equal((await loadProjectTags(f.host)).p, tag ?? undefined);
  }
});

test('a failed click-time Work read is surfaced after queue delay and requires a fresh click', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.set('tag:p', { value: 'personal', rev: 1 });
  const store = createPrefsStore(f.host); await store.load();
  const blocked = store.patch({ query: 'block queue' }); await settle();
  const get = f.host.storage.get;
  f.host.storage.get = async key => { if (key === 'tag:p') throw new Error('click read unavailable'); return get(key); };
  const work = store.patch({ projectTags: { p: 'work' } });
  const rejected = assert.rejects(work, /click read unavailable/);
  await settle(); f.host.storage.get = get;
  await f.flush(); await blocked; await rejected;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', rev: 1 });
  assert.equal(store.view().projectTags.p, 'personal');
  const retry = store.patch({ projectTags: { p: 'work' } }); await f.flush(); await retry;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'work', rev: 2 });
});

test('legacy records read as revision zero without storage writes', async () => {
  const f = fixture(); f.loading.resolve();
  f.stored.set('tag:p', { value: 'personal', at: Number.MAX_VALUE });
  f.stored.set('tag:q', { value: 'work', at: -1 });
  const loading = loadPrefs(f.host); await f.flush(); await loading;
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', at: Number.MAX_VALUE });
  assert.deepEqual(f.stored.get('tag:q'), { value: 'work', at: -1 });
  assert.deepEqual(await loadProjectTag(f.host, 'p'), { value: 'personal', rev: 0 });
  const write = saveProjectTag(f.host, 'q', 'personal', 0); await f.flush(); await write;
  assert.deepEqual(f.stored.get('tag:q'), { value: 'personal', rev: 1 });
});

test('tag ordering contains no Date usage', () => {
  for (const file of ['prefs.ts', 'prefsStore.ts']) {
    assert.doesNotMatch(readFileSync(new URL('../src/store/' + file, import.meta.url), 'utf8'), /\bDate\b/);
  }
});


test('cleanup tombstones preserve revisions and refuse a queued rev-zero Work after Personal', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.delete('tag:p');
  const a = createPrefsStore(f.host); const b = createPrefsStore(f.host);
  await Promise.all([a.load(), b.load()]);
  const blocked = a.patch({ query: 'block' }); await settle();
  const staleWork = a.patch({ projectTags: { p: 'work' } }); await settle();
  const personal = b.patch({ projectTags: { p: 'personal' } });
  await settle(); f.writes.find(write => write.key === 'tag:p')!.gate.resolve(); await personal;
  const cleanup = b.patch({ projectTags: { p: null } });
  await settle(); f.writes.filter(write => write.key === 'tag:p').at(-1)!.gate.resolve(); await cleanup;
  assert.deepEqual(f.stored.get('tag:p'), { value: null, rev: 2 });
  assert.equal((await loadProjectTags(f.host)).p, undefined);
  await f.flush(); await Promise.all([blocked, staleWork]);
  assert.deepEqual(f.stored.get('tag:p'), { value: null, rev: 2 });
  assert.equal(a.view().projectTags.p, undefined);
  const freshWork = a.patch({ projectTags: { p: 'work' } }); await f.flush(); await freshWork;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'work', rev: 3 });
});


test('migration expects absence, so revision-zero legacy or malformed keys also win', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.delete('tagMigration');
  f.stored.set('prefs', { projectTags: { p: 'work', q: 'work', bad: 'work', new: 'work' } });
  f.stored.set('tag:p', { value: 'personal', rev: 0 });
  f.stored.set('tag:q', 'personal'); f.stored.set('tag:bad', 'WORK');
  const migrating = migratePrefs(f.host); await f.flush(); await migrating;
  assert.deepEqual(f.stored.get('tag:p'), { value: 'personal', rev: 0 });
  assert.equal(f.stored.get('tag:q'), 'personal'); assert.equal(f.stored.get('tag:bad'), 'WORK');
  assert.deepEqual(f.stored.get('tag:new'), { value: 'work', rev: 1 });
  assert.equal(f.stored.get('tagMigration'), true);
});

test('poll adoption requires a strictly newer version than the last saved or adopted tag', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.set('tag:p', { value: 'work', rev: 4 });
  let conflicts = 0; const store = createPrefsStore(f.host, () => {}, () => { conflicts++; }); await store.load();
  for (const rev of [3, 4]) store.adoptPersonal({ p: { value: 'personal', rev } });
  assert.equal(store.view().projectTags.p, 'work'); assert.equal(conflicts, 0);
  store.adoptPersonal({ p: { value: 'personal', rev: 5 } });
  assert.equal(store.view().projectTags.p, 'personal'); assert.equal(conflicts, 1);
  store.adoptPersonal({ p: { value: 'personal', rev: 5 } }); assert.equal(conflicts, 1);
  f.stored.set('tag:p', { value: 'work', rev: 6 }); await store.reload();
  store.adoptPersonal({ p: { value: 'personal', rev: 5 } });
  assert.equal(store.view().projectTags.p, 'work'); assert.equal(conflicts, 1);
});

test('reset advances generations, refuses queued old-generation Work, and allows fresh Work', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.set('tag:p', { value: 'personal', rev: Number.MAX_SAFE_INTEGER });
  const a = createPrefsStore(f.host); const b = createPrefsStore(f.host); await Promise.all([a.load(), b.load()]);
  const blocked = a.patch({ query: 'block queue' }); await settle();
  const staleWork = a.patch({ projectTags: { p: 'work' } }); await settle();
  const reset = b.resetTag('p'); await settle();
  f.writes.find(write => write.key === 'tag2:p')!.gate.resolve(); await reset;
  assert.deepEqual(f.stored.get('tag2:p'), { value: 'personal', rev: 0 });
  await f.flush(); await Promise.all([blocked, staleWork]);
  assert.equal(a.view().projectTags.p, 'personal');
  assert.deepEqual(f.stored.get('tag2:p'), { value: 'personal', rev: 0 });
  const work = a.patch({ projectTags: { p: 'work' } }); await f.flush(); await work;
  assert.deepEqual(f.stored.get('tag2:p'), { value: 'work', rev: 1 }); assert.equal(a.view().projectTags.p, 'work');
  // A second exhausted generation can also be recovered.
  f.stored.set('tag2:p', { value: 'work', rev: Number.MAX_SAFE_INTEGER });
  const resetAgain = b.resetTag('p'); await f.flush(); await resetAgain;
  assert.deepEqual(f.stored.get('tag3:p'), { value: 'personal', rev: 0 });
  await a.reload(); assert.equal(a.view().projectTags.p, 'personal');
});

test('failed reset surfaces storage failure, stays Personal locally, and can be retried', async () => {
  const f = fixture(); f.loading.resolve(); f.stored.set('tag:p', { value: 'work', rev: Number.MAX_SAFE_INTEGER });
  const store = createPrefsStore(f.host); await store.load();
  const reset = store.resetTag('p'); const rejected = assert.rejects(reset, /offline/); await settle();
  const write = f.writes.find(write => write.key === 'tag2:p')!; write.fail = true; write.gate.resolve(); await rejected;
  assert.equal(store.view().projectTags.p, 'personal'); assert.equal(f.stored.has('tag2:p'), false);
  const retry = store.resetTag('p'); await f.flush(); await retry;
  assert.deepEqual(f.stored.get('tag2:p'), { value: 'personal', rev: 0 });
  assert.equal((await loadPrefs(f.host)).projectTags.p, 'personal');
});
