import { DEFAULT_PREFS, loadPrefs, savePrefs, saveProjectTag, type Prefs, type ProjectTag } from './prefs.ts';

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
export const createPrefsStore = (host: Host, changed: (prefs: Prefs) => void = () => {}) => {
  let saved: Prefs = { ...DEFAULT_PREFS };
  let pending: PrefsPatch[] = [];
  let loading: Promise<void> | null = null;
  let loaded = false;
  let revision = 0;
  let queue: Promise<void> = Promise.resolve();
  // Work only takes effect once confirmed; Personal takes effect immediately.
  const view = () => pending.reduce<Prefs>((prefs, patch) => apply(prefs, {
    ...patch, projectTags: Object.fromEntries(Object.entries(patch.projectTags ?? {}).filter(([, tag]) => tag !== 'work')),
  }), saved);
  const publish = () => changed(view());
  const load = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (!loading) loading = loadPrefs(host).then(value => { saved = value; loaded = true; publish(); }).finally(() => { loading = null; });
    return loading;
  };
  const patch = (patch: PrefsPatch): Promise<void> => {
    // Copy the writer's fields so later mutations cannot alter an in-flight write.
    const entry = structuredClone(patch);
    revision++;
    pending.push(entry); publish();
    const write = queue.then(async () => {
      try {
        await load();
        const end = pending.indexOf(entry);
        const patches = pending.slice(0, end + 1);
        const value = patches.reduce(apply, await loadPrefs(host));
        // Only fields this instance actually changed can be written.
        const tagChanges = Object.assign({}, ...patches.map(patch => patch.projectTags ?? {})) as Record<string, ProjectTag | null>;
        for (const [id, tag] of Object.entries(tagChanges)) await saveProjectTag(host, id, tag);
        if (patches.some(patch => Object.keys(patch).some(key => key !== 'projectTags'))) await savePrefs(host, value);
        saved = value;
        pending.splice(0, end + 1);
      } catch (error) {
        const index = pending.indexOf(entry);
        // Drop only this writer; retain just its fail-safe Personal intent.
        const personal = Object.fromEntries(Object.entries(entry.projectTags ?? {}).filter(([, tag]) => tag === 'personal'));
        if (Object.keys(personal).length) pending.splice(index, 1, { projectTags: personal });
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
    const value = await loadPrefs(host);
    if (started === revision) { saved = value; publish(); }
  };
  return { load, reload, patch, view, idle: () => queue };
};
