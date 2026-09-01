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
const { seedFormation, getStoredItem } = await import('./formation-store.service');

function buildFormation(overrides: Partial<Formation> = {}): Formation {
  return {
    uid: 'formation:project-1',
    parent_project_uid: 'project-1',
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

function buildItem(overrides: Partial<FormationItem> = {}): FormationItem {
  return {
    uid: 'formation-item:project-1:some-key',
    formation_uid: 'formation:project-1',
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

describe('FormationService', () => {
  const service = new FormationService();

  beforeEach(() => {
    getProjectById.mockReset();
    canComplete.mockReset();
  });

  describe('getFormationItemOrThrow — project-scoped access', () => {
    it("resolves the item only after the caller's own bearer token can read the parent project", async () => {
      const formation = buildFormation();
      const item = buildItem();
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});

      const result = await service.getFormationItemOrThrow(buildReq(), item.uid);

      expect(result.uid).toBe(item.uid);
      expect(getProjectById).toHaveBeenCalledWith(expect.anything(), formation.parent_project_uid, false);
    });

    it('propagates the upstream denial rather than returning item data for a project the caller cannot see', async () => {
      const formation = buildFormation({ uid: 'formation:project-2', parent_project_uid: 'project-2' });
      const item = buildItem({ uid: 'formation-item:project-2:some-key', formation_uid: 'formation:project-2' });
      seedFormation(formation, [item]);
      getProjectById.mockRejectedValue(new Error('not found'));

      await expect(service.getFormationItemOrThrow(buildReq(), item.uid)).rejects.toThrow('not found');
    });

    it('throws ResourceNotFoundError for an item uid that was never seeded, without calling the project check', async () => {
      await expect(service.getFormationItemOrThrow(buildReq(), 'formation-item:does-not-exist')).rejects.toThrow();
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });

  describe('gate_writer gate — complete/skip/request', () => {
    it('completeFormationItem rejects a gating item when canComplete denies', async () => {
      const formation = buildFormation({ uid: 'formation:project-3', parent_project_uid: 'project-3' });
      const item = buildItem({ uid: 'formation-item:project-3:gating', formation_uid: 'formation:project-3', is_gating: true });
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});
      canComplete.mockResolvedValue(false);

      await expect(service.completeFormationItem(buildReq(), item.uid)).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('skipFormationItem rejects a gating item when canComplete denies, even with a reason supplied', async () => {
      const formation = buildFormation({ uid: 'formation:project-4', parent_project_uid: 'project-4' });
      const item = buildItem({ uid: 'formation-item:project-4:gating', formation_uid: 'formation:project-4', is_gating: true });
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});
      canComplete.mockResolvedValue(false);

      await expect(service.skipFormationItem(buildReq(), item.uid, 'blocked upstream')).rejects.toThrow(/gate_writer/i);
    });

    it('requestFormationItem rejects a gating item when canComplete denies — closes the complete/skip bypass via request', async () => {
      const formation = buildFormation({ uid: 'formation:project-5', parent_project_uid: 'project-5' });
      const item = buildItem({ uid: 'formation-item:project-5:gating', formation_uid: 'formation:project-5', is_gating: true, action: 'request' });
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});
      canComplete.mockResolvedValue(false);

      await expect(service.requestFormationItem(buildReq(), item.uid)).rejects.toThrow(/gate_writer/i);
      expect(getStoredItem(item.uid)?.status).toBe('not_started');
    });

    it('completeFormationItem succeeds and marks the item done when canComplete allows', async () => {
      const formation = buildFormation({ uid: 'formation:project-6', parent_project_uid: 'project-6' });
      const item = buildItem({ uid: 'formation-item:project-6:gating', formation_uid: 'formation:project-6', is_gating: true });
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});
      canComplete.mockResolvedValue(true);

      const result = await service.completeFormationItem(buildReq(), item.uid);

      expect(result.status).toBe('done');
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });
  });

  describe('skipFormationItem — reason required', () => {
    it('rejects an empty/whitespace-only reason before even resolving the item', async () => {
      await expect(service.skipFormationItem(buildReq(), 'formation-item:whatever', '   ')).rejects.toThrow(/reason/i);
      expect(getProjectById).not.toHaveBeenCalled();
    });
  });

  describe('updateFormationItem — validation', () => {
    it('rejects a non-string notes value', async () => {
      await expect(service.updateFormationItem(buildReq(), 'formation-item:whatever', { notes: 123 as unknown as string })).rejects.toThrow(/notes/i);
    });

    it('rejects an invalid due_date', async () => {
      await expect(service.updateFormationItem(buildReq(), 'formation-item:whatever', { due_date: 'not-a-date' })).rejects.toThrow(/due_date/i);
    });

    it('does not log a spurious assignee-changed activity when owner_username is resubmitted unchanged', async () => {
      const formation = buildFormation({ uid: 'formation:project-7', parent_project_uid: 'project-7' });
      const item = buildItem({
        uid: 'formation-item:project-7:owned',
        formation_uid: 'formation:project-7',
        owner: { username: 'alex.rivera', name: 'Alex Rivera' },
      });
      seedFormation(formation, [item]);
      getProjectById.mockResolvedValue({});

      const result = await service.updateFormationItem(buildReq(), item.uid, { owner_username: 'alex.rivera' });

      expect(result.owner?.username).toBe('alex.rivera');
    });
  });
});
