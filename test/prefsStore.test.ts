import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefsStore, type PrefsPatch } from '../src/store/prefsStore.ts';
import { parsePrefs, type Prefs } from '../src/store/prefs.ts';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const fixture = () => {
  let stored = parsePrefs({ projectTags: { p: 'work', q: 'work' }, cockpitEmail: 'saved@example.com', query: 'saved' });
  const loading = deferred();
  const writes: { value: Prefs; gate: ReturnType<typeof deferred>; fail: boolean }[] = [];
  const host = { storage: {
    get: async () => { await loading.promise; return structuredClone(stored); },
    set: async (_key: string, value: unknown) => {
      const write = { value: structuredClone(value) as Prefs, gate: deferred(), fail: false }; writes.push(write);
      await write.gate.promise; if (write.fail) throw new Error('offline'); stored = write.value;
    }, keys: async () => [], delete: async () => {},
  } };
  return { host, loading, writes, stored: () => stored };
};

test('patches wait for load; a failed Personal patch survives and the next field retries it', async () => {
  const f = fixture(); const store = createPrefsStore(f.host);
  const personal = store.patch({ projectTags: { p: 'personal' } }).catch(() => {});
  await settle(); assert.equal(f.writes.length, 0);
  f.loading.resolve(); await settle();
  assert.equal(store.view().cockpitEmail, 'saved@example.com');
  f.writes[0]!.fail = true; f.writes[0]!.gate.resolve(); await personal;
  assert.equal(store.view().projectTags.p, 'personal');
  const query = store.patch({ query: 'new' }); await settle();
  assert.equal(f.writes[1]!.value.projectTags.p, 'personal');
  f.writes[1]!.gate.resolve(); await query;
  const reload = createPrefsStore(f.host); await reload.load();
  assert.deepEqual(reload.view(), store.view());
  assert.equal(reload.view().projectTags.q, 'work');
});

test('seeded interleavings preserve Personal intent, confirmed fields and storage across reloads', async () => {
  let seed = 0x61b3;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 40; run++) {
    const f = fixture(); const store = createPrefsStore(f.host);
    const loading = store.load();
    let expected = parsePrefs(f.stored());
    const pending: PrefsPatch[] = []; let nextWrite = 0;
    let latestPersonal = false; const promises: Promise<unknown>[] = [];
    const check = () => {
      if (latestPersonal) assert.equal(store.view().projectTags.p, 'personal');
      // Unrelated writers must never erase loaded or confirmed email/tag values.
      assert.equal(store.view().cockpitEmail, expected.cockpitEmail);
      assert.equal(store.view().projectTags.q, 'work');
    };
    const complete = async () => {
      const write = f.writes[nextWrite]; if (!write) return;
      const entry = pending.shift()!; const failed = random() < 0.4;
      write.fail = failed; write.gate.resolve(); nextWrite++; await settle();
      if (!failed) { expected = { ...expected, ...entry, projectTags: { ...expected.projectTags, ...entry.projectTags } } as Prefs;
        // A successful later writer also confirms any previously failed Personal intent.
        if (write.value.projectTags.p === 'personal') expected.projectTags.p = 'personal';
        assert.deepEqual(f.stored(), expected);
        const reloaded = createPrefsStore(f.host); await reloaded.load(); assert.deepEqual(reloaded.view(), expected);
      }
      check();
    };
    for (let step = 0; step < 30; step++) {
      if (step === 5) { f.loading.resolve(); await settle(); }
      const n = random();
      if (n < 0.65) {
        const patch: PrefsPatch = n < 0.2 ? { projectTags: { p: random() < 0.75 ? 'personal' : 'work' } } : n < 0.4 ? { query: `query-${run}-${step}` } : { activeTab: step % 2 ? 'board' : 'harness' };
        if (patch.projectTags) latestPersonal = patch.projectTags.p === 'personal';
        pending.push(patch); promises.push(store.patch(patch).catch(() => {})); await settle();
      } else await complete();
      if (step >= 5) check();
    }
    f.loading.resolve(); await settle();
    while (nextWrite < f.writes.length) await complete();
    await loading; await Promise.all(promises); check();
  }
});

test('a failed load never writes defaults and a later writer retries loading safely', async () => {
  const f = fixture(); const get = f.host.storage.get; let fail = true;
  f.host.storage.get = async () => { if (fail) { fail = false; throw new Error('load unavailable'); } return get(); };
  const store = createPrefsStore(f.host);
  await assert.rejects(store.patch({ projectTags: { p: 'personal' } }), /load unavailable/);
  assert.equal(f.writes.length, 0); assert.equal(store.view().projectTags.p, 'personal');
  const writing = store.patch({ query: 'retry' }); f.loading.resolve(); await settle();
  assert.equal(f.writes[0]!.value.cockpitEmail, 'saved@example.com');
  assert.equal(f.writes[0]!.value.projectTags.p, 'personal');
  f.writes[0]!.gate.resolve(); await writing;
});
