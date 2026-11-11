import type { BoardTab } from '../store/prefs.ts';
import { el } from './dom.ts';

let nextId = 0;
export const mountBoardTabs = (root: Element, onChange: (tab: BoardTab) => void) => {
  const prefix = `kb-tabs-${++nextId}`;
  const list = el('div', 'kb-tabs'); list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', 'Kanban views');
  root.append(list);
  let desired: BoardTab = 'board';
  const available = { board: true, harness: false, cockpit: false };
  const entries = (['board', 'harness', 'cockpit'] as const).map(id => {
    const button = el('button', 'kb-tab', id[0]!.toUpperCase() + id.slice(1)); button.type = 'button';
    button.id = `${prefix}-${id}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `${button.id}-panel`);
    const panel = el('div', 'kb-tabpanel'); panel.id = `${button.id}-panel`;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0;
    list.append(button); root.append(panel);
    button.addEventListener('click', () => { desired = id; render(); onChange(id); });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const visible = entries.filter(entry => available[entry.id]);
      const index = visible.findIndex(entry => entry.id === id);
      const next = visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length]!;
      desired = next.id; render(); onChange(next.id); next.button.focus();
    });
    return { id, button, panel };
  });
  const render = () => {
    const selected = available[desired] ? desired : 'board';
    for (const entry of entries) {
      entry.button.hidden = !available[entry.id];
      entry.button.setAttribute('aria-selected', String(entry.id === selected));
      entry.button.tabIndex = entry.id === selected ? 0 : -1;
      entry.panel.hidden = entry.id !== selected;
    }
  };
  render();
  return {
    panels: Object.fromEntries(entries.map(entry => [entry.id, entry.panel])) as Record<BoardTab, HTMLDivElement>,
    setSelected: (tab: BoardTab) => { desired = tab; render(); },
    setAvailable: (id: 'harness' | 'cockpit', value: boolean) => { available[id] = value; render(); },
  };
};
