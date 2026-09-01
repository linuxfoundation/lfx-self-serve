// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Formation, FormationItem } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProjectById = vi.fn();
const canComplete = vi.fn();

vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = getProjectById;
    public getProjectIdBySlug = vi.fn();
  },
}));
vi.mock('./formation-item-access.service', () => ({
  formationItemAccessService: { canComplete: (...args: unknown[]) => canComplete(...args) },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { FormationService } = await import('./formation.service');
const { seedFormation, putStoredFormation, getStoredItem, getStoredFormation, getActivityForItem, getActivityForFormation, resetFormationStoreForTests } =
  await import('./formation-store.service');
const { STATIC_QUEUE_FORMATIONS } = await import('../helpers/formation-fixture.helper');
const { logger } = await import('./logger.service');

let uidCounter = 0;

function buildFormation(overrides: Partial<Formation> = {}): Formation {
  uidCounter += 1;
  const uid = overrides.uid ?? `formation:test-${uidCounter}`;
  return {
    uid,
    parent_project_uid: overrides.parent_project_uid ?? `project-${uidCounter}`,
    parent_project_slug: 'osaia',
    parent_project_name: 'OSAIA',
    entity_type: 'foundation',
    template_uid: 'template-1',
    template_version: 1,
    state: 'active',
    sub_stage: 'engaged',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 1,
    gating_items_total: 1,
    blocking_item_title: null,
    lead: null,
    proposer: null,
    subtitle: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function buildItem(formationUid: string, overrides: Partial<FormationItem> = {}): FormationItem {
  uidCounter += 1;
  return {
    uid: overrides.uid ?? `formation-item:test-${uidCounter}`,
    formation_uid: formationUid,
    template_item_key: 'some-key',
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
    ...overrides,
  };
}

function buildReq(): Request {
  return { path: '/api/formation-items/x' } as unknown as Request;
}

/** Seeds a formation + item and returns both, for tests that don't care about the specific uids. */
function seedItem(itemOverrides: Partial<FormationItem> = {}): { formation: Formation; item: FormationItem } {
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
    canComplete.mockReset();
    vi.mocked(logger.info).mockClear();
  });

  describe('getFormationItemOrThrow — project-scoped read access', () => {
    it("resolves the item only after the caller's own bearer token can read the parent project", async () => {
      const { formation, item } = seedItem();
      getProjectById.mockResolvedValue({});

      const result = await service.getFormationItemOrThrow(buildReq(), item.uid);

      expect(result.uid).toBe(item.uid);
      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), formation.parent_project_uid, false);
    });

    it('denies with the same "not found" shape as a missing uid, rather than returning item data, for a project the caller cannot see', async () => {
      const { item } = seedItem();
      getProjectById.mockRejectedValue(new Error('upstream 403'));

      // The upstream cause is deliberately not leaked in the thrown error — see assertItemProjectAccess's
      // doc comment (differentiating "doesn't exist" from "exists but denied" is an enumeration oracle).
      await expect(service.getFormationItemOrThrow(buildReq(), item.uid)).rejects.toThrow(/not found/i);
    });

    it('throws ResourceNotFoundError for an item uid that was never seeded, without calling the project check', async () => {
      await expect(service.getFormationItemOrThrow(buildReq(), 'formation-item:does-not-exist')).rejects.toThrow();
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('gives the same uid the identical error message whether it was never seeded or exists but is denied — no enumeration oracle', async () => {
      const sharedUid = 'formation-item:shared-uid';

      const unseeded = await service.getFormationItemOrThrow(buildReq(), sharedUid).catch((error: Error) => error);

      const formation = buildFormation();
      const item = buildItem(formation.uid, { uid: sharedUid });
      seedFormation(formation, [item]);
      getProjectById.mockRejectedValue(new Error('upstream 403'));
      const denied = await service.getFormationItemOrThrow(buildReq(), sharedUid).catch((error: Error) => error);

      expect((unseeded as Error).message).toBe((denied as Error).message);
    });
  });

  describe('project write access — complete/skip/request/update all require it', () => {
    it.each([
      ['completeFormationItem', (s: InstanceType<typeof FormationService>, req: Request, uid: string) => s.completeFormationItem(req, uid)],
      ['skipFormationItem', (s: InstanceType<typeof FormationService>, req: Request, uid: string) => s.skipFormationItem(req, uid, 'a reason')],
      ['requestFormationItem', (s: InstanceType<typeof FormationService>, req: Request, uid: string) => s.requestFormationItem(req, uid)],
      ['updateFormationItem', (s: InstanceType<typeof FormationService>, req: Request, uid: string) => s.updateFormationItem(req, uid, { notes: 'x' })],
    ])('%s rejects a project viewer who is not a writer', async (_name, call) => {
      const { item } = seedItem({ is_gating: false, action: 'request' });
      getProjectById.mockResolvedValue({ writer: false });
      canComplete.mockResolvedValue(true);

      await expect(call(service, buildReq(), item.uid)).rejects.toThrow(/write access/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('resolves the write check with access=true (enriches with the writer flag), unlike the read check', async () => {
      const { item } = seedItem();
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.completeFormationItem(buildReq(), item.uid);

      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    });
  });

  describe('gate_writer gate — complete/skip/request', () => {
    it('completeFormationItem rejects a gating item when canComplete denies', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.completeFormationItem(buildReq(), item.uid)).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('skipFormationItem rejects a gating item when canComplete denies, even with a reason supplied', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.skipFormationItem(buildReq(), item.uid, 'blocked upstream')).rejects.toThrow(/gate_writer/i);
    });

    it('requestFormationItem rejects a gating item when canComplete denies — closes the complete/skip bypass via request', async () => {
      const { item } = seedItem({ is_gating: true, action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(false);

      await expect(service.requestFormationItem(buildReq(), item.uid)).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('completeFormationItem succeeds and marks the item done when canComplete allows', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      const result = await service.completeFormationItem(buildReq(), item.uid);

      expect(result.status).toBe('done');
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });

    it('requestFormationItem recomputes formation readiness (gating_items_open) after moving a gating item off done', async () => {
      const { formation, item } = seedItem({ is_gating: true, status: 'done', action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.requestFormationItem(buildReq(), item.uid);

      expect(getStoredFormation(formation.uid)?.gating_items_open).toBe(1);
    });

    it('completing the last open gating item flips sub_stage to activating, and reopening it via request reverts to engaged', async () => {
      const { formation, item } = seedItem({ is_gating: true, action: 'request' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.completeFormationItem(buildReq(), item.uid);
      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('activating');

      await service.requestFormationItem(buildReq(), item.uid);
      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('engaged');
    });

    it('never overrides a withdrawn sub_stage while recomputing readiness', async () => {
      const { formation, item } = seedItem({ is_gating: true, action: 'request' });
      putStoredFormation({ ...formation, sub_stage: 'withdrawn', state: 'withdrawn' });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.completeFormationItem(buildReq(), item.uid);

      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('withdrawn');
    });
  });

  describe('skipFormationItem — reason required', () => {
    it('rejects an empty/whitespace-only reason before even resolving the item', async () => {
      await expect(service.skipFormationItem(buildReq(), 'formation-item:whatever', '   ')).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects a non-string reason instead of throwing a raw TypeError from .trim()', async () => {
      await expect(service.skipFormationItem(buildReq(), 'formation-item:whatever', { not: 'a string' })).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects a reason over 2000 characters', async () => {
      await expect(service.skipFormationItem(buildReq(), 'formation-item:whatever', 'x'.repeat(2001))).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('does not log the reason text on the general application logger', async () => {
      const { item } = seedItem({ is_gating: true });
      getProjectById.mockResolvedValue({ writer: true });
      canComplete.mockResolvedValue(true);

      await service.skipFormationItem(buildReq(), item.uid, 'a sensitive skip justification');

      const infoCalls = vi.mocked(logger.info).mock.calls;
      // Anchor on the call actually existing — otherwise a logger.info() that fired zero times
      // would pass this assertion too, which defeats the point of the test.
      expect(infoCalls.some((call) => call[1] === 'skip_formation_item')).toBe(true);
      expect(infoCalls.some((call) => JSON.stringify(call).includes('sensitive skip justification'))).toBe(false);
    });
  });

  describe('completeFormationItem — notes validation', () => {
    it('rejects a non-string notes value', async () => {
      await expect(service.completeFormationItem(buildReq(), 'formation-item:whatever', { not: 'a string' })).rejects.toThrow(/notes/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });

    it('rejects notes over 2000 characters', async () => {
      await expect(service.completeFormationItem(buildReq(), 'formation-item:whatever', 'x'.repeat(2001))).rejects.toThrow(/notes/i);
    });
  });

  describe('updateFormationItem — validation', () => {
    it('rejects a non-string notes value', async () => {
      await expect(service.updateFormationItem(buildReq(), 'formation-item:whatever', { notes: 123 as unknown as string })).rejects.toThrow(/notes/i);
    });

    it('rejects an invalid due_date', async () => {
      await expect(service.updateFormationItem(buildReq(), 'formation-item:whatever', { due_date: 'not-a-date' })).rejects.toThrow(/due_date/i);
    });

    it('rejects a non-string due_date (e.g. an array from a malformed body)', async () => {
      await expect(service.updateFormationItem(buildReq(), 'formation-item:whatever', { due_date: ['2026-01-01'] as unknown as string })).rejects.toThrow(
        /due_date/i
      );
    });

    it('does not log a spurious assignee-changed activity when owner_username is resubmitted unchanged', async () => {
      const { formation, item } = seedItem({ owner: { username: 'alex.rivera', name: 'Alex Rivera' } });
      getProjectById.mockResolvedValue({ writer: true });

      const before = getActivityForItem(formation.uid, item.uid).length;
      const result = await service.updateFormationItem(buildReq(), item.uid, { owner_username: 'alex.rivera' });

      expect(result.owner?.username).toBe('alex.rivera');
      expect(getActivityForItem(formation.uid, item.uid)).toHaveLength(before);
      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'assignee_changed')).toBe(false);
    });

    it('does log an assignee-changed activity when owner_username actually changes', async () => {
      const { formation, item } = seedItem({ owner: null });
      getProjectById.mockResolvedValue({ writer: true });

      await service.updateFormationItem(buildReq(), item.uid, { owner_username: 'sam.chen' });

      expect(getActivityForItem(formation.uid, item.uid).some((activity) => activity.type === 'assignee_changed')).toBe(true);
    });
  });

  describe('getFormationsQueue', () => {
    it('filters rows by sub_stage', async () => {
      const result = await service.getFormationsQueue(buildReq(), 'proposed');

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.sub_stage === 'proposed')).toBe(true);
    });

    it('filters rows by a case-insensitive search on the parent project name', async () => {
      const result = await service.getFormationsQueue(buildReq(), undefined, 'CASCADE');

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.parent_project_name.toLowerCase().includes('cascade'))).toBe(true);
    });

    it('returns unfiltered rows plus tiles when called with no filters', async () => {
      const result = await service.getFormationsQueue(buildReq());

      expect(result.rows.length).toBe(STATIC_QUEUE_FORMATIONS.length);
      expect(result.tiles.total).toBe(STATIC_QUEUE_FORMATIONS.length);
    });

    it('reflects a prior decline in the queue read, not just the decline response', async () => {
      await service.declineFormation(buildReq(), 'formation:queue-2', 'not a fit at this time');

      const result = await service.getFormationsQueue(buildReq(), 'withdrawn');

      expect(result.rows.some((row) => row.uid === 'formation:queue-2')).toBe(true);
    });
  });

  describe('acceptFormation', () => {
    it('returns a deep link built from the formation slug, with no state mutation', async () => {
      const result = await service.acceptFormation(buildReq(), 'formation:queue-1');

      expect(result.deep_link_url).toContain('cascade-data-alliance');
      expect(getStoredFormation('formation:queue-1')).toBeUndefined();
    });

    it('throws ResourceNotFoundError for an unknown formation uid', async () => {
      await expect(service.acceptFormation(buildReq(), 'formation:does-not-exist')).rejects.toThrow(/not found/i);
    });
  });

  describe('declineFormation', () => {
    it('rejects a missing reason', async () => {
      await expect(service.declineFormation(buildReq(), 'formation:queue-1', '')).rejects.toThrow(/reason/i);
    });

    it('rejects a non-string reason', async () => {
      await expect(service.declineFormation(buildReq(), 'formation:queue-1', 42)).rejects.toThrow(/reason/i);
    });

    it('transitions the formation to withdrawn and records a formation_declined activity carrying the reason', async () => {
      const result = await service.declineFormation(buildReq(), 'formation:queue-1', 'not a fit at this time');

      expect(result.state).toBe('withdrawn');
      expect(result.sub_stage).toBe('withdrawn');
      const activity = getActivityForFormation(result.uid);
      expect(activity.some((entry) => entry.type === 'formation_declined' && entry.metadata?.['reason'] === 'not a fit at this time')).toBe(true);
    });

    it('never logs the proposer username, even for a queue row that has one', async () => {
      await service.declineFormation(buildReq(), 'formation:queue-2', 'not a fit at this time');

      const infoCalls = vi.mocked(logger.info).mock.calls;
      const declineCall = infoCalls.find((call) => call[1] === 'decline_formation');
      expect(declineCall).toBeDefined();
      expect(declineCall?.[3]).not.toHaveProperty('proposer');
    });

    it('throws ResourceNotFoundError for an unknown formation uid', async () => {
      await expect(service.declineFormation(buildReq(), 'formation:does-not-exist', 'a reason')).rejects.toThrow(/not found/i);
    });
  });
});
