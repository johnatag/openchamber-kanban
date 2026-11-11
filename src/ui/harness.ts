import type { HostClient } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';
import { fetchHarnessLanes } from '../host/harnessService.ts';
import { describeHostError } from '../host/workspace.ts';
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
  let disposed = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (disposed || document.hidden || busy) return;
    busy = true;
    try {
      const result = await fetchHarnessLanes(host);
      if (disposed) return;
      cards.replaceChildren();
      message.textContent = result.file === 'missing' ? 'Harness feed file is missing.' :
        result.rejected ? 'Skipped ' + result.rejected + ' malformed feed record(s), lines: ' + result.rejectedLines.join(', ') :
        result.lanes.length ? 'Read-only activity · updated every 15 seconds' : 'No harness activity';
      for (const lane of result.lanes) {
        const card = el('article', 'kb-card kb-harness-card');
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
    } catch (error) {
      if (!disposed) {
        cards.replaceChildren();
        message.textContent = 'Harness activity unavailable: ' + describeHostError(error);
      }
    } finally {
      busy = false;
      if (!disposed && !document.hidden) timer = setTimeout(() => { void poll(); }, 15000);
    }
  };
  const onVisibility = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!document.hidden) void poll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  void poll();
  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      section.remove();
    },
  };
};
