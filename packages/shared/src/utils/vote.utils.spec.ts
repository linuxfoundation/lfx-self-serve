// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

// vote.utils.ts imports @angular/forms, whose import graph reaches Angular's partially-compiled
// @angular/common. Under vitest that needs the JIT compiler as a fallback, so load it before
// importing the module under test (same shim as the apps/lfx-one spec files).
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PollStatus } from '../enums';
import type { Vote, VoteFormValue, VoteResultsResponse } from '../interfaces/poll.interface';
import {
  buildCreateVoteRequest,
  buildDraftUpdateVoteRequest,
  buildDraftVoteRequest,
  buildUpdateVoteRequest,
  computeVoteParticipationStats,
  mapVoteToFormValue,
} from './vote.utils';

/** Minimal VoteFormValue fixture — the request builders only read the fields set here. */
function formValue(overrides: Partial<VoteFormValue> = {}): VoteFormValue {
  return {
    title: 'Board election',
    description: 'Pick the next board members',
    committee: { uid: 'committee-uid', name: 'Board' },
    eligible_participants: 'voting_rep',
    close_date: new Date('2025-06-01T00:00:00Z'),
    close_time: '11:59 PM',
    timezone: 'UTC',
    allow_abstain: false,
    questions: [{ question: 'Who should join?', response_type: 'single', options: ['Alice', 'Bob'] }],
    commentPrompts: [],
    ...overrides,
  };
}

// All four builders must always emit allow_abstain explicitly: ITX updatePoll rebuilds the
// DynamoDB item via PutItem full-replace, so omitting the field would silently reset an
// enabled flag to false on any edit.
const voteRequestBuilders = [
  ['buildCreateVoteRequest', buildCreateVoteRequest],
  ['buildDraftVoteRequest', buildDraftVoteRequest],
  ['buildUpdateVoteRequest', buildUpdateVoteRequest],
  ['buildDraftUpdateVoteRequest', buildDraftUpdateVoteRequest],
] as const;

for (const [name, build] of voteRequestBuilders) {
  describe(name, () => {
    it('emits allow_abstain: true when the form enables it', () => {
      expect(build(formValue({ allow_abstain: true }), 'project-uid').allow_abstain).toBe(true);
    });

    it('emits allow_abstain: false when the form disables it (never omits the field)', () => {
      const request = build(formValue({ allow_abstain: false }), 'project-uid');

      expect(request.allow_abstain).toBe(false);
      expect('allow_abstain' in request).toBe(true);
    });

    // v2 requires end_time_timezone on every vote mutation — the builders must never omit it.
    it('always emits end_time_timezone (required by the v2 vote mutation contract)', () => {
      const request = build(formValue({ timezone: 'America/New_York' }), 'project-uid');

      expect(request.end_time_timezone).toBe('America/New_York');
      expect('end_time_timezone' in request).toBe(true);
    });

    // close_date is built with the local constructor because the calendar (and combineDateTime)
    // read local wall-clock fields — an ISO-string fixture would shift with the test machine's TZ.
    it('combines close_date and close_time into end_time in the picked timezone', () => {
      const request = build(formValue({ close_date: new Date(2025, 5, 1) }), 'project-uid');

      expect(request.end_time).toBe('2025-06-01T23:59:00.000Z');
      expect(request.end_time_timezone).toBe('UTC');
    });
  });
}

// resolveDraftEndTime: drafts bypass form validators, so the draft builders themselves must refuse
// to combine empty/malformed times, missing zones, or DST-gap wall times — a regression there would
// otherwise persist an empty or host-normalized required end_time without any test failing.
const draftVoteRequestBuilders = [
  ['buildDraftVoteRequest', buildDraftVoteRequest],
  ['buildDraftUpdateVoteRequest', buildDraftUpdateVoteRequest],
] as const;

for (const [name, build] of draftVoteRequestBuilders) {
  describe(`${name} — draft deadline fallback`, () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // The fallback is addDays(now, DRAFT_VOTE_DEFAULT_DURATION_DAYS): pinning now and asserting the
    // literal catches a changed default duration as well as a broken fallback.
    it('falls back to the default-duration deadline for an out-of-range time', () => {
      const request = build(formValue({ close_time: '25:99 PM' }), 'project-uid');

      expect(request.end_time).toBe('2025-07-01T12:00:00.000Z');
    });

    it('falls back to the default-duration deadline when the timezone is missing', () => {
      const request = build(formValue({ timezone: '' }), 'project-uid');

      expect(request.end_time).toBe('2025-07-01T12:00:00.000Z');
    });

    it('falls back for a spring-forward-gap wall time instead of persisting a normalized instant', () => {
      // Mar 8 2026 2:30 AM does not exist in America/New_York (US spring-forward).
      const request = build(formValue({ close_date: new Date(2026, 2, 8), close_time: '2:30 AM', timezone: 'America/New_York' }), 'project-uid');

      expect(request.end_time).toBe('2025-07-01T12:00:00.000Z');
    });

    it('preserves the selected instant when date, time, and zone are all valid', () => {
      const request = build(formValue({ close_date: new Date(2025, 5, 1), close_time: '11:59 PM', timezone: 'UTC' }), 'project-uid');

      expect(request.end_time).toBe('2025-06-01T23:59:00.000Z');
    });
  });
}

describe('mapVoteToFormValue', () => {
  /** Minimal Vote fixture — the mapper only reads the fields set here. */
  function vote(overrides: Partial<Vote> = {}): Vote {
    return {
      uid: 'vote-uid',
      name: 'Board election',
      end_time: '2025-06-01T00:00:00Z',
      status: PollStatus.DISABLED,
      project_uid: 'project-uid',
      ...overrides,
    };
  }

  it('round-trips allow_abstain: true into the form value', () => {
    expect(mapVoteToFormValue(vote({ allow_abstain: true })).allow_abstain).toBe(true);
  });

  it('maps allow_abstain: false explicitly', () => {
    expect(mapVoteToFormValue(vote({ allow_abstain: false })).allow_abstain).toBe(false);
  });

  it('defaults allow_abstain to false when the vote predates the field', () => {
    expect(mapVoteToFormValue(vote()).allow_abstain).toBe(false);
  });

  it('hydrates close time and zone from end_time in the stored timezone', () => {
    // 2025-06-01T06:59Z is 2:59 AM in New York (EDT, UTC-4).
    const form = mapVoteToFormValue(vote({ end_time: '2025-06-01T06:59:00.000Z', end_time_timezone: 'America/New_York' }));

    expect(form.timezone).toBe('America/New_York');
    expect(form.close_time).toBe('02:59 AM');
    // close_date's local fields read the vote zone's wall-clock (toZonedTime shift), host-TZ independent.
    expect(form.close_date?.getFullYear()).toBe(2025);
    expect(form.close_date?.getMonth()).toBe(5);
    expect(form.close_date?.getDate()).toBe(1);
  });

  it('hydrates legacy votes (no stored zone) in the Pacific fallback zone', () => {
    // 2025-06-01T07:00Z is midnight in Los Angeles (PDT, UTC-7).
    const form = mapVoteToFormValue(vote({ end_time: '2025-06-01T07:00:00.000Z' }));

    expect(form.timezone).toBe('America/Los_Angeles');
    expect(form.close_time).toBe('12:00 AM');
    expect(form.close_date?.getDate()).toBe(1);
  });
});

describe('computeVoteParticipationStats', () => {
  /** Minimal VoteResultsResponse fixture — the stats computation only reads the num_* fields. */
  function results(overrides: Partial<VoteResultsResponse> = {}): VoteResultsResponse {
    return {
      poll_results: [],
      comment_results: [],
      num_recipients: 4,
      num_votes_cast: 3,
      num_abstained: 1,
      poll_end_time: '2025-06-01T00:00:00Z',
      ...overrides,
    };
  }

  it('returns zeros when results have not loaded', () => {
    expect(computeVoteParticipationStats(null)).toEqual({ eligibleVoters: 0, totalResponses: 0, participationRate: 0, abstainedVoters: 0, abstainedRate: 0 });
  });

  it('maps num_abstained to abstainedVoters', () => {
    expect(computeVoteParticipationStats(results()).abstainedVoters).toBe(1);
  });

  it('computes abstainedRate as the rounded share of all responses cast', () => {
    expect(computeVoteParticipationStats(results()).abstainedRate).toBe(33);
  });

  it('guards abstainedRate against zero responses', () => {
    expect(computeVoteParticipationStats(results({ num_votes_cast: 0, num_abstained: 0 })).abstainedRate).toBe(0);
  });

  it('keeps participationRate as the share of eligible voters (abstentions count as responses)', () => {
    expect(computeVoteParticipationStats(results()).participationRate).toBe(75);
  });
});
