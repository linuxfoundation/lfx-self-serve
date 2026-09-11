// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import crypto from 'crypto';

import type { Formation, FormationItem, Project, QueryServiceResponse, UpstreamFormationChecklist, UpstreamFormationItem } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';

const getProjectById = vi.fn();
const getProjectIdBySlug = vi.fn();
const getProjects = vi.fn();
const getProjectSettings = vi.fn();
const canComplete = vi.fn();
const natsRequest = vi.fn();
const proxyRequest = vi.fn();
const isFormationServiceLive = vi.fn(() => false);

vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = getProjectById;
    public getProjectIdBySlug = getProjectIdBySlug;
    public getProjects = getProjects;
    public getProjectSettings = getProjectSettings;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
  },
}));
vi.mock('../helpers/formation-backend.helper', () => ({
  isFormationServiceLive: () => isFormationServiceLive(),
}));
vi.mock('./formation-item-access.service', () => ({
  formationItemAccessService: { canComplete: (...args: unknown[]) => canComplete(...args) },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// NatsService only backs resolveRootProjectUid's ROOT slug->uid lookup here (GH-2267 Phase 4). No
// test in this file exercises the ROOT-collapse branch itself, so a resolved-but-empty response is
// enough to keep every call fast and keep collapseRootParentUid a no-op. `root-project.helper.ts`
// has no dedicated spec yet — the collapse logic is only exercised indirectly through here.
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
const { seedFormation, putStoredFormation, putStoredItem, getStoredItem, getStoredFormation, getActivityForItem, resetFormationStoreForTests } =
  await import('./formation-store.service');
const { STATIC_QUEUE_FORMATIONS } = await import('../helpers/formation-fixture.helper');
const { resetRootProjectUidCacheForTests } = await import('../helpers/root-project.helper');
const { logger } = await import('./logger.service');

let uidCounter = 0;

function buildFormation(overrides: Partial<Formation> = {}): Formation & { uid: string } {
  uidCounter += 1;
  const uid = overrides.uid ?? `formation:test-${uidCounter}`;
  return {
    uid,
    parent_project_uid: overrides.parent_project_uid ?? `project-${uidCounter}`,
    parent_project_slug: 'osaia',
    parent_project_name: 'OSAIA',
    is_foundation: true,
    parent_uid: null,
    template_uid: 'template-1',
    template_version: 1,
    sub_stage: 'engaged',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 1,
    gating_items_total: 1,
    blocking_item_title: null,
    subtitle: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

/**
 * The default `uid` matches `FormationService.itemUidFor(project_uid, template_item_key)`'s
 * `formation-item:<project_uid>:<item_key>` scheme (GH-2267 Phase 2) — the store is still keyed by
 * that derived uid, and every service method below now addresses items by `(project_uid, item_key)`
 * rather than by uid, so a caller that doesn't line the two up would silently miss the store.
 */
function buildItem(formationUid: string, overrides: Partial<FormationItem> = {}): FormationItem {
  uidCounter += 1;
  const projectUid = overrides.project_uid ?? `project-${uidCounter}`;
  const templateItemKey = overrides.template_item_key ?? 'some-key';
  return {
    uid: overrides.uid ?? `formation-item:${projectUid}:${templateItemKey}`,
    formation_uid: formationUid,
    project_uid: projectUid,
    template_item_key: templateItemKey,
    section_key: 'section',
    section_title: 'Section',
    title: 'Some item',
    status: 'not_started',
    is_gating: false,
    owner_team: null,
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    links: [],
    sub_items: [],
    skip_reason: null,
    can_complete: false,
    created_at: '',
    updated_at: '',
    version: 1,
    ...overrides,
  };
}

function buildReq(): Request {
  return { path: '/api/formations/x/items/y' } as unknown as Request;
}

/**
 * Mirrors `FormationService.isAssignedToCaller`'s SHA-256-seeded threshold exactly (the method
 * itself is private, so tests can't call it directly) — used to find a probe username that either
 * is or isn't assigned a given item uid, so `getMyFormationWork` tests are deterministic instead of
 * depending on whichever real username happens to hash under 0.3 for a given fixture item.
 */
function isAssignedFixture(username: string, itemUid: string): boolean {
  const digest = crypto.createHash('sha256').update(`${username}:${itemUid}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff < 0.3;
}

function findProbeUsername(itemUid: string, assigned: boolean): string {
  for (let i = 0; i < 10000; i++) {
    const candidate = `probe-${i}`;
    if (isAssignedFixture(candidate, itemUid) === assigned) return candidate;
  }
  throw new Error(`Could not find a probe username with assigned=${assigned} for item ${itemUid}`);
}

/**
 * `getMyFormationWork` sources its project list from `ProjectService.getProjects`, not
 * `getProjectById` (GH-1956) — this builds the caller-accessible project row that stands in for a
 * `STATIC_QUEUE_FORMATIONS` entry so `formation:${project.uid}` resolves the already-seeded
 * formation instead of triggering the lazy-generate branch.
 */
function buildCallerProject(formationRow: Formation & { uid: string }, writer: boolean): Project {
  return {
    uid: formationRow.parent_project_uid,
    slug: formationRow.parent_project_slug,
    name: formationRow.parent_project_name,
    parent_uid: formationRow.parent_uid ?? '',
    stage: 'Formation - Engaged',
    writer,
  } as Project;
}

/** Seeds a formation + item and returns both, for tests that don't care about the specific uids. */
function seedItem(itemOverrides: Partial<FormationItem> = {}): { formation: Formation & { uid: string }; item: FormationItem } {
  const formation = buildFormation();
  const item = buildItem(formation.uid, itemOverrides);
  seedFormation(formation, [item]);
  return { formation, item };
}

describe('FormationService', () => {
  const service = new FormationService();

  beforeEach(() => {
    resetFormationStoreForTests();
    getProjectById.mockReset();
    getProjectIdBySlug.mockReset();
    getProjects.mockReset();
    getProjectSettings.mockReset();
    canComplete.mockReset();
    vi.mocked(logger.info).mockClear();
    natsRequest.mockReset();
    natsRequest.mockResolvedValue({ data: '' });
    resetRootProjectUidCacheForTests();
    proxyRequest.mockReset();
    isFormationServiceLive.mockReset();
    isFormationServiceLive.mockReturnValue(false);
  });

  describe('getProjectFormation', () => {
    it('generates and returns a fixture checklist, enriched with can_complete, for a project with no prior writes', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: 'project-uid-1', exists: true });
      getProjectById.mockResolvedValue({ slug: 'test-project', name: 'Test Project', parent_uid: null, stage: 'Formation - Engaged' });
      canComplete.mockResolvedValue(true);

      const result = await service.getProjectFormation(buildReq(), 'test-project');

      expect(result.data_source).toBe('fixture');
      expect(result.formation.parent_project_uid).toBe('project-uid-1');
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.can_complete === true)).toBe(true);
    });

    it('throws ResourceNotFoundError when the project does not exist for this caller', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: undefined, exists: false });

      await expect(service.getProjectFormation(buildReq(), 'does-not-exist')).rejects.toThrow(/not found/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('drops an item that fails can_complete enrichment instead of failing the whole read', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: 'project-uid-3', exists: true });
      getProjectById.mockResolvedValue({ slug: 'test-project-3', name: 'Test Project 3', parent_uid: null, stage: 'Formation - Engaged' });
      canComplete.mockRejectedValueOnce(new Error('checkLFStaff unavailable')).mockResolvedValue(true);

      const result = await service.getProjectFormation(buildReq(), 'test-project-3');

      expect(result.items.every((item) => item.can_complete === true)).toBe(true);
      expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
        expect.anything(),
        'enrich_formation_item',
        expect.stringContaining('dropping from response'),
        expect.objectContaining({ item_uid: expect.any(String), err: expect.any(Error) })
      );
    });

    it('returns the stored (mutated) items on a second read, not a freshly regenerated set', async () => {
      getProjectIdBySlug.mockResolvedValue({ uid: 'project-uid-2', exists: true });
      getProjectById.mockResolvedValue({ slug: 'test-project-2', name: 'Test Project 2', parent_uid: null, stage: 'Formation - Engaged' });
      canComplete.mockResolvedValue(true);

      const first = await service.getProjectFormation(buildReq(), 'test-project-2');
      const targetItem = first.items[0];
      // The fixture path always sets `formation.uid` (see generateMockFormation) — the checklist
      // response type just doesn't guarantee it, since the real read path can't source it.
      putStoredFormation(first.formation as Formation & { uid: string });
      // Mutated directly through the store (not a service mutation method) — this test only needs to
      // prove getProjectFormation reads the store, not that a mutation method writes to it correctly.
      const mutated: FormationItem = { ...getStoredItem(targetItem.uid)!, notes: 'mutated' };
      putStoredItem(mutated);

      const second = await service.getProjectFormation(buildReq(), 'test-project-2');

      expect(second.items.find((item) => item.uid === targetItem.uid)?.notes).toBe('mutated');
    });
  });

  describe('getFormationItemDetail', () => {
    it('returns the enriched item alongside its activity history', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({});
      canComplete.mockResolvedValue(true);

      const result = await service.getFormationItemDetail(buildReq(), item.project_uid, item.template_item_key);

      expect(result.item.uid).toBe(item.uid);
      expect(result.item.can_complete).toBe(true);
      expect(result.history).toEqual(getActivityForItem(item.formation_uid, item.uid));
    });
  });

  describe('getFormationItemOrThrow — project-scoped read access', () => {
    it("resolves the item only after the caller's own bearer token can read the parent project", async () => {
      const { item } = seedItem();
      getProjectById.mockResolvedValue({});

      const result = await service.getFormationItemOrThrow(buildReq(), item.project_uid, item.template_item_key);

      expect(result.uid).toBe(item.uid);
      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), item.project_uid, false);
    });

    it('denies with the same "not found" shape as a missing uid, rather than returning item data, for a project the caller cannot see', async () => {
      const { item } = seedItem();
      getProjectById.mockRejectedValue(new Error('upstream 403'));

      // The upstream cause is deliberately not leaked in the thrown error — see assertItemProjectAccess's
      // doc comment (differentiating "doesn't exist" from "exists but denied" is an enumeration oracle).
      await expect(service.getFormationItemOrThrow(buildReq(), item.project_uid, item.template_item_key)).rejects.toThrow(/not found/i);
    });

    it('throws ResourceNotFoundError for an item key that was never seeded, without calling the project check', async () => {
      await expect(service.getFormationItemOrThrow(buildReq(), 'does-not-exist-project', 'does-not-exist-key')).rejects.toThrow();
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('gives the same address the identical error message whether it was never seeded or exists but is denied — no enumeration oracle', async () => {
      const sharedProjectUid = 'shared-project';
      const sharedItemKey = 'shared-item';

      const unseeded = await service.getFormationItemOrThrow(buildReq(), sharedProjectUid, sharedItemKey).catch((error: Error) => error);

      const formation = buildFormation({ parent_project_uid: sharedProjectUid });
      const item = buildItem(formation.uid, { project_uid: sharedProjectUid, template_item_key: sharedItemKey });
      seedFormation(formation, [item]);
      getProjectById.mockRejectedValue(new Error('upstream 403'));
      const denied = await service.getFormationItemOrThrow(buildReq(), sharedProjectUid, sharedItemKey).catch((error: Error) => error);

      expect((unseeded as Error).message).toBe((denied as Error).message);
    });
  });

  describe('project write access — complete/skip/request/update all require it', () => {
    it.each([
      [
        'completeFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request, projectUid: string, itemKey: string) => s.completeFormationItem(req, projectUid, itemKey),
      ],
      [
        'skipFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request, projectUid: string, itemKey: string) =>
          s.skipFormationItem(req, projectUid, itemKey, 'a reason'),
      ],
      [
        'requestFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request, projectUid: string, itemKey: string) => s.requestFormationItem(req, projectUid, itemKey),
      ],
      [
        'updateFormationItem',
        (s: InstanceType<typeof FormationService>, req: Request, projectUid: string, itemKey: string) =>
          s.updateFormationItem(req, projectUid, itemKey, { notes: 'x' }),
      ],
    ])('%s rejects a project viewer who is not a writer', async (_name, call) => {
      const { item } = seedItem({ is_gating: false, action: 'request' });
      getProjectById.mockResolvedValue({ writer: false });
      canComplete.mockResolvedValue(true);

      await expect(call(service, buildReq(), item.project_uid, item.template_item_key)).rejects.toThrow(/write access/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('resolves the write check with access=true (enriches with the writer flag), unlike the read check', async () => {
      const { item } = seedItem();
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.completeFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    });
  });

  describe('gate_writer gate — complete/skip/request', () => {
    it('completeFormationItem sets a gating item to awaiting_acceptance (not done) when canComplete denies, instead of throwing', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      const result = await service.completeFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(result.status).toBe('awaiting_acceptance');
      expect(getStoredItem(item.uid)?.status).toBe('awaiting_acceptance');
    });

    it('skipFormationItem rejects a gating item when canComplete denies, even with a reason supplied', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.skipFormationItem(buildReq(), item.project_uid, item.template_item_key, 'blocked upstream')).rejects.toThrow(/gate_writer/i);
    });

    it('requestFormationItem rejects a gating item when canComplete denies — closes the complete/skip bypass via request', async () => {
      const { item } = seedItem({ is_gating: true, action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.requestFormationItem(buildReq(), item.project_uid, item.template_item_key)).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('completeFormationItem succeeds and marks the item done when canComplete allows', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      const result = await service.completeFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(result.status).toBe('done');
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });

    it('requestFormationItem recomputes formation readiness (gating_items_open) after moving a gating item off done', async () => {
      const { formation, item } = seedItem({ is_gating: true, status: 'done', action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.requestFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(getStoredFormation(formation.uid)?.gating_items_open).toBe(1);
    });

    it('completing the last open gating item flips is_activating true without touching sub_stage, and reopening it via request reverts is_activating — sub_stage never changes', async () => {
      const { formation, item } = seedItem({ is_gating: true, action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.completeFormationItem(buildReq(), item.project_uid, item.template_item_key);
      expect(getStoredFormation(formation.uid)?.is_activating).toBe(true);
      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('engaged');

      await service.requestFormationItem(buildReq(), item.project_uid, item.template_item_key);
      expect(getStoredFormation(formation.uid)?.is_activating).toBe(false);
      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('engaged');
    });

    it('requestFormationItem sets the item to blocked, and refreshFormationReadiness reflects it in blocking_item_title', async () => {
      const { formation, item } = seedItem({ is_gating: true, action: 'request', title: 'Some item' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.requestFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(getStoredItem(item.uid)?.status).toBe('blocked');
      expect(getStoredFormation(formation.uid)?.blocking_item_title).toBe('Some item');
    });
  });

  describe('updateFormationItemStatus', () => {
    it('preserves existing notes when blocking with a reason, filing the reason as activity metadata instead', async () => {
      const { formation, item } = seedItem({ notes: 'pre-existing note from the drawer' });
      getProjectById.mockResolvedValue({ writer: true });

      const result = await service.updateFormationItemStatus(buildReq(), item.project_uid, item.template_item_key, 'blocked', 'waiting on legal');

      expect(result.notes).toBe('pre-existing note from the drawer');
      expect(getStoredItem(item.uid)?.notes).toBe('pre-existing note from the drawer');
      const activity = getActivityForItem(formation.uid, item.uid).find((entry) => entry.type === 'item_reopened');
      expect(activity?.metadata).toEqual({ note: 'waiting on legal' });
    });

    it('rejects reopening a gating item off done when canComplete denies', async () => {
      const { item } = seedItem({ is_gating: true, status: 'done' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.updateFormationItemStatus(buildReq(), item.project_uid, item.template_item_key, 'not_started')).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });

    it('rejects reopening a gating item off awaiting_acceptance when canComplete denies', async () => {
      const { item } = seedItem({ is_gating: true, status: 'awaiting_acceptance' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.updateFormationItemStatus(buildReq(), item.project_uid, item.template_item_key, 'in_progress')).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('awaiting_acceptance');
    });

    it('allows reopening a gating item off done when canComplete allows', async () => {
      const { item } = seedItem({ is_gating: true, status: 'done' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      const result = await service.updateFormationItemStatus(buildReq(), item.project_uid, item.template_item_key, 'not_started');

      expect(result.status).toBe('not_started');
    });

    it('does not gate a plain (non-gating) item transition on canComplete at all', async () => {
      const { item } = seedItem({ is_gating: false, status: 'done' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      const result = await service.updateFormationItemStatus(buildReq(), item.project_uid, item.template_item_key, 'not_started');

      expect(result.status).toBe('not_started');
    });
  });

  describe('skipFormationItem — reason required', () => {
    it('rejects an empty/whitespace-only reason before even resolving the item', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', '   ')).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects a non-string reason instead of throwing a raw TypeError from .trim()', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', { not: 'a string' })).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects a reason over 2000 characters', async () => {
      await expect(service.skipFormationItem(buildReq(), 'project-x', 'item-x', 'x'.repeat(2001))).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('does not log the reason text on the general application logger', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.skipFormationItem(buildReq(), item.project_uid, item.template_item_key, 'a sensitive skip justification');

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
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects notes over 2000 characters', async () => {
      await expect(service.completeFormationItem(buildReq(), 'project-x', 'item-x', 'x'.repeat(2001))).rejects.toThrow(/notes/i);
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

    it('does not log a spurious note_added activity when the drawer resubmits an empty notes textarea on a freshly generated (notes: null) item', async () => {
      const { formation, item } = seedItem({ notes: null, due_date: null });
      getProjectById.mockResolvedValue({ writer: true });

      const before = getActivityForItem(formation.uid, item.uid).length;
      const result = await service.updateFormationItem(buildReq(), item.project_uid, item.template_item_key, {
        notes: '',
        due_date: '2026-06-01',
      });

      expect(result.notes).toBeNull();
      expect(getActivityForItem(formation.uid, item.uid)).toHaveLength(before + 1);
      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'note_added')).toBe(false);
      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'due_date_changed')).toBe(true);
    });

    it('does log a note_added activity when notes actually changes', async () => {
      const { formation, item } = seedItem({ notes: null });
      getProjectById.mockResolvedValue({ writer: true });

      const result = await service.updateFormationItem(buildReq(), item.project_uid, item.template_item_key, { notes: 'blocked on legal review' });

      expect(result.notes).toBe('blocked on legal review');
      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'note_added')).toBe(true);
    });

    it('does not log a spurious assignee-changed activity when owner_username is resubmitted unchanged', async () => {
      const { formation, item } = seedItem({ owner: { username: 'alex.rivera', name: 'Alex Rivera' } });
      getProjectById.mockResolvedValue({ writer: true });

      const before = getActivityForItem(formation.uid, item.uid).length;
      const result = await service.updateFormationItem(buildReq(), item.project_uid, item.template_item_key, { owner_username: 'alex.rivera' });

      expect(result.owner?.username).toBe('alex.rivera');
      expect(getActivityForItem(formation.uid, item.uid)).toHaveLength(before);
      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'assignee_changed')).toBe(false);
    });

    it('does log an assignee-changed activity when owner_username actually changes', async () => {
      const { formation, item } = seedItem({ owner: null });
      getProjectById.mockResolvedValue({ writer: true });

      await service.updateFormationItem(buildReq(), item.project_uid, item.template_item_key, { owner_username: 'sam.chen' });

      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'assignee_changed')).toBe(true);
    });
  });

  describe('acceptFormationItem / rejectFormationItem / reopenFormationItem', () => {
    it('acceptFormationItem moves an awaiting_acceptance item to done', async () => {
      const { item } = seedItem({ is_gating: true, status: 'awaiting_acceptance' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      const result = await service.acceptFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(result.status).toBe('done');
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });

    it('acceptFormationItem rejects an item that is not awaiting acceptance', async () => {
      const { item } = seedItem({ status: 'in_progress' });
      getProjectById.mockResolvedValue({ writer: true });

      await expect(service.acceptFormationItem(buildReq(), item.project_uid, item.template_item_key)).rejects.toThrow(/status/i);
    });

    it('rejectFormationItem requires a non-empty note and sends the item back to in_progress', async () => {
      const { item } = seedItem({ is_gating: true, status: 'awaiting_acceptance' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await expect(service.rejectFormationItem(buildReq(), item.project_uid, item.template_item_key, '')).rejects.toThrow(/reason/i);

      const result = await service.rejectFormationItem(buildReq(), item.project_uid, item.template_item_key, 'missing evidence');

      expect(result.status).toBe('in_progress');
      expect(getStoredItem(item.uid)?.status).toBe('in_progress');
    });

    it('reopenFormationItem moves a done item back to in_progress and clears skip_reason', async () => {
      const { item } = seedItem({ is_gating: true, status: 'done' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      const result = await service.reopenFormationItem(buildReq(), item.project_uid, item.template_item_key);

      expect(result.status).toBe('in_progress');
      expect(getStoredItem(item.uid)?.skip_reason).toBeNull();
    });

    it('reopenFormationItem rejects an item that is not done, skipped, or awaiting acceptance', async () => {
      const { item } = seedItem({ status: 'not_started' });
      getProjectById.mockResolvedValue({ writer: true });

      await expect(service.reopenFormationItem(buildReq(), item.project_uid, item.template_item_key)).rejects.toThrow(/status/i);
    });

    it('accept/reject/reopen all honor the gate_writer gate', async () => {
      const { item: acceptItem } = seedItem({ is_gating: true, status: 'awaiting_acceptance' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.acceptFormationItem(buildReq(), acceptItem.project_uid, acceptItem.template_item_key)).rejects.toThrow(/gate_writer/i);
      await expect(service.rejectFormationItem(buildReq(), acceptItem.project_uid, acceptItem.template_item_key, 'a note')).rejects.toThrow(/gate_writer/i);

      const { item: reopenItem } = seedItem({ is_gating: true, status: 'done' });
      await expect(service.reopenFormationItem(buildReq(), reopenItem.project_uid, reopenItem.template_item_key)).rejects.toThrow(/gate_writer/i);
    });
  });

  describe('getFormationsQueue', () => {
    it('filters rows by sub_stage', async () => {
      const result = await service.getFormationsQueue(buildReq(), 'engaged');

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.sub_stage === 'engaged')).toBe(true);
    });

    it('filters rows by a case-insensitive search on the parent project name', async () => {
      const result = await service.getFormationsQueue(buildReq(), undefined, 'CASCADE');

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.project_name.toLowerCase().includes('cascade'))).toBe(true);
    });

    it('returns unfiltered rows plus tiles when called with no filters', async () => {
      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows.length).toBe(STATIC_QUEUE_FORMATIONS.length);
      expect(result.tiles.total).toBe(STATIC_QUEUE_FORMATIONS.length);
    });

    it('the foundations/projects tile breakdown sums to total — a bare "project" entity rolls into projects rather than being dropped', async () => {
      expect(STATIC_QUEUE_FORMATIONS.some((row) => deriveFormationEntityType(row) === 'project')).toBe(true);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.tiles.foundations + result.tiles.projects).toBe(result.tiles.total);
    });
  });

  describe('live mode (isFormationServiceLive)', () => {
    const rawItem = (overrides: Partial<UpstreamFormationItem> = {}): UpstreamFormationItem => ({
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
      status: 'awaiting_acceptance',
      version: 3,
      ...overrides,
    });

    const checklist = (items: UpstreamFormationItem[]): UpstreamFormationChecklist => ({
      project_uid: 'live-project-1',
      template_uid: 'template-1',
      template_version: 1,
      lifecycle: 'live',
      sections: [{ key: 'section-1', title: 'Section', position: 1 }],
      items,
      is_activating: false,
    });

    beforeEach(() => {
      isFormationServiceLive.mockReturnValue(true);
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
      getProjectIdBySlug.mockResolvedValue({ uid: 'live-project-1', exists: true });
      getProjectSettings.mockResolvedValue({ announcement_date: null });
      canComplete.mockResolvedValue(true);
    });

    it('completeFormationItem reads the checklist, PATCHes with If-Match, and maps the response', async () => {
      const item = rawItem({ status: 'in_progress', is_required: true, gate: true });
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
      expect(patchCall![6]).toEqual({ 'If-Match': '3' });
    });

    it("completeFormationItem's response resolves section_title from the same checklist the pre-read cached, not the seeded template", async () => {
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

    it('acceptFormationItem POSTs to /accept with If-Match', async () => {
      const item = rawItem({ status: 'awaiting_acceptance', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 4 });
        throw new Error('unexpected call');
      });

      const result = await service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      expect(result.status).toBe('done');
      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall).toBeDefined();
      expect(postCall![2]).toBe('/formations/live-project-1/items/item-key-1/accept');
      expect(postCall![6]).toEqual({ 'If-Match': '3' });
    });

    it("acceptFormationItem preserves the item's existing note when the caller supplies none", async () => {
      const item = rawItem({ status: 'awaiting_acceptance', gate: true, note: 'existing note' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 4 });
        throw new Error('unexpected call');
      });

      await service.acceptFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![5]).toEqual({ note: 'existing note' });
    });

    it("reopenFormationItem preserves the item's existing note when the caller supplies none", async () => {
      const item = rawItem({ status: 'done', gate: false, note: 'existing note' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'in_progress', version: 4 });
        throw new Error('unexpected call');
      });

      await service.reopenFormationItem(buildReq(), 'live-project-1', 'item-key-1');

      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![5]).toEqual({ note: 'existing note' });
    });

    it('clears note/assignee/due_date with empty strings, not null', async () => {
      const item = rawItem({ status: 'in_progress', note: 'old note', assignee: 'sam.chen', due_date: '2026-01-01' });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'PATCH') return Promise.resolve({ ...item, note: null, assignee: null, due_date: null, version: 4 });
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
        if (method === 'PATCH') return Promise.resolve({ ...item, due_date: '2026-03-31', version: 4 });
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
        if (method === 'PATCH') return Promise.resolve({ ...item, notes: 'x', version: 4 });
        throw new Error('unexpected call');
      });

      await service.updateFormationItem(buildReq(), 'live-project-1', 'item key/weird', { notes: 'x' });

      const patchCall = proxyRequest.mock.calls.find((call) => call[3] === 'PATCH');
      expect(patchCall![2]).toBe(`/formations/live-project-1/items/${encodeURIComponent('item key/weird')}`);
    });

    it('percent-encodes itemKey (not just projectUid) in the accept/reject/reopen path template', async () => {
      const item = rawItem({ item_key: 'item key/weird', status: 'awaiting_acceptance', gate: true });
      proxyRequest.mockImplementation((_req, _service, _path: string, method: string) => {
        if (method === 'GET') return Promise.resolve(checklist([item]));
        if (method === 'POST') return Promise.resolve({ ...item, status: 'done', version: 4 });
        throw new Error('unexpected call');
      });

      await service.acceptFormationItem(buildReq(), 'live-project-1', 'item key/weird');

      const postCall = proxyRequest.mock.calls.find((call) => call[3] === 'POST');
      expect(postCall![2]).toBe(`/formations/live-project-1/items/${encodeURIComponent('item key/weird')}/accept`);
    });

    it('propagates a failOnPartial pagination failure from getFormationsQueue instead of returning partial rows', async () => {
      const row = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'engaged' as const,
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
        } satisfies QueryServiceResponse<typeof row>)
        .mockRejectedValueOnce(new Error('query service unavailable'));

      await expect(service.getFormationsQueue(buildReq())).rejects.toThrow(/query service unavailable/);
    });

    it('defaults a row missing progress/assignees/blocked_item_titles/announcement_date instead of throwing', async () => {
      const row = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: '',
        sub_stage: 'engaged' as const,
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
      };
      proxyRequest.mockResolvedValue({ resources: [{ type: 'formation', id: row.formation_uid, data: row }] } satisfies QueryServiceResponse<typeof row>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows[0].parent_uid).toBeNull();
      expect(result.rows[0].announcement_date).toBeNull();
      expect(result.rows[0].progress).toEqual({});
      expect(result.rows[0].blocked_item_titles).toEqual([]);
      expect(result.rows[0].assignees).toEqual([]);
    });

    it('getFormationsQueue reads from the query service and collapses ROOT into null', async () => {
      const row = {
        formation_uid: 'formation:live-project-1',
        project_uid: 'live-project-1',
        project_name: 'Live Project',
        project_slug: 'live-project',
        is_foundation: false,
        parent_uid: null,
        sub_stage: 'engaged' as const,
        lifecycle: 'live',
        gates_cleared: false,
        is_activating: false,
        announcement_date: null,
        progress: {},
        blocked_item_titles: [],
        assignees: [],
      };
      proxyRequest.mockResolvedValue({ resources: [{ type: 'formation', id: row.formation_uid, data: row }] } satisfies QueryServiceResponse<typeof row>);

      const result = await service.getFormationsQueue(buildReq());

      expect(result.data_source).toBe('live');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].project_uid).toBe('live-project-1');
      expect(result.tiles.total).toBe(1);
    });
  });

  describe('getMyFormationWork (GH-1956)', () => {
    // getMyFormationWork walks every STATIC_QUEUE_FORMATIONS row, lazily generating + seeding
    // items for whichever ones this test file hasn't already visited (mirrors getProjectFormation's
    // lazy-seed). The probe username picked below is only guaranteed for our own seeded item's uid
    // — it may incidentally also assign one of those auto-generated items on an unrelated static
    // formation (~30% chance per item). Assertions below scope to the target formation/item uid
    // rather than asserting on the response's total length, so they don't flake on that overlap.
    it('groups a caller-assigned open item into both the formation summary and the items list', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, true)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'not_started', is_gating: true });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, true);

      const result = await service.getMyFormationWork(buildReq(), username);

      expect(result.data_source).toBe('fixture');
      const formation = result.formations.find((f) => f.formation_uid === formationRow.uid);
      expect(formation).toMatchObject({ assigned_to_do: 1, assigned_with_team: 0, assigned_done: 0 });
      const returnedItem = result.items.find((i) => i.item_uid === item.uid);
      expect(returnedItem).toMatchObject({ item_uid: item.uid, status: 'not_started', is_gating: true, can_write: true });
    });

    it('sets can_write false for an item on a project the caller can only read, not write (auditor-only assignee)', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, false)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'not_started' });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, true);

      const result = await service.getMyFormationWork(buildReq(), username);

      const returnedItem = result.items.find((i) => i.item_uid === item.uid);
      expect(returnedItem?.can_write).toBe(false);
      expect(getProjects).toHaveBeenCalledWith(expect.anything(), { cel_filter: 'data.stage.startsWith("Formation - ")' }, true);
    });

    it('excludes done/skipped assigned items from the items list but still counts them in the formation summary', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, true)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'done' });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, true);

      const result = await service.getMyFormationWork(buildReq(), username);

      // The formation still surfaces — "at least one item assigned" doesn't require the item to
      // still be open — but the done item itself never appears in the Pending Actions row list.
      const formation = result.formations.find((f) => f.formation_uid === formationRow.uid);
      expect(formation).toMatchObject({ assigned_to_do: 0, assigned_with_team: 0, assigned_done: 1 });
      expect(result.items.find((i) => i.item_uid === item.uid)).toBeUndefined();
    });

    it('retains an awaiting_acceptance item in the items list (assignee never sets status, GH-1956 decision 3)', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, true)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'awaiting_acceptance' });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, true);

      const result = await service.getMyFormationWork(buildReq(), username);

      const returnedItem = result.items.find((i) => i.item_uid === item.uid);
      expect(returnedItem?.status).toBe('awaiting_acceptance');
      const formation = result.formations.find((f) => f.formation_uid === formationRow.uid);
      expect(formation).toMatchObject({ assigned_to_do: 0, assigned_with_team: 1, assigned_done: 0 });
    });

    it('omits a formation with no item assigned to the caller', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, true)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'not_started' });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, false);

      const result = await service.getMyFormationWork(buildReq(), username);

      expect(result.formations.find((f) => f.formation_uid === formationRow.uid)).toBeUndefined();
      expect(result.items.find((i) => i.item_uid === item.uid)).toBeUndefined();
    });

    it('strips an auth-provider prefix before hashing, so a raw sub claim assigns the same items as the plain username (copilot review, PR #2309)', async () => {
      const formationRow = STATIC_QUEUE_FORMATIONS[0];
      getProjects.mockResolvedValue([buildCallerProject(formationRow, true)]);
      const item = buildItem(formationRow.uid, { project_uid: formationRow.parent_project_uid, status: 'not_started' });
      seedFormation(formationRow, [item]);
      const username = findProbeUsername(item.uid, true);

      const result = await service.getMyFormationWork(buildReq(), `auth0|${username}`);

      expect(result.items.find((i) => i.item_uid === item.uid)).toBeDefined();
    });

    it('returns an empty result on the live branch rather than fabricating fixture rows', async () => {
      isFormationServiceLive.mockReturnValue(true);

      const result = await service.getMyFormationWork(buildReq(), 'any-user');

      expect(result).toEqual({ formations: [], items: [], data_source: 'live' });
    });

    it('returns an empty result rather than a partial one when getProjects fails partway through paging', async () => {
      getProjects.mockRejectedValue(new Error('query-service pagination failed'));

      const result = await service.getMyFormationWork(buildReq(), 'any-user');

      expect(result).toEqual({ formations: [], items: [], data_source: 'fixture' });
      expect(getProjects).toHaveBeenCalledWith(expect.anything(), { cel_filter: 'data.stage.startsWith("Formation - ")' }, true);
    });
  });

  describe('getProjectFormation (live)', () => {
    const rawItem = (overrides: Partial<UpstreamFormationItem> = {}): UpstreamFormationItem => ({
      uid: 'formation-item:live-project-1:item-key-1',
      item_key: 'item-key-1',
      section_key: 'section-1',
      position: 1,
      title: 'Some gating item',
      gate: true,
      requires_writer: false,
      status_source: 'manual',
      is_required: true,
      checklist_type: 'manual',
      status: 'not_started',
      version: 1,
      ...overrides,
    });

    const checklist = (overrides: Partial<UpstreamFormationChecklist> = {}): UpstreamFormationChecklist => ({
      project_uid: 'live-project-1',
      template_uid: 'template-1',
      template_version: 1,
      lifecycle: 'live',
      sections: [{ key: 'legal_and_entity', title: 'Legal and entity', position: 1 }],
      items: [rawItem()],
      is_activating: false,
      ...overrides,
    });

    beforeEach(() => {
      isFormationServiceLive.mockReturnValue(true);
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
      getProjectIdBySlug.mockResolvedValue({ uid: 'live-project-1', exists: true });
      getProjectSettings.mockResolvedValue({ announcement_date: '2026-10-01' });
      canComplete.mockResolvedValue(true);
    });

    it('maps a live checklist read to FormationChecklistResponse with data_source live', async () => {
      proxyRequest.mockResolvedValue(checklist());

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.data_source).toBe('live');
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
      proxyRequest.mockResolvedValue(checklist());

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(true);
    });

    it('reports is_foundation false for a top-level project that fails computeIsFoundation, despite parent_uid null', async () => {
      // parent_uid collapsing to null must not itself imply is_foundation — the two are independent
      // axes (see deriveFormationEntityType). A project missing computeIsFoundation's criteria
      // (no stage/funding/funding_model set here) stays is_foundation:false even with no parent.
      getProjectById.mockResolvedValue({ slug: 'live-project', name: 'Live Project', parent_uid: null, writer: true });
      proxyRequest.mockResolvedValue(checklist());

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.parent_uid).toBeNull();
      expect(result.formation.is_foundation).toBe(false);
    });

    it('counts a skipped gating item as still outstanding, matching upstream gate accounting', async () => {
      // Upstream's own gate accounting (gateSummaryFromItems/isActivating) treats `skipped` as not
      // yet done — only `status === 'done'` clears a gate. The live queue's gates_cleared is sourced
      // from that same projection, so this checklist path must agree rather than reuse the fixture
      // helper's "done OR skipped" rule.
      proxyRequest.mockResolvedValue(checklist({ items: [rawItem({ status: 'skipped', skip_reason: 'Not applicable' })] }));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });

    it('degrades announcement_date to null when the project-settings read fails', async () => {
      getProjectSettings.mockRejectedValue(new Error('settings service unavailable'));
      proxyRequest.mockResolvedValue(checklist());

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.formation.announcement_date).toBeNull();
      expect(result.data_source).toBe('live');
    });

    it("prefers this response's own section title over the seeded template's when upstream has renamed a section", async () => {
      proxyRequest.mockResolvedValue(
        checklist({
          sections: [{ key: 'legal_and_entity', title: 'Legal & Entity (renamed)', position: 1 }],
          items: [rawItem({ section_key: 'legal_and_entity' })],
        })
      );

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('Legal & Entity (renamed)');
      expect(result.template?.sections[0].title).toBe('Legal & Entity (renamed)');
    });

    it('falls back to the raw section_key when a section is not in this response', async () => {
      proxyRequest.mockResolvedValue(checklist({ items: [rawItem({ section_key: 'unrecognized-section' })] }));

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items[0].section_title).toBe('unrecognized-section');
    });

    it('keeps gating counts derived from the checklist, not the post-enrichment array, when a gating item is dropped by enrichItems', async () => {
      // The one gating item's own canComplete enrichment rejects, so enrichItems drops it from
      // `items[]` (Promise.allSettled graceful-degradation) — the rollup on `formation` must still
      // reflect the checklist's real gating state (1 total, 1 open), not the post-drop empty array.
      canComplete.mockRejectedValueOnce(new Error('access-check backend unavailable'));
      proxyRequest.mockResolvedValue(checklist());

      const result = await service.getProjectFormation(buildReq(), 'live-project');

      expect(result.items).toHaveLength(0);
      expect(result.formation.gating_items_total).toBe(1);
      expect(result.formation.gating_items_open).toBe(1);
    });
  });
});
