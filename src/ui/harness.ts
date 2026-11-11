import type { HostClient } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';
import { fetchHarnessLanes } from '../host/harnessService.ts';
import { describeHostError } from '../host/workspace.ts';
import { linkedCockpitTasks, type CockpitTask } from '../domain/cockpit.ts';
import { el } from './dom.ts';

export const mountHarnessFeed = (host: Pick<HostClient, 'serviceRequest' | 'toast'>, root: Element) => {
  const section = el('section', 'kb-section kb-harness');
  section.setAttribute('aria-label', 'Harness activity');
  section.append(el('h2', 'kb-section-title', 'Harness'));
  const message = el('div', 'kb-muted', 'Loading harness activity…');
  message.setAttribute('role', 'status');
  const cards = el('div', 'kb-harness-cards');
  section.append(message, cards);
  root.append(section);
  let cockpitTasks: CockpitTask[] = [];
  const annotate = () => {
    for (const card of cards.querySelectorAll<HTMLElement>('.kb-harness-card')) {
      card.querySelector('.kb-cockpit-link')?.remove();
      const links = linkedCockpitTasks(cockpitTasks, card.dataset.title, card.dataset.branch);
      if (links.length) card.append(el('div', 'kb-mono kb-cockpit-link', links.map(t => t.key + ' · ' + t.status).join(', ')));
    }
  };
  let disposed = false;
  let busy = false;
  let frameVisible = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (disposed || !frameVisible || document.hidden || busy) return;
    busy = true;
    try {
      const result = await fetchHarnessLanes(host);
      if (disposed) return;
      cards.replaceChildren();
      const notices: string[] = [];
      if (result.truncated) notices.push('Feed truncated: read only the last 4 MiB.');
      if (result.rejected) notices.push('Skipped ' + result.rejected + ' malformed feed record(s), lines: ' + result.rejectedLines.join(', ') + (result.rejected > result.rejectedLines.length ? ' (first 50 shown)' : ''));
      message.textContent = result.file === 'missing' ? 'Harness feed file is missing.' :
        result.file === 'not-regular' ? 'Harness feed is not a regular file.' :
        notices.length ? notices.join(' ') :
        result.lanes.length ? 'Read-only activity · updated every 15 seconds' : 'No harness activity';
      for (const lane of result.lanes) {
        const card = el('article', 'kb-card kb-harness-card');
        card.dataset.title = lane.title;
        card.dataset.branch = lane.branch ?? '';
        card.append(el('div', 'kb-card-title', lane.title));
        const project = lane.project?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'No project';
        const age = Math.max(0, Math.floor((Date.now() - Date.parse(lane.startedAt)) / 60000));
        const meta = el('div', 'kb-card-meta', lane.kind + ' · ' + project + ' · ' + lane.status + ' · ' + age + 'm ago');
        meta.title = lane.startedAt;
        card.append(meta);
        if (lane.report) {
          const report = el('div', 'kb-harness-path', lane.report);
          card.append(report);
          const copy = mountButton(card, {
            label: 'Copy report path', size: 'xs', variant: 'ghost',
            onClick: () => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(lane.report!);
                  copy.update({ label: 'Copied' });
                } catch (error) {
                  // The host owns a working clipboard helper even when the iframe blocks clipboard access.
                  try { await host.toast({ kind: 'info', message: 'Copy report path', copy: { text: lane.report! } }); }
                  catch (hostError) { message.textContent = 'Could not copy report path: ' + describeHostError(hostError); }
                }
              })();
            },
          });
        }
        cards.append(card);
      }
      annotate();
    } catch (error) {
      if (!disposed) {
        cards.replaceChildren();
        message.textContent = 'Harness activity unavailable: ' + describeHostError(error);
      }
    } finally {
      busy = false;
      if (!disposed && frameVisible && !document.hidden) timer = setTimeout(() => { void poll(); }, 15000);
    }
  };
  const onVisibility = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (frameVisible && !document.hidden) void poll();
  };
  // SDK 2.3.2 has no frame visibility/unmount subscription. Page lifecycle
  // events complement document visibility; the board owns explicit disposal.
  const onPageHide = () => { frameVisible = false; onVisibility(); };
  const onPageShow = () => { frameVisible = true; onVisibility(); };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  void poll();
  return {
    setCockpitTasks: (tasks: CockpitTask[]) => { cockpitTasks = tasks; annotate(); },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      section.remove();
    },
  };
};
