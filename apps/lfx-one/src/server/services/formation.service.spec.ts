// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationQueueRow, QueryServiceResponse, UpstreamFormationChecklist, UpstreamFormationItem } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';

const getProjectById = vi.fn();
const getProjectIdBySlug = vi.fn();
const getProjectSettings = vi.fn();
const canComplete = vi.fn();
const natsRequest = vi.fn();
const proxyRequest = vi.fn();

vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = getProjectById;
    public getProjectIdBySlug = getProjectIdBySlug;
    public getProjectSettings = getProjectSettings;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
  },
}));
vi.mock('./formation-item-access.service', () => ({
  formationItemAccessService: { canComplete: (...args: unknown[]) => canComplete(...args) },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// NatsService only backs resolveRootProjectUid's ROOT slug->uid lookup here (GH-2267 Phase 4). No
// test in this file exercises the ROOT-collapse branch itself except the dedicated ROOT-collapse
// test below, which overrides this default — a resolved-but-empty response keeps every other test
// fast and keeps collapseRootParentUid a no-op. `root-project.helper.ts` has no dedicated spec yet —
// the collapse logic is only exercised indirectly through here.
vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(() => ({
    getCodec: () => ({
      encode: (v: string) => v,
      decode: (v: unknown) => v as string,
    }),
    request: natsRequest,
  })),
}));

const { FormationService } = await import('./formation.service');
const { resetRootProjectUidCacheForTests } = await import('../helpers/root-project.helper');
const { logger } = await import('./logger.service');

function buildReq(): Request {
  return { path: '/api/formations/x/items/y' } as unknown as Request;
}

/** One upstream checklist item — defaults to a plain, non-gating, `not_started` manual item. */
function rawItem(overrides: Partial<UpstreamFormationItem> = {}): UpstreamFormationItem {
  return {
    uid: 'formation-item:live-project-1:item-key-1',
    item_key: 'item-key-1',
    section_key: 'section-1',
    position: 1,
    title: 'Some item',
    gate: false,
    requires_writer: false,
    status_source: 'manual',
    is_required: true,
    checklist_type: 'manual',
    status: 'not_started',
    version: 1,
    ...overrides,
  };
}

/** One upstream checklist read — a single section holding whichever items the test supplies. */
function checklist(items: UpstreamFormationItem[], overrides: Partial<UpstreamFormationChecklist> = {}): UpstreamFormationChecklist {
  return {
    project_uid: 'live-project-1',
    template_uid: 'template-1',
    template_version: 1,
    lifecycle: 'live',
    sections: [{ key: 'section-1', title: 'Section', position: 1 }],
    items,
    is_activating: false,
    ...overrides,
  };
}

describe('FormationService', () => {
  const service = new FormationService();

  beforeEach(() => {
    getProjectById.mockReset();
    getProjectIdBySlug.mockReset();
    getProjectSettings.mockReset();
    canComplete.mockReset();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warning).mockClear();
    natsRequest.mockReset();
    natsRequest.mockResolvedValue({ data: '' });
    resetRootProjectUidCacheForTests();
    proxyRequest.mockReset();
    getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
    getProjectIdBySlug.mockResolvedValue({ uid: 'live-project-1', exists: true });
    getProjectSettings.mockResolvedValue({ announcement_date: null });
    canComplete.mockResolvedValue(true);
  });

  describe('getProjectFormation', () => {
    it('throws ResourceNotFoundError when the project does not exist for this caller', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: undefined, exists: false });

      await expect(service.getProjectFormation(buildReq(), 'does-not-exist')).rejects.toThrow(/not found/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('maps a live checklist read to FormationChecklistResponse', async () => {
      getProjectSettings.mockResolvedValue({ announcement_date: '2026-10-01' });
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ gate: true, section_key: 'legal_and_entity' })], {
          sections: [{ key: 'legal_and_entity', title: 'Legal and entity', position: 1 }],
        })
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.template).not.toBeNull();
      expect(result.template?.uid).toBe('template-1');
      expect(result.template?.sections).toEqual([{ key: 'legal_and_entity', title: 'Legal and entity', items: [] }]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].template_item_key).toBe('item-key-1');
      expect(result.formation.announcement_date).toBe('2026-10-01');
      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);

      // ?v=1 is appended by MicroserviceProxyService.proxyRequest itself (DEFAULT_QUERY_PARAMS), not
      // by this call site — the path carries no query string of its own.
      const getCall = proxyRequest.mock.calls.find((call) => call[3] === 'GET' || call[3] === undefined);
      expect(getCall![2]).toBe('/formations/live-project-1');
    });

    it('masks an upstream 404 on the checklist read as a not-found Formation', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND'));

      await expect(service.getProjectFormation(buildReq(), 'live-project')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('masks an upstream 403 on the checklist read identically to a 404 (enumeration-oracle guard)', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));
      const forbidden = await service.getProjectFormation(buildReq(), 'live-project').catch((error: Error) => error);

      proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND'));
      const notFound = await service.getProjectFormation(buildReq(), 'live-project').catch((error: Error) => error);

      expect(forbidden).toMatchObject({ statusCode: 404 });
      expect((forbidden as Error).message).toBe((notFound as Error).message);
    });

    it('collapses a ROOT-parented project to parent_uid null, independent of is_foundation', async () => {
      getProjectById.mockResolvedValue({
        slug: 'live-project',
        name: 'Live Project',
        parent_uid: 'root-uid',
        writer: true,
        stage: 'Active',
        legal_entity_type: 'Corporation',
        funding: 'Funded',
        funding_model: ['Membership'],
      });
      natsRequest.mockResolvedValue({ data: 'root-uid' });
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(true);
    });

    it('reports is_foundation false for a top-level project that fails computeIsFoundation, despite parent_uid null', async () => {
      // parent_uid collapsing to null must not itself imply is_foundation — the two are independent
      // axes (see deriveFormationEntityType). A project missing computeIsFoundation's criteria
      // (no stage/funding/funding_model set here) stays is_foundation:false even with no parent.
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(false);
    });

    it('counts a skipped gating item as still outstanding, matching upstream gate accounting', async () => {
      // Upstream's own gate accounting (gateSummaryFromItems/isActivating) treats `skipped` as not
      // yet done — only `status === 'done'` clears a gate. The live queue's gates_cleared is sourced
      // from that same projection, so this checklist path must agree.
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true, status: 'skipped', skip_reason: 'Not applicable' })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });

    it('degrades announcement_date to null when the project-settings read fails', async () => {
      getProjectSettings.mockRejectedValue(new Error('settings service unavailable'));
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.announcement_date).toBeNull();
    });

    it("prefers this response's own section title over the seeded template's when upstream has renamed a section", async () => {
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ section_key: 'legal_and_entity' })], {
          sections: [{ key: 'legal_and_entity', title: 'Legal & Entity (renamed)', position: 1 }],
        })
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('Legal & Entity (renamed)');
      expect(result.template?.sections[0].title).toBe('Legal & Entity (renamed)');
    });

    it('falls back to the raw section_key when a section is not in this response', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ section_key: 'unrecognized-section' })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('unrecognized-section');
    });

    it('keeps gating counts derived from the checklist, not the post-enrichment array, when a gating item is dropped by enrichItems', async () => {
      // The one gating item's own canComplete enrichment rejects, so enrichItems drops it from
      // `items[]` (Promise.allSettled graceful-degradation) — the rollup on `formation` must still
      // reflect the checklist's real gating state (1 total, 1 open), not the post-drop empty array.
      canComplete.mockRejectedValueOnce(new Error('access-check backend unavailable'));
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true })]));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items).toHaveLength(0);
      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });

    it('drops an item that fails can_complete enrichment instead of failing the whole read', async () => {
      proxyRequest.mockResolvedValue(
        checklist([rawItem({ item_key: 'item-key-1' }), rawItem({ item_key: 'item-key-2', uid: 'formation-item:live-project-1:item-key-2' })])
      );
      canComplete.mockRejectedValueOnce(new Error('checkLFStaff unavailable')).mockResolvedValue(true);

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items).toHaveLength(1);
      expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
        expect.anything(),
        'enrich_formation_item',
        expect.stringContaining('dropping from response'),
        expect.objectContaining({ item_uid: expect.any(String), err: expect.any(Error) })
      );
    });
  });

  describe('getFormationItemDetail', () => {
    it('returns the enriched item with an empty history — the real activity feed is Phase 5', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getFormationItemDetail(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.item.template_item_key).toBe('item-key-1');
      expect(result.item.can_complete).toBe(true);
      expect(result.history).toEqual([]);
    });
  });

  describe('getFormationItemOrThrow — project-scoped read access', () => {
    it("resolves the item only after the caller's own bearer token can read the parent project", async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const result = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.template_item_key).toBe('item-key-1');
      expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_FORMATION_SERVICE', '/formations/live-project-1', 'GET');
    });

    it('denies with the same "not found" shape as a missing item key, rather than returning item data, for a project the caller cannot see', async () => {
      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));

      await expect(service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/not found/i);
    });

    it('throws ResourceNotFoundError for an item key not present in the checklist', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ item_key: 'other-key' })]));

      await expect(service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/not found/i);
    });

    it('gives the same address the identical error message whether the item key is missing or the project is denied — no enumeration oracle', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ item_key: 'other-key' })]));
      const missing = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1').catch((error: Error) => error);

      proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));
      const denied = await service.getFormationItemOrThrow(buildReq(), 'live-project-1', 'item-key-1').catch((error: Error) => error);

      expect((missing as Error).message).toBe((denied as Error).message);
    });
  });

  describe('project write access — complete/skip/update all require it', () => {
    // requestFormationItem is excluded here: it checks `item.action === 'request'` before the write
    // check, and no `FORMATION_TEMPLATE` item is currently configured with that action (see the
    // gate_writer describe below for its actual, reachable guard).
    it.each([
      ['completeFormationItem', (s: InstanceType<typeof FormationService>, req: Request) => s.completeFormationItem(req, 'live-project-1', 'item-key-1')],
      [
        'skipFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request) => s.skipFormationItem(req, 'live-project-1', 'item-key-1', 'a reason'),
      ],
      [
        'updateFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request) => s.updateFormationItem(req, 'live-project-1', 'item-key-1', { notes: 'x' }),
      ],
    ])('%s rejects a project viewer who is not a writer', async (_name, call) => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));
      getProjectById.mockResolvedValue({ writer: false });

      await expect(call(service, buildReq())).rejects.toThrow(/write access/i);
      expect(proxyRequest.mock.calls.some((c) => c[3] === 'PATCH' || c[3] === 'POST')).toBe(false);
    });

    it('resolves the write check with access=true (enriches with the writer flag), unlike the read check', async () => {
      const item = rawItem();
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'done', version: 2 });
        throw new Error('unexpected call');
      });

      await service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    });
  });

  describe('gate_writer gate — complete/skip/request', () => {
    it('completeFormationItem sets a gating item to awaiting_acceptance (not done) when canComplete denies, instead of throwing', async () => {
      const item = rawItem({ gate: true, status: 'in_progress' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'awaiting_acceptance', version: 2 });
        throw new Error('unexpected call');
      });
      canComplete.mockResolvedValue(false);

      const result = await service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('awaiting_acceptance');
      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall![5]).toMatchObject({ status: 'awaiting_acceptance' });
    });

    it('skipFormationItem rejects a gating item when canComplete denies, even with a reason supplied', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true })]));
      canComplete.mockResolvedValue(false);

      await expect(service.skipFormationItem(buildReq(), 'live-project-1', 'item-key-1', 'blocked upstream')).rejects.toThrow(/gate_writer/i);
      expect(proxyRequest.mock.calls.some((c) => c[3] === 'PATCH')).toBe(false);
    });

    it('requestFormationItem rejects an item whose action does not support the request affordance', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem()]));

      const error = await service.requestFormationItem(buildReq(), 'live-project-1', 'item-key-1').catch((err: ServiceValidationError) => err);

      expect(error).toBeInstanceOf(ServiceValidationError);
      expect((error as ServiceValidationError).validationErrors).toEqual([
        expect.objectContaining({ field: 'action', message: 'This item does not support the request action' }),
      ]);
      expect(proxyRequest.mock.calls.some((c) => c[3] === 'PATCH')).toBe(false);
    });

    it('completeFormationItem succeeds and marks the item done when canComplete allows', async () => {
      const item = rawItem({ gate: true, status: 'in_progress' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'done', version: 2 });
        throw new Error('unexpected call');
      });
      canComplete.mockResolvedValue(true);

      const result = await service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('done');
    });
  });

  describe('updateFormationItemStatus', () => {
    it('rejects reopening a gating item off done when canComplete denies', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true, status: 'done' })]));
      canComplete.mockResolvedValue(false);

      await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', 'not_started')).rejects.toThrow(/gate_writer/i);
      expect(proxyRequest.mock.calls.some((c) => c[3] === 'PATCH')).toBe(false);
    });

    it('rejects reopening a gating item off awaiting_acceptance when canComplete denies', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ gate: true, status: 'awaiting_acceptance' })]));
      canComplete.mockResolvedValue(false);

      await expect(service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', 'in_progress')).rejects.toThrow(/gate_writer/i);
    });

    it('allows reopening a gating item off done when canComplete allows', async () => {
      const item = rawItem({ gate: true, status: 'done' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'not_started', version: 2 });
        throw new Error('unexpected call');
      });
      canComplete.mockResolvedValue(true);

      const result = await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', 'not_started');

      expect(result.status).toBe('not_started');
    });

    it('does not gate a plain (non-gating) item transition on canComplete at all', async () => {
      const item = rawItem({ gate: false, status: 'done' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'not_started', version: 2 });
        throw new Error('unexpected call');
      });
      canComplete.mockResolvedValue(false);

      const result = await service.updateFormationItemStatus(buildReq(), 'live-project-1', 'item-key-1', 'not_started');

      expect(result.status).toBe('not_started');
    });
  });

  describe('skipFormationItem — reason required', () => {
    it('rejects an empty/whitespace-only reason before even resolving the item', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', '   ')).rejects.toThrow(/reason/i);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects a non-string reason instead of throwing a raw TypeError from .trim()', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', { not: 'a string' })).rejects.toThrow(/reason/i);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects a reason over 2000 characters', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', 'x'.repeat(2001))).rejects.toThrow(/reason/i);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('does not log the reason text on the general application logger', async () => {
      const item = rawItem({ gate: true, status: 'in_progress' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'skipped', version: 2 });
        throw new Error('unexpected call');
      });
      canComplete.mockResolvedValue(true);

      await service.skipFormationItem(buildReq(), 'live-project-1', 'item-key-1', 'a sensitive skip justification');

      const infoCalls = vi.mocked(logger.info).mock.calls;
      // Anchor on the call actually existing — otherwise a logger.info() that fired zero times
      // would pass this assertion too, which defeats the point of the test.
      expect(infoCalls.some((call) => call[1] === 'skip_formation_item')).toBe(true);
      expect(infoCalls.some((call) => JSON.stringify(call).includes('sensitive skip justification'))).toBe(false);
    });
  });

  describe('completeFormationItem — notes validation', () => {
    it('rejects a non-string notes value', async () => {
      await expect(service.completeFormationItem(buildReq(), 'project-x', 'item-x', { not: 'a string' })).rejects.toThrow(/notes/i);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects notes over 2000 characters', async () => {
      await expect(service.completeFormationItem(buildReq(), 'project-x', 'item-x', 'x'.repeat(2001))).rejects.toThrow(/notes/i);
    });
  });

  describe('completeFormationItem — live transport', () => {
    it('reads the checklist, PATCHes with If-Match, and maps the response', async () => {
      const item = rawItem({ status: 'in_progress', gate: true });
      proxyRequest.mockImplementation((_req, _service, path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'done', version: 4 });
        throw new Error(`unexpected call: ${method} ${path}`);
      });

      const result = await service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('done');
      expect(result.version).toBe(4);

      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall).toBeDefined();
      expect(patchCall![2]).toBe('/formations/live-project-1/items/item-key-1');
      expect(patchCall![6]).toEqual({ 'If-Match': '1' });
    });

    it("resolves section_title from the same checklist the pre-read cached, not the seeded template", async () => {
      const item = rawItem({ status: 'in_progress', gate: true, section_key: 'section-1' });
      const renamedChecklist: UpstreamFormationChecklist = {
        ...checklist([item]),
        sections: [{ key: 'section-1', title: 'Renamed Section', position: 1 }],
      };
      proxyRequest.mockImplementation((_req, _service, path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(renamedChecklist);
        if (method === 'PATCH') return Promise.resolve({ ...item, status: 'done', version: 4 });
        throw new Error(`unexpected call: ${method} ${path}`);
      });

      const result = await service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.section_title).toBe('Renamed Section');
    });

    it('maps a 412 from a live mutation to PreconditionFailedError', async () => {
      const item = rawItem({ status: 'in_progress', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') {
          return Promise.reject(new MicroserviceError('stale version', 412, 'PRECONDITION_FAILED', { errorBody: { message: 'version_mismatch' } }));
        }
        throw new Error('unexpected call');
      });

      await expect(service.completeFormationItem(buildReq(), 'live-project-1', 'item-key-1')).rejects.toMatchObject({ statusCode: 412 });
    });
  });

  describe('updateFormationItem — validation', () => {
    it('rejects a non-string notes value', async () => {
      await expect(service.updateFormationItem(buildReq(), 'project-x', 'item-x', { notes: 123 as unknown as string })).rejects.toThrow(/notes/i);
    });

    it('rejects an invalid due_date', async () => {
      await expect(service.updateFormationItem(buildReq(), 'project-x', 'item-x', { due_date: 'not-a-date' })).rejects.toThrow(/due_date/i);
    });

    it('rejects a non-string due_date (e.g. an array from a malformed body)', async () => {
      await expect(service.updateFormationItem(buildReq(), 'project-x', 'item-x', { due_date: ['2026-01-01'] as unknown as string })).rejects.toThrow(
        /due_date/i
      );
    });
  });

  describe('updateFormationItem — live transport', () => {
    it('clears note/assignee/due_date with empty strings, not null', async () => {
      const item = rawItem({ status: 'in_progress', note: 'old note', assignee: 'sam.chen', due_date: '2026-01-01' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, note: null, assignee: null, due_date: null, version: 2 });
        throw new Error('unexpected call');
      });

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', {
        notes: '',
        owner_username: '',
        due_date: null,
      });

      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall![5]).toEqual({ note: '', assignee: '', due_date: '' });
    });

    it('sends a YYYY-MM-DD due_date through unchanged', async () => {
      const item = rawItem({ status: 'in_progress', due_date: '2026-01-01' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, due_date: '2026-03-31', version: 2 });
        throw new Error('unexpected call');
      });

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', { due_date: '2026-03-31' });

      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall![5]).toEqual({ due_date: '2026-03-31' });
    });

    it('rejects a full ISO due_date datetime instead of silently truncating it to the wrong calendar day', async () => {
      const item = rawItem({ status: 'in_progress', due_date: '2026-01-01' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        throw new Error('unexpected call');
      });

      await expect(service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', { due_date: '2026-03-31T00:00:00.000Z' })).rejects.toThrow(
        ServiceValidationError
      );
      expect(proxyRequest.mock.calls.some((call) => call[3] === 'PATCH')).toBe(false);
    });

    it('percent-encodes itemKey (not just projectUid) in the PATCH path template', async () => {
      const item = rawItem({ item_key: 'item key/weird', status: 'in_progress', gate: false });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, notes: 'x', version: 2 });
        throw new Error('unexpected call');
      });

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item key/weird', { notes: 'x' });

      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall![2]).toBe(`/formations/live-project-1/items/${encodeURIComponent('item key/weird')}`);
    });

    it('returns the item unchanged, skipping the upstream call, on a no-op save', async () => {
      const item = rawItem({ status: 'in_progress', note: 'unchanged' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        throw new Error('unexpected call');
      });

      const result = await service.updateFormationItem(buildReq(), 'live-project-1', 'item-key-1', { notes: 'unchanged' });

      expect(result.notes).toBe('unchanged');
      expect(proxyRequest.mock.calls.some((call) => call[3] === 'PATCH')).toBe(false);
    });
  });

  describe('acceptFormationItem / rejectFormationItem / reopenFormationItem', () => {
    it('acceptFormationItem POSTs to /accept with If-Match and moves an awaiting_acceptance item to done', async () => {
      const item = rawItem({ status: 'awaiting_acceptance', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 2 });
        throw new Error('unexpected call');
      });

      const result = await service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('done');
      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall).toBeDefined();
      expect(postCall![2]).toBe('/formations/live-project-1/items/item-key-1/accept');
      expect(postCall![6]).toEqual({ 'If-Match': '1' });
    });

    it("acceptFormationItem preserves the item's existing note when the caller supplies none", async () => {
      const item = rawItem({ status: 'awaiting_acceptance', gate: true, note: 'existing note' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 2 });
        throw new Error('unexpected call');
      });

      await service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![5]).toEqual({ note: 'existing note' });
    });

    it('acceptFormationItem rejects an item that is not awaiting acceptance', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ status: 'in_progress' })]));

      await expect(service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/status/i);
    });

    it('rejectFormationItem requires a non-empty note and sends the item back to in_progress', async () => {
      const item = rawItem({ status: 'awaiting_acceptance', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'in_progress', version: 2 });
        throw new Error('unexpected call');
      });

      await expect(service.rejectFormationItem(buildReq(), 'live-project-1', 'item-key-1', '')).rejects.toThrow(/reason/i);

      const result = await service.rejectFormationItem(buildReq(), 'live-project-1', 'item-key-1', 'missing evidence');

      expect(result.status).toBe('in_progress');
    });

    it("reopenFormationItem preserves the item's existing note when the caller supplies none, moving a done item back to in_progress", async () => {
      const item = rawItem({ status: 'done', gate: false, note: 'existing note' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'in_progress', version: 2 });
        throw new Error('unexpected call');
      });

      const result = await service.reopenFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('in_progress');
      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![5]).toEqual({ note: 'existing note' });
    });

    it('reopenFormationItem rejects an item that is not done, skipped, or awaiting acceptance', async () => {
      proxyRequest.mockResolvedValue(checklist([rawItem({ status: 'not_started' })]));

      await expect(service.reopenFormationItem(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/status/i);
    });

    it('accept/reject/reopen all honor the gate_writer gate', async () => {
      canComplete.mockResolvedValue(false);
      proxyRequest.mockResolvedValue(checklist([rawItem({ status: 'awaiting_acceptance', gate: true })]));

      await expect(service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/gate_writer/i);
      await expect(service.rejectFormationItem(buildReq(), 'live-project-1', 'item-key-1', 'a note')).rejects.toThrow(/gate_writer/i);

      proxyRequest.mockResolvedValue(checklist([rawItem({ status: 'done', gate: true })]));
      await expect(service.reopenFormationItem(buildReq(), 'live-project-1', 'item-key-1')).rejects.toThrow(/gate_writer/i);
    });

    it('percent-encodes itemKey (not just projectUid) in the accept/reject/reopen path template', async () => {
      const item = rawItem({ item_key: 'item key/weird', status: 'awaiting_acceptance', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 2 });
        throw new Error('unexpected call');
      });

      await service.acceptFormationItem(buildReq(), 'live-project-1', 'item key/weird');

      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![2]).toBe(`/formations/live-project-1/items/${encodeURIComponent('item key/weird')}/accept`);
    });
  });

  describe('getFormationsQueue', () => {
    it('propagates a failOnPartial pagination failure instead of returning partial rows', async () => {
      const row: FormationQueueRow = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      proxyRequest
        .mockResolvedValueOnce({
          resources: [{ type: 'formation', id: row.formation_uid, data: row }],
          page_token: 'next-page',
        } satisfies QueryServiceResponse<FormationQueueRow>)
        .mockRejectedValueOnce(new Error('query service unavailable'));

      await expect(service.getFormationsQueue(buildReq())).rejects.toThrow(/query service unavailable/);
    });

    it('defaults a row missing progress/assignees/blocked_item_titles/announcement_date instead of throwing', async () => {
      const row: Partial<FormationQueueRow> = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: '',
        sub_stage: 'engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
      };
      proxyRequest.mockResolvedValue({
        resources: [{ type: 'formation', id: 'formation:live-project-1', data: row }],
      } satisfies QueryServiceResponse<Partial<FormationQueueRow>>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows[0].parent_uid).toBeNull();
      expect(result.rows[0].announcement_date).toBeNull();
      expect(result.rows[0].progress).toEqual({});
      expect(result.rows[0].blocked_item_titles).toEqual([]);
      expect(result.rows[0].assignees).toEqual([]);
    });

    it('reads from the query service, collapses ROOT into null, filters by sub_stage/search, and rolls up tiles', async () => {
      const rowA: FormationQueueRow = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'engaged',
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      const rowB: FormationQueueRow = {
        ...rowA,
        formation_uid: 'formation:live-project-2',
        project_uid: 'live-project-2',
        project_name: 'Cascade Systems',
        sub_stage: 'on_hold',
      };
      proxyRequest.mockResolvedValue({
        resources: [
          { type: 'formation', id: rowA.formation_uid, data: rowA },
          { type: 'formation', id: rowB.formation_uid, data: rowB },
        ],
      } satisfies QueryServiceResponse<FormationQueueRow>);

      const all = await service.getFormationsQueue(buildReq());
      expect(all.rows).toHaveLength(2);
      expect(all.tiles.total).toBe(2);
      expect(all.tiles.foundations + all.tiles.projects).toBe(all.tiles.total);
      expect(deriveFormationEntityType(rowA)).toBeDefined();

      const bySubStage = await service.getFormationsQueue(buildReq(), 'engaged');
      expect(bySubStage.rows).toHaveLength(1);
      expect(bySubStage.rows[0].project_uid).toBe('live-project-1');

      const bySearch = await service.getFormationsQueue(buildReq(), undefined, 'CASCADE');
      expect(bySearch.rows).toHaveLength(1);
      expect(bySearch.rows[0].project_uid).toBe('live-project-2');
    });
  });

  describe('getMyFormationWork (GH-1956)', () => {
    // The item-level index this needs ("which items are assigned to me") doesn't exist upstream yet
    // — tracked on #2334. Returning empty rather than fabricating rows is the honest degradation
    // until then.
    it('returns an empty result rather than fabricating rows', async () => {
      const result = await service.getMyFormationWork(buildReq(), 'any-user');

      expect(result).toEqual({ formations: [], items: [] });
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });
});
