import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient, JsonValue } from '@openchamber/sdk';
import { createTask } from '../src/domain/task.ts';
import { deleteTask, loadTasks, saveTask, taskKey } from '../src/store/taskStore.ts';
import { DEFAULT_PREFS, saveProjectTag, loadPrefs, savePrefs, parsePrefs } from '../src/store/prefs.ts';
import { DISMISSED_SESSIONS_KEY, loadDismissedSessions, saveDismissedSessions } from '../src/store/dismissedSessions.ts';

/** In-memory stand-in for host.storage that serializes like the host (JSON, 64 KiB per value). */
const fakeHost = () => {
  const data = new Map<string, string>();
  const host: Pick<HostClient, 'storage'> = {
    storage: {
      get: async (key) => (data.has(key) ? (JSON.parse(data.get(key)!) as JsonValue) : undefined),
      set: async (key, value) => {
        const text = JSON.stringify(value);
        if (new TextEncoder().encode(text).length > 65536) throw new Error('too large');
        data.set(key, text);
      },
      delete: async (key) => { data.delete(key); },
      keys: async () => [...data.keys()],
    },
  };
  return { host, data };
};

test('three tasks persist across a fresh load (simulated reload)', async () => {
  const { host } = fakeHost();
  const titles = ['one', 'two', 'three'];
  for (const [i, title] of titles.entries()) await saveTask(host, createTask({ title }, (i + 1) * 1024, 1000 + i));
  const { tasks, failedKeys } = await loadTasks(host);
  assert.deepEqual(failedKeys, []);
  assert.deepEqual(tasks.map((t) => t.title).sort(), [...titles].sort());
});

test('a status change persists', async () => {
  const { host } = fakeHost();
  const task = createTask({ title: 'move me', status: 'todo' }, 1024);
  await saveTask(host, task);
  await saveTask(host, { ...task, status: 'in_progress' });
  const { tasks } = await loadTasks(host);
  assert.equal(tasks[0]?.status, 'in_progress');
});

test('session link persists and malformed records are reported, not dropped silently', async () => {
  const { host, data } = fakeHost();
  const task = createTask({ title: 'linked' }, 1024);
  await saveTask(host, { ...task, sessionId: 'ses_abc' });
  data.set('task:t_broken000000', JSON.stringify({ nope: true }));
  data.set('prefs', JSON.stringify({ projectId: 'p1' }));
  const { tasks, failedKeys } = await loadTasks(host);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.sessionId, 'ses_abc');
  assert.deepEqual(failedKeys, ['task:t_broken000000']);
  assert.equal(data.has('task:t_broken000000'), true, 'broken records are left untouched');
});

test('deleteTask removes only that record', async () => {
  const { host, data } = fakeHost();
  const a = createTask({ title: 'a' }, 1, 1, 't_aaaaaaaa');
  const b = createTask({ title: 'b' }, 2, 1, 't_bbbbbbbb');
  await saveTask(host, a);
  await saveTask(host, b);
  await deleteTask(host, a.id);
  assert.deepEqual([...data.keys()], [taskKey(b.id)]);
});

test('a maximum-size description fits in one storage value', async () => {
  const { host } = fakeHost();
  await saveTask(host, createTask({ title: 'big', description: 'é'.repeat(16000) }, 1));
  assert.equal((await loadTasks(host)).tasks.length, 1);
});

test('prefs round-trip and fall back to defaults on junk', async () => {
  const { host, data } = fakeHost();
  assert.deepEqual(await loadPrefs(host), DEFAULT_PREFS);
  await savePrefs(host, { ...DEFAULT_PREFS, projectId: 'p9', query: 'login', openTaskId: 't_x' });
  assert.deepEqual(await loadPrefs(host), { ...DEFAULT_PREFS, projectId: 'p9', query: 'login', openTaskId: 't_x' });
  data.set('prefs', JSON.stringify(['junk']));
  assert.deepEqual(await loadPrefs(host), DEFAULT_PREFS);
});

test('dismissed session ids persist across reload and ignore malformed stored values', async () => {
  const { host, data } = fakeHost();
  const dismissed = await loadDismissedSessions(host);
  assert.deepEqual([...dismissed], []);

  dismissed.add('ses_deleted');
  dismissed.add('ses_archived');
  await saveDismissedSessions(host, dismissed);
  assert.deepEqual([...(await loadDismissedSessions(host))].sort(), ['ses_archived', 'ses_deleted']);

  data.set(DISMISSED_SESSIONS_KEY, JSON.stringify(['ses_kept', '', 42, null]));
  assert.deepEqual([...await loadDismissedSessions(host)], ['ses_kept']);
});


test('tab and project tags persist, while malformed preferences default to Board and Personal', async () => {
  const { host } = fakeHost();
  const prefs = { ...DEFAULT_PREFS, activeTab: 'cockpit' as const, projectTags: { p: 'work' as const, home: 'personal' as const } };
  await savePrefs(host, prefs);
  for (const [id, tag] of Object.entries(prefs.projectTags)) await saveProjectTag(host, id, tag);
  assert.deepEqual(await loadPrefs(host), prefs);
  const parsed = parsePrefs({ activeTab: 'unknown', projectTags: { p: 'work', home: 'personal', bad: 'WORK', other: null } });
  assert.equal(parsed.activeTab, 'board');
  assert.deepEqual(parsed.projectTags, { p: 'work', home: 'personal' });
  for (const projectTags of [null, ['work'], 'work']) assert.deepEqual(parsePrefs({ projectTags }).projectTags, {});
  assert.equal(parsePrefs(JSON.parse('{"projectTags":{"__proto__":"work"}}')).projectTags.__proto__, 'work');
});
