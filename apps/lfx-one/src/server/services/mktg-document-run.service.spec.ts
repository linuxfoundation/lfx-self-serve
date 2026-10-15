// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string> }>());
const flows = vi.hoisted(() => ({ getResult: vi.fn(), getProjectById: vi.fn() }));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-store.utils'));
vi.mock('./brand-kit.service', () => ({
  BrandKitService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./foundation-message.service', () => ({
  FoundationMessageService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./icp.service', () => ({
  IcpService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = flows.getProjectById;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn() } }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async getObject(_req: unknown, _purpose: string, key: string) {
      return objects.get(key) ?? null;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key }));
    }
    public async putContentAddressedObject(
      _req: unknown,
      _purpose: string,
      key: string,
      body: Buffer,
      _type: string,
      _cache: string,
      metadata: Record<string, string>,
      options: { refreshMetadataWhen?: (metadata: Record<string, string>) => boolean }
    ) {
      const previous = objects.get(key);
      if (previous && !options.refreshMetadataWhen?.(previous.metadata)) {
        return false;
      }
      objects.set(key, { body: body.toString('utf8'), metadata });
      return true;
    }
  },
}));

import { MktgDocumentRunService } from './mktg-document-run.service';
const req = {} as Request;
const project = 'synthetic-project';
const runId = createHash('sha256').update('synthetic-session').digest('hex');
const location = { agentKey: 'brand-kit', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
const ready = { status: 'ready', version: 1, documentMarkdown: '# Synthetic', persistence: { document: location } };

describe('MktgDocumentRunService', () => {
  let service: MktgDocumentRunService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-15T12:00:00.000Z');
    vi.clearAllMocks();
    objects.clear();
    flows.getResult.mockResolvedValue({ status: 'pending' });
    flows.getProjectById.mockResolvedValue({ uid: project, writer: true });
    service = new MktgDocumentRunService();
  });
  afterEach(() => vi.useRealTimers());

  it('shape-gates and requires writer access before returning a storage partition', async () => {
    await expect(service.resolveProject(req, '../other')).rejects.toThrow();
    expect(flows.getProjectById).not.toHaveBeenCalled();
    flows.getProjectById.mockResolvedValueOnce({ uid: project, writer: false });
    await expect(service.resolveProject(req, project)).rejects.toThrow('write access');
    await expect(service.resolveProject(req, ' supplied-project ')).resolves.toBe(project);
  });

  it('records a session once and exposes only sanitized progress to a fresh reader', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    const original = [...objects.values()][0].body;
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    expect(objects.size).toBe(1);
    expect([...objects.values()][0].body).toBe(original);
    const publicRuns = await new MktgDocumentRunService().reconcile(req, project);
    expect(publicRuns).toEqual([{ project, runId, agentKey: 'brand-kit', documentId: 'living', startedAt: '2026-10-15T12:00:00.000Z', state: 'writing' }]);
    expect(JSON.stringify(publicRuns)).not.toContain('synthetic-session');
    expect(JSON.stringify(publicRuns)).not.toContain('opaque-subject');
    expect(JSON.stringify(publicRuns)).not.toContain('ownerToken');
  });

  it('records the finished revision through the existing result flow and skips later sequential completions', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    flows.getResult.mockResolvedValue(ready);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
    expect(flows.getResult).toHaveBeenCalledTimes(1);
    expect([...objects.values()][0].metadata).toMatchObject({ state: 'completed', 'revision-id': location.revisionId });
  });

  it('keeps storing visible without a receipt, then completes on a later browser read', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    flows.getResult.mockResolvedValueOnce({ status: 'ready', version: 1 });
    expect((await service.reconcile(req, project))[0].state).toBe('storing');
    flows.getResult.mockResolvedValue(ready);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
  });

  it('checks an old finished session before applying the pending timeout', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    vi.setSystemTime('2026-10-16T12:00:00.000Z');
    flows.getResult.mockResolvedValue(ready);
    expect(await service.reconcile(req, project)).toEqual([]);
  });

  it('requires explicit retry after timeout, preserves start and never starts another session', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    vi.setSystemTime('2026-10-15T13:00:00.000Z');
    expect((await service.reconcile(req, project))[0].state).toBe('failed');
    flows.getResult.mockClear();
    await service.reconcile(req, project);
    expect(flows.getResult).not.toHaveBeenCalled();
    await expect(service.retry(req, project, 'icp', 'living', runId)).rejects.toThrow();
    await service.retry(req, project, 'brand-kit', 'living', runId);
    expect((await service.reconcile(req, project))[0]).toMatchObject({ state: 'writing', startedAt: '2026-10-15T12:00:00.000Z' });
  });

  it('advances a reused session only for a newer intake attempt, without replacing its body', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject');
    flows.getResult.mockResolvedValue(ready);
    await service.reconcile(req, project);
    const body = [...objects.values()][0].body;
    await service.start(req, project, 'brand-kit', 'synthetic-session', 'opaque-subject', 1);
    expect(objects.size).toBe(1);
    expect([...objects.values()][0].body).toBe(body);
    expect((await service.reconcile(req, project))[0].state).toBe('writing');
    expect(flows.getResult).toHaveBeenLastCalledWith(req, 'synthetic-session', project, undefined, 1);
  });
});
