// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so runtime collaborators (constants + the services this service instantiates
// internally) need mocking.
vi.mock('@lfx-one/shared/constants', () => ({
  RECONCILIATION_MAX_ATTENDEES_PER_AI_CALL: 30,
  RECONCILIATION_MAX_CANDIDATES_PER_AI_CALL: 50,
  RECONCILIATION_MAX_CONCURRENT_AI_CALLS: 3,
  RECONCILIATION_MAX_PRIOR_OCCURRENCES: 10,
}));

const { getPastMeetingParticipants, getPastOccurrencesForMeeting, updatePastMeetingParticipant } = vi.hoisted(() => ({
  getPastMeetingParticipants: vi.fn(),
  getPastOccurrencesForMeeting: vi.fn(),
  updatePastMeetingParticipant: vi.fn(),
}));
vi.mock('./meeting.service', () => ({
  MeetingService: class {
    public getPastMeetingParticipants = getPastMeetingParticipants;
    public getPastOccurrencesForMeeting = getPastOccurrencesForMeeting;
    public updatePastMeetingParticipant = updatePastMeetingParticipant;
  },
}));

const { getCommitteeMembers } = vi.hoisted(() => ({ getCommitteeMembers: vi.fn() }));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommitteeMembers = getCommitteeMembers;
  },
}));

const { isAiConfigured, reconcileAttendees } = vi.hoisted(() => ({ isAiConfigured: vi.fn(), reconcileAttendees: vi.fn() }));
vi.mock('./ai.service', () => ({
  AiService: class {
    public isAiConfigured = isAiConfigured;
    public reconcileAttendees = reconcileAttendees;
  },
}));

vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import type { PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { AttendanceReconciliationService } from './attendance-reconciliation.service';

const req = {} as unknown as Request;

function buildParticipant(overrides: Partial<PastMeetingParticipant> = {}): PastMeetingParticipant {
  return {
    uid: 'attendee-1',
    meeting_id: 'meeting-1',
    meeting_and_occurrence_id: 'occ-1',
    past_meeting_id: 'past-1',
    email: '',
    first_name: 'Jane',
    last_name: 'Doe',
    host: false,
    is_attended: true,
    is_invited: false,
    org_is_member: false,
    org_is_project_member: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const pastMeeting = { meeting_id: 'meeting-1', committees: [] } as unknown as PastMeeting;

describe('AttendanceReconciliationService', () => {
  let service: AttendanceReconciliationService;

  beforeEach(() => {
    getPastMeetingParticipants.mockReset();
    getPastOccurrencesForMeeting.mockReset().mockResolvedValue([]);
    updatePastMeetingParticipant.mockReset().mockResolvedValue(undefined);
    getCommitteeMembers.mockReset().mockResolvedValue([]);
    isAiConfigured.mockReset().mockReturnValue(false);
    reconcileAttendees.mockReset();
    service = new AttendanceReconciliationService();
  });

  describe('reconcilePastMeetingParticipants', () => {
    it('returns an empty result with no upstream writes when nothing is unverified', async () => {
      getPastMeetingParticipants.mockResolvedValue([buildParticipant({ is_attended: true, is_verified: true })]);

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result).toEqual({ results: [], candidate_pool_size: 0, auto_applied_count: 0, needs_review_count: 0, pool_degraded: false });
      expect(updatePastMeetingParticipant).not.toHaveBeenCalled();
    });

    it('auto-applies a deterministic exact-email match and marks it verified', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: 'alice@example.com', is_attended: true, is_verified: false }),
        buildParticipant({ uid: 'invitee-1', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith', is_invited: true, is_attended: false }),
      ]);

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ attendee_id: 'attendee-1', confidence: 'high', method: 'deterministic', auto_applied: true });
      expect(result.auto_applied_count).toBe(1);
      expect(result.needs_review_count).toBe(0);
      expect(updatePastMeetingParticipant).toHaveBeenCalledWith(
        req,
        'occ-1',
        'attendee-1',
        expect.objectContaining({ is_verified: true, email: 'alice@example.com' })
      );
    });

    it('never auto-applies a "none" confidence match and always queues it for review', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: 'ghost@example.com', is_attended: true, is_verified: false }),
      ]);
      isAiConfigured.mockReturnValue(false);

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ attendee_id: 'attendee-1', confidence: 'none', auto_applied: false });
      expect(result.auto_applied_count).toBe(0);
      expect(result.needs_review_count).toBe(1);
      expect(updatePastMeetingParticipant).not.toHaveBeenCalled();
    });

    it('does not auto-apply a medium-confidence AI match, even with a resolved candidate', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: '', first_name: 'Jon', last_name: 'Doey', is_attended: true, is_verified: false }),
        buildParticipant({ uid: 'invitee-1', email: 'jon@example.com', first_name: 'Jon', last_name: 'Doe', is_invited: true, is_attended: false }),
      ]);
      isAiConfigured.mockReturnValue(true);
      reconcileAttendees.mockResolvedValue({
        matches: [{ attendee_id: 'attendee-1', matched_candidate_id: 'c0', confidence: 'medium' }],
      });

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results[0]).toMatchObject({ confidence: 'medium', auto_applied: false });
      expect(updatePastMeetingParticipant).not.toHaveBeenCalled();
    });

    it('treats a hallucinated candidate_id from the AI response as "none" rather than trusting it', async () => {
      getPastMeetingParticipants.mockResolvedValue([buildParticipant({ uid: 'attendee-1', email: '', is_attended: true, is_verified: false })]);
      isAiConfigured.mockReturnValue(true);
      reconcileAttendees.mockResolvedValue({
        matches: [{ attendee_id: 'attendee-1', matched_candidate_id: 'does-not-exist', confidence: 'high' }],
      });

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results[0]).toMatchObject({ confidence: 'none', auto_applied: false, matched_candidate: undefined });
    });

    it('defaults an attendee omitted from the AI response to "none" instead of dropping it', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: '', is_attended: true, is_verified: false }),
        buildParticipant({ uid: 'attendee-2', email: '', is_attended: true, is_verified: false }),
      ]);
      isAiConfigured.mockReturnValue(true);
      reconcileAttendees.mockResolvedValue({
        matches: [{ attendee_id: 'attendee-1', matched_candidate_id: null, confidence: 'low' }],
      });

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results).toHaveLength(2);
      const omitted = result.results.find((r) => r.attendee_id === 'attendee-2');
      expect(omitted).toMatchObject({ confidence: 'none', auto_applied: false });
    });

    it('builds the candidate pool from invitees, committee members, and prior verified attendees, deduped by email', async () => {
      getPastMeetingParticipants
        .mockResolvedValueOnce([
          buildParticipant({ uid: 'attendee-1', email: 'dup@example.com', is_attended: true, is_verified: false }),
          buildParticipant({ uid: 'invitee-1', email: 'dup@example.com', is_invited: true, is_attended: false }),
        ])
        .mockResolvedValueOnce([buildParticipant({ uid: 'prior-1', email: 'dup@example.com', is_verified: true, is_attended: true })]);
      getPastOccurrencesForMeeting.mockResolvedValue([{ meeting_and_occurrence_id: 'occ-0' }, { meeting_and_occurrence_id: 'occ-1' }]);
      getCommitteeMembers.mockResolvedValue([{ email: 'dup@example.com', first_name: 'Dup', last_name: 'One' }]);

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', {
        ...pastMeeting,
        committees: [{ uid: 'committee-1' }],
      } as unknown as PastMeeting);

      // All three sources share the same email — the dedup comparator must collapse them to one.
      expect(result.candidate_pool_size).toBe(1);
      // The current occurrence must be fetched once for its own participants, and the prior-occurrence
      // scan must exclude it (only 'occ-0' is scanned) — two calls total, not three.
      expect(getPastMeetingParticipants).toHaveBeenCalledTimes(2);
      expect(getPastMeetingParticipants).toHaveBeenCalledWith(req, 'occ-0', true);
    });

    it('leaves a high-confidence match for review when the write to persist it fails', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: 'alice@example.com', is_attended: true, is_verified: false }),
        buildParticipant({ uid: 'invitee-1', email: 'alice@example.com', is_invited: true, is_attended: false }),
      ]);
      updatePastMeetingParticipant.mockRejectedValue(new Error('upstream 500'));

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results[0]).toMatchObject({ confidence: 'high', auto_applied: false });
      expect(result.needs_review_count).toBe(1);
      expect(result.auto_applied_count).toBe(0);
    });

    it('queues the whole chunk for review instead of failing the request when the AI call throws', async () => {
      getPastMeetingParticipants.mockResolvedValue([
        buildParticipant({ uid: 'attendee-1', email: 'alice@example.com', is_attended: true, is_verified: false }),
        buildParticipant({ uid: 'invitee-1', email: 'alice@example.com', is_invited: true, is_attended: false }),
        buildParticipant({ uid: 'attendee-2', email: '', is_attended: true, is_verified: false }),
      ]);
      isAiConfigured.mockReturnValue(true);
      reconcileAttendees.mockRejectedValue(new Error('upstream AI timeout'));

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      // The deterministic email match for attendee-1 must survive even though the AI call for
      // the ambiguous remainder (attendee-2) throws.
      const deterministic = result.results.find((r) => r.attendee_id === 'attendee-1');
      expect(deterministic).toMatchObject({ confidence: 'high', method: 'deterministic' });

      const aiFailed = result.results.find((r) => r.attendee_id === 'attendee-2');
      expect(aiFailed).toMatchObject({ confidence: 'none', method: 'ai', auto_applied: false });
    });

    it('downgrades a spec-violating response (non-none confidence with no resolvable candidate_id) to none', async () => {
      getPastMeetingParticipants.mockResolvedValue([buildParticipant({ uid: 'attendee-1', email: '', is_attended: true, is_verified: false })]);
      isAiConfigured.mockReturnValue(true);
      reconcileAttendees.mockResolvedValue({
        matches: [{ attendee_id: 'attendee-1', matched_candidate_id: null, confidence: 'high' }],
      });

      const result = await service.reconcilePastMeetingParticipants(req, 'occ-1', pastMeeting);

      expect(result.results[0]).toMatchObject({ confidence: 'none', auto_applied: false, matched_candidate: undefined });
    });
  });
});
