import type { HostClient } from '@openchamber/sdk';
import { parseHarnessLane, type FileMetadata, type HarnessResponse } from '../domain/harness.ts';

const metadataValid = (value: unknown, file: string | null): boolean => {
  if (file === null) return value === null;
  if (!value || typeof value !== 'object') return false;
  const m = value as FileMetadata;
  return m.path === file && typeof m.exists === 'boolean' &&
    (m.size === undefined || (Number.isSafeInteger(m.size) && m.size >= 0)) &&
    (m.error === undefined || (m.error === 'unknown' && !m.exists && m.mtime === null)) &&
    (m.mtime === null || (typeof m.mtime === 'number' && Number.isFinite(m.mtime)));
};

const filteredValid = (value: unknown) => {
  const f = value as { roots?: unknown; dropped?: unknown } | null;
  return !!f && typeof f === 'object' && Array.isArray(f.roots) && f.roots.every(r => typeof r === 'string') &&
    Number.isSafeInteger(f.dropped) && (f.dropped as number) >= 0;
};

export const fetchHarnessLanes = async (host: Pick<HostClient, 'serviceRequest'>): Promise<HarnessResponse> => {
  const response = await host.serviceRequest({ method: 'GET', path: '/harness-lanes' });
  if (response.status !== 200) throw new Error('Harness service unavailable (' + response.status + ')');
  const body = JSON.parse(response.body) as HarnessResponse;
  if (!body || !Array.isArray(body.lanes)) throw new Error('Invalid harness feed response');
  if ((body.file === 'missing' || body.file === 'not-regular') && body.lanes.length === 0) {
    if (body.filtered !== undefined && !filteredValid(body.filtered)) throw new Error('Invalid harness feed response');
    return { ...body, rejected: 0, rejectedLines: [] };
  }
  if (body.file !== 'ok' || body.lanes.length > 200 || !Number.isSafeInteger(body.rejected) || body.rejected < 0 ||
      (body.truncated !== undefined && typeof body.truncated !== 'boolean') ||
      (body.filtered !== undefined && !filteredValid(body.filtered)) ||
      !Array.isArray(body.rejectedLines) || body.rejectedLines.length !== Math.min(body.rejected, 50) ||
      body.rejectedLines.some(n => !Number.isSafeInteger(n) || n < 1) ||
      body.lanes.some(lane => !parseHarnessLane(lane) || !['running', 'review', 'failed', 'lost'].includes(lane.status) ||
        !metadataValid(lane.reportFile, lane.report) || !metadataValid(lane.logFile, lane.log))) {
    throw new Error('Invalid harness feed response');
  }
  return body;
};
