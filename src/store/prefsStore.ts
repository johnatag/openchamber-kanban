import { DEFAULT_PREFS, loadPrefs, migratePrefs, loadProjectTag, savePrefs, saveProjectTag, type Prefs, type ProjectTag, type TagRecord, type TagVersion, loadProjectTagRecords, newerTag } from './prefs.ts';

type Host = Parameters<typeof loadPrefs>[0];
export type PrefsPatch = Partial<Omit<Prefs, 'projectTags'>> & { projectTags?: Record<string, ProjectTag | null> };
const apply = (prefs: Prefs, patch: PrefsPatch): Prefs => {
  const tags = { ...prefs.projectTags };
  for (const [id, tag] of Object.entries(patch.projectTags ?? {})) {
    if (tag === null) delete tags[id]; else tags[id] = tag;
  }
  return { ...prefs, ...patch, projectTags: tags };
};

/** Saved storage plus ordered field patches. Failed Personal intents remain for the next write. */
export const createPrefsStore = (host: Host, changed: (prefs: Prefs) => void = () => {}, onConflict: (id?: string, corrupt?: boolean) => void = () => {}) => {
  const personalRevisions = new Map<string, TagVersion>();
  const confirmed = new Map<string, TagVersion>();
  const confirm = (records: Record<string, TagVersion>) => {
    for (const [id, record] of Object.entries(records)) {
      if (newerTag(record, confirmed.get(id) ?? { rev: -1 })) confirmed.set(id, record);
    }
  };
  const readPrefs = async () => {
    const records = await loadProjectTagRecords(host);
    const value = await loadPrefs(host, records);
    for (const [id, rev] of personalRevisions) {
      if (value.projectTags[id] === 'work') {
        const stored = await loadProjectTag(host, id);
        if (stored.value !== 'work' || !newerTag(stored, rev)) value.projectTags[id] = 'personal';
      }
    }
    return { value, records };
  };
  let saved: Prefs = { ...DEFAULT_PREFS };
  let pending: { patch: PrefsPatch; expected: Promise<Map<string, TagVersion>>; resetId?: string }[] = [];
  let loading: Promise<void> | null = null;
  let loaded = false;
  let revision = 0;
  let queue: Promise<void> = Promise.resolve();
  // Work only takes effect once confirmed; Personal takes effect immediately.
  const view = () => pending.reduce<Prefs>((prefs, { patch }) => apply(prefs, {
    ...patch, projectTags: Object.fromEntries(Object.entries(patch.projectTags ?? {}).filter(([, tag]) => tag !== 'work')),
  }), saved);
  const publish = () => changed(view());
  const load = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (!loading) loading = migratePrefs(host).then(readPrefs).then(({ value, records }) => { saved = value; confirm(records); loaded = true; publish(); }).finally(() => { loading = null; });
    return loading;
  };
  const patch = (patch: PrefsPatch, resetId?: string): Promise<void> => {
    // Copy the writer's fields so later mutations cannot alter an in-flight write.
    const copy = structuredClone(patch);
    // Start reads at the user's action, outside the serialized write queue.
    const expected = Promise.all(Object.entries(copy.projectTags ?? {}).filter(([, tag]) => tag !== 'personal' || resetId !== undefined)
      .map(async ([id]) => [id, await loadProjectTag(host, id)] as const)).then(values => new Map(values));
    const entry = { patch: copy, expected, resetId };
    // The queued writer surfaces read failures; handle early rejection until it runs.
    void entry.expected.catch(() => {});
    revision++;
    pending.push(entry); publish();
    const write = queue.then(async () => {
      try {
        await load();
        const end = pending.indexOf(entry);
        const patches = pending.slice(0, end + 1);
        const snapshot = await readPrefs();
        const value = patches.reduce((prefs, entry) => apply(prefs, entry.patch), snapshot.value);
        // Only fields this instance actually changed can be written.
        const tagChanges = new Map<string, { tag: ProjectTag | null; expected: TagVersion; reset: boolean }>();
        for (const entry of patches) {
          const expected = await entry.expected;
          for (const [id, tag] of Object.entries(entry.patch.projectTags ?? {})) tagChanges.set(id, { tag, expected: expected.get(id) ?? { rev: 0 }, reset: entry.resetId === id });
        }
        let conflict: { id: string; corrupt: boolean } | undefined;
        for (const [id, { tag, expected, reset }] of tagChanges) {
          const result = await saveProjectTag(host, id, tag, expected, reset);
          snapshot.records[id] = { ...result, value: result.tag };
          if (tag === 'personal' && !result.conflict) personalRevisions.set(id, result);
          if (result.tag === 'work' && personalRevisions.has(id) && !newerTag(result, personalRevisions.get(id)!)) result.tag = 'personal';
          if (result.tag === undefined) delete value.projectTags[id]; else value.projectTags[id] = result.tag;
          if (result.conflict && (tag === 'work' || reset)) conflict = { id, corrupt: result.rev === Number.MAX_SAFE_INTEGER };
        }
        if (patches.some(({ patch }) => Object.keys(patch).some(key => key !== 'projectTags'))) await savePrefs(host, value);
        saved = value;
        confirm(snapshot.records);
        pending.splice(0, end + 1);
        if (conflict) onConflict(conflict.id, conflict.corrupt);
      } catch (error) {
        const index = pending.indexOf(entry);
        // Drop only this writer; retain just its fail-safe Personal intent.
        const personal = Object.fromEntries(Object.entries(entry.patch.projectTags ?? {}).filter(([, tag]) => tag === 'personal'));
        if (Object.keys(personal).length) pending.splice(index, 1, { patch: { projectTags: personal }, expected: Promise.resolve(new Map()) });
        else pending.splice(index, 1);
        throw error;
      } finally { publish(); }
    });
    queue = write.catch(() => {});
    return write;
  };
  const reload = async () => {
    await queue;
    if (!loaded) return load();
    const started = revision;
    const { value, records } = await readPrefs();
    if (started === revision) { saved = value; confirm(records); publish(); }
  };
  const adoptPersonal = (tags: Record<string, TagRecord>) => {
    const updates = Object.fromEntries(Object.entries(tags).filter(([id, record]) => record.value !== 'work'
      && view().projectTags[id] === 'work' && newerTag(record, confirmed.get(id) ?? { rev: -1 }))
      .map(([id, record]) => { confirmed.set(id, record); return [id, record.value ?? null]; }));
    if (!Object.keys(updates).length) return;
    revision++;
    saved = apply(saved, { projectTags: updates });
    publish();
    onConflict();
  };
  return { load, reload, patch, view, adoptPersonal, resetTag: (id: string) => patch({ projectTags: { [id]: 'personal' } }, id), idle: () => queue };
};
