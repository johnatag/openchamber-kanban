import type { Prefs } from '../store/prefs.ts';
import type { HostClient } from '@openchamber/sdk';
import { slimCockpitTasks, type CockpitResponse } from '../domain/cockpit.ts';

export const fetchCockpitTasks = async (host: Pick<HostClient, 'serviceRequest'>, prefs?: Pick<Prefs, 'cockpitEmail' | 'cockpitMode' | 'cockpitSubtasks'>): Promise<CockpitResponse> => {
  try {
    const response = await host.serviceRequest({ method: 'GET', path: '/cockpit-tasks' + (prefs ? '?' + new URLSearchParams({ email: prefs.cockpitEmail, mode: prefs.cockpitMode, subtasks: String(prefs.cockpitSubtasks) }) : '') });
    if (response.status !== 200) return { status: 'unavailable', reason: 'Cockpit local service unavailable (' + response.status + ')' };
    const body = JSON.parse(response.body);
    if (body?.status === 'unavailable' && typeof body.reason === 'string' && body.reason.length > 0 && body.reason.length <= 512) return { status: 'unavailable', reason: body.reason };
    if (body?.status === 'ok') {
      return { status: 'ok', tasks: slimCockpitTasks(body.tasks), cancelledHidden: Number.isSafeInteger(body.cancelledHidden) && body.cancelledHidden >= 0 ? body.cancelledHidden : 0 };
    }
    throw new Error('Invalid response');
  } catch { return { status: 'unavailable', reason: 'Cockpit local service returned no valid task data' }; }
};
