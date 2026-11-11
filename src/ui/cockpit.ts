import type { HostClient } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';
import { COCKPIT_STATUSES, filterCockpitTasks, type CockpitResponse, type CockpitTask } from '../domain/cockpit.ts';
import { fetchCockpitTasks } from '../host/cockpitService.ts';
import { type Prefs } from '../store/prefs.ts';
import { el } from './dom.ts';

type CockpitPrefs = Pick<Prefs, 'cockpitEmail' | 'cockpitMode' | 'cockpitSubtasks'>;
export const mountCockpitFeed = (host: Pick<HostClient, 'serviceRequest' | 'toast' | 'openUrl'>, root: Element,
  onPrefs: (patch: CockpitPrefs) => Promise<void>, onTasks: (tasks: CockpitTask[]) => void, onAvailable: (available: boolean) => void = () => {}) => {
  const section = el('section', 'kb-section kb-cockpit'); section.setAttribute('aria-label', 'Cockpit tasks');
  section.append(el('h2', 'kb-section-title', 'Cockpit'));
  const controls = el('div', 'kb-row');
  const label = el('label', '', 'Your Cockpit email ');
  const email = el('input'); email.type = 'email'; email.setAttribute('aria-label', 'Your Cockpit email'); label.append(email); controls.append(label);
  const mode = el('select'); mode.setAttribute('aria-label', 'Cockpit task filter');
  for (const [value, title] of [['mine', 'Mine'], ['all_in_progress', 'All in progress']]) { const option = el('option', '', title); option.value = value!; mode.append(option); }
  const subLabel = el('label', '', 'Include subtasks '); const subtasks = el('input'); subtasks.type = 'checkbox'; subLabel.append(subtasks);
  controls.append(mode, subLabel); section.append(controls);
  const message = el('div', 'kb-muted'); message.setAttribute('role', 'status');
  const groups = el('div', 'kb-columns'); section.append(message, groups); root.append(section);
  let prefs: CockpitPrefs = { cockpitEmail: '', cockpitMode: 'mine', cockpitSubtasks: false };
  let result: CockpitResponse | null = null;
  let enabled = false; let generation = 0;
  let disposed = false; let busy = false; let frameVisible = true; let ready = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const render = () => {
    groups.replaceChildren();
    onAvailable(!prefs.cockpitEmail || !result || result.status === 'unavailable' || result.tasks.some(task => task.status !== 'done') || (result.cancelledHidden ?? 0) > 0);
    if (!prefs.cockpitEmail) { message.textContent = 'Set your Cockpit email to see your work.' + (result?.status === 'unavailable' ? ' Cockpit unavailable: ' + result.reason : ''); return; }
    if (!result) { message.textContent = 'Loading Cockpit tasks…'; return; }
    if (result.status === 'unavailable') { message.textContent = 'Cockpit unavailable: ' + result.reason; return; }
    const visible = filterCockpitTasks(result.tasks, prefs.cockpitEmail, prefs.cockpitMode, prefs.cockpitSubtasks);
    message.textContent = (visible.length ? 'Read-only · updated every 60 seconds' : 'No matching open Cockpit tasks') + (result.cancelledHidden ? ' · ' + result.cancelledHidden + ' cancelled hidden' : '');
    for (const status of COCKPIT_STATUSES) {
      const tasks = visible.filter(t => t.status === status); if (!tasks.length) continue;
      const group = el('div', 'kb-column'); group.append(el('h3', 'kb-column-head', status.replaceAll('_', ' ')));
      const body = el('div', 'kb-column-body'); group.append(body);
      for (const task of tasks) {
        const card = el('article', 'kb-card kb-harness-card');
        card.append(el('div', 'kb-mono', task.key), el('div', 'kb-card-title', task.title),
          el('div', 'kb-card-meta', status + ' · Priority: ' + (task.priority ?? '—') + ' · ' + (task.spentHours ?? '—') + '/' + (task.estimateHours ?? '—') + 'h'));
        if (task.prUrl && /^https?:\/\//i.test(task.prUrl)) mountButton(card, { label: 'Open PR', variant: 'ghost', size: 'xs', onClick: () => { void host.openUrl(task.prUrl!).catch(() => { message.textContent = 'Could not open PR link'; }); } });
        mountButton(card, { label: 'Copy key', variant: 'ghost', size: 'xs', onClick: () => {
          void (async () => {
            try { await navigator.clipboard.writeText(task.key); }
            catch { try { await host.toast({ kind: 'info', message: 'Copy Cockpit key', copy: { text: task.key } }); } catch { message.textContent = 'Could not copy Cockpit key'; } }
          })();
        } });
        body.append(card);
      }
      groups.append(group);
    }
  };
  const updateControls = () => { email.value = prefs.cockpitEmail; mode.value = prefs.cockpitMode; subtasks.checked = prefs.cockpitSubtasks; render(); };
  const changed = () => {
    if (!email.validity.valid || !email.value.trim()) { message.textContent = 'Enter a valid Cockpit email.'; return; }
    const next: CockpitPrefs = { cockpitEmail: email.value.trim().toLowerCase(), cockpitMode: mode.value === 'all_in_progress' ? 'all_in_progress' : 'mine', cockpitSubtasks: subtasks.checked };
    void onPrefs(next).then(() => { if (!disposed) { setPrefs(next); } }, () => { if (!disposed) message.textContent = 'Could not save Cockpit preferences'; });
  };
  mountButton(controls, { label: 'Save email', variant: 'secondary', onClick: changed });
  mode.addEventListener('change', changed); subtasks.addEventListener('change', changed);
  const poll = async () => {
    if (!ready || !enabled || !prefs.cockpitEmail || disposed || busy || !frameVisible || document.hidden) return;
    busy = true; const started = generation;
    try {
      const next = await fetchCockpitTasks(host);
      if (disposed || started !== generation || !enabled || !prefs.cockpitEmail) return;
      result = next;
      onTasks(result.status === 'ok' ? result.tasks : []); render();
    } finally { busy = false; if (started !== generation) { void poll(); } else if (!disposed && enabled && prefs.cockpitEmail && frameVisible && !document.hidden) timer = setTimeout(() => { void poll(); }, 60_000); }
  };
  const visibility = () => { if (timer) clearTimeout(timer); timer = null; if (frameVisible && !document.hidden) void poll(); };
  const hide = () => { frameVisible = false; visibility(); }; const show = () => { frameVisible = true; visibility(); };
  window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); document.addEventListener('visibilitychange', visibility);
  const setPrefs = (value: CockpitPrefs, allowed = enabled) => {
    const changed = !ready || prefs.cockpitEmail !== value.cockpitEmail || allowed !== enabled;
    prefs = value; enabled = allowed; ready = true;
    if (changed) { generation++; result = null; if (timer) clearTimeout(timer); timer = null; onTasks([]); }
    updateControls(); if (changed) void poll();
  };
  render();
  return {
    setPrefs,
    setEnabled: (value: boolean) => {
      if (enabled === value) return;
      enabled = value; generation++;
      if (timer) clearTimeout(timer); timer = null;
      if (!enabled) { result = null; onTasks([]); render(); } else void poll();
    },
    dispose: () => { disposed = true; if (timer) clearTimeout(timer); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); document.removeEventListener('visibilitychange', visibility); section.remove(); },
  };
};
