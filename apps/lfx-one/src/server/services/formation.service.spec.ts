// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationState } from '@lfx-one/shared/enums';
import type { FormationIntake } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername } = vi.hoisted(() => ({ getEffectiveUsername: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { FormationService } from './formation.service';

const req = {} as unknown as Request;

function intake(overrides: Partial<FormationIntake> = {}): FormationIntake {
  return {
    parent_project_uid: null,
    project_name: 'Example Project',
    project_repository_url: null,
    project_logo_filename: null,
    trademark_status: 'not_filed',
    contributing_org_name: 'Example Org',
    contributing_org_id: null,
    contributing_org_website_url: null,
    legal_contact: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.test' },
    additional_contacts: [],
    license: 'MIT',
    chat_platform: 'slack',
    mission_statement: 'Our mission.',
    agreement_type: 'dco',
    is_spec_project: false,
    description: 'A description.',
    website_url: null,
    ...overrides,
  };
}

describe('FormationService', () => {
  let service: FormationService;

  beforeEach(() => {
    getEffectiveUsername.mockReset();
    getEffectiveUsername.mockReturnValue('proposer1');
    service = new FormationService();
    // The fixture store is a module-level static Map shared across every test in this file
    // (mirrors the real per-pod, not per-instance, lifetime) — clear it so one test's entries
    // can't leak into another's assertions, especially the TTL tests below that rewind the clock.
    (FormationService as unknown as { store: Map<string, unknown> }).store.clear();
  });

  describe('createFormation', () => {
    it('creates the formation in proposed state with no linked project record — the fallback "Record not yet created" state', async () => {
      const formation = await service.createFormation(req, intake());

      expect(formation.state).toBe(FormationState.PROPOSED);
      expect(formation.project_uid).toBeNull();
      expect(formation.uid).toBeTruthy();
      expect(formation.data_source).toBe('mock');
    });

    it('grants the proposer participant in the fixture response, as the real formation service will on submit', async () => {
      const formation = await service.createFormation(req, intake());

      expect(formation.participant_granted).toBe(true);
    });

    it('records who submitted and when', async () => {
      getEffectiveUsername.mockReturnValue('proposer2');

      const formation = await service.createFormation(req, intake());

      expect(formation.submitted_by).toBe('proposer2');
      expect(new Date(formation.submitted_at).getTime()).not.toBeNaN();
    });

    it('preserves the submitted parent project uid, including null for "let LF decide"', async () => {
      const withParent = await service.createFormation(req, intake({ parent_project_uid: 'project-uid-123' }));
      const withoutParent = await service.createFormation(req, intake({ parent_project_uid: null }));

      expect(withParent.parent_project_uid).toBe('project-uid-123');
      expect(withoutParent.parent_project_uid).toBeNull();
    });

    it('snapshots the full intake payload on the returned formation', async () => {
      const payload = intake({ project_name: 'Snapshot Project' });

      const formation = await service.createFormation(req, payload);

      expect(formation.intake).toEqual(payload);
    });
  });

  describe('getFormationByUid', () => {
    it('round-trips a created formation by uid — the create-then-read path the confirmation page relies on', async () => {
      const created = await service.createFormation(req, intake());

      const fetched = await service.getFormationByUid(req, created.uid);

      expect(fetched).toEqual(created);
    });

    it('returns null for an unknown uid, matching the ephemeral in-memory fixture store', async () => {
      const fetched = await service.getFormationByUid(req, 'does-not-exist');

      expect(fetched).toBeNull();
    });

    it('returns null for a different user — an unauthorized read is indistinguishable from an unknown uid', async () => {
      getEffectiveUsername.mockReturnValue('proposer1');
      const created = await service.createFormation(req, intake());

      getEffectiveUsername.mockReturnValue('someone-else');
      const fetched = await service.getFormationByUid(req, created.uid);

      expect(fetched).toBeNull();
    });
  });

  describe('fixture store TTL', () => {
    // Asserts against the store directly, not via getFormationByUid — that method now also
    // prunes (see the "read" test below), so routing the assertion through it can't distinguish
    // "this call's own prune site did it" from "the read at assertion time did it".
    const store = (): Map<string, unknown> => (FormationService as unknown as { store: Map<string, unknown> }).store;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('prunes an entry older than the TTL on the next create, bounding retained PII', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const stale = await service.createFormation(req, intake());

      vi.setSystemTime(new Date('2026-08-01T01:00:01.000Z')); // just past the 1-hour TTL
      await service.createFormation(req, intake({ project_name: 'Fresh Project' }));

      expect(store().has(stale.uid)).toBe(false);
    });

    it('also prunes on a read, not just a create — selectively, without dropping a still-live sibling entry', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const stale = await service.createFormation(req, intake());

      vi.setSystemTime(new Date('2026-08-01T00:59:00.000Z')); // created before stale expires
      const fresh = await service.createFormation(req, intake({ project_name: 'Fresh Project' }));

      vi.setSystemTime(new Date('2026-08-01T01:00:01.000Z')); // stale is now past TTL, fresh is not
      const fetched = await service.getFormationByUid(req, fresh.uid); // read alone — no intervening create

      expect(store().has(stale.uid)).toBe(false);
      expect(fetched).not.toBeNull(); // the read pruned its stale sibling without dropping this live entry
    });
  });
});
