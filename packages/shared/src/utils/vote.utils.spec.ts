// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

// vote.utils.ts imports @angular/forms, whose import graph reaches Angular's partially-compiled
// @angular/common. Under vitest that needs the JIT compiler as a fallback, so load it before
// importing the module under test (same shim as the apps/lfx-one spec files).
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGACY_VOTE_TIMEZONE } from '../constants/timezones.constants';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { IndexedVoteResponseStatus, PollStatus, PollType, VoteResponseStatus, VoteRowParticipationState, VoteVoterStatus } from '../enums';
import type {
  MyVoteResponse,
  PollAnswer,
  PollCommentResponse,
  PollCommentResult,
  PollQuestionResult,
  UserChoice,
  Vote,
  VoteFormValue,
  VoteResultsResponse,
  VoterResultsState,
  VoteVoter,
} from '../interfaces/poll.interface';
import { getUserTimezone } from './date-time.utils';
import {
  buildCreateVoteRequest,
  buildDraftUpdateVoteRequest,
  buildDraftVoteRequest,
  buildRankedQuestionViews,
  buildUpdateVoteRequest,
  buildVoteBallotQuestions,
  buildVoteResultsQuestions,
  buildVoteVoterChoiceFilterOptions,
  buildVoteVoterChoiceSummaries,
  buildVoteVoterRowView,
  canVoterFetchVoteResults,
  compareVotesByRecency,
  computeVoteParticipationStats,
  computeVoteRowParticipation,
  countVoteVotersByStatus,
  getVoteVisibilityRules,
  getVoteVoterStatus,
  isRankedPollType,
  isVoteClosingSoon,
  mapFiltersToEligibility,
  mapVoteToCloneFormValue,
  mapVoteToFormValue,
  matchesMyVotesQuickFilter,
  matchesVoteVoterChoice,
  mergeCommentResults,
  resolveVoterResultsState,
  sortVoteVotersForDisplay,
  votePermalinkPath,
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

describe('matchesMyVotesQuickFilter', () => {
  const nowMs = Date.parse('2026-10-09T12:00:00Z');
  const vote = (overrides: Partial<Vote> = {}): Vote => ({
    uid: 'synthetic-vote',
    name: 'Synthetic election',
    project_uid: 'synthetic-project',
    status: PollStatus.ACTIVE,
    end_time: '2026-10-10T12:00:00Z',
    response_status: VoteResponseStatus.AWAITING_RESPONSE,
    ...overrides,
  });

  it.each([
    ['2026-10-09T11:59:59.999Z', false],
    ['2026-10-09T12:00:00Z', false],
    ['2026-10-09T12:00:00.001Z', true],
    ['2026-10-16T12:00:00Z', true],
    ['2026-10-16T08:00:00-04:00', true],
    ['2026-10-16T12:00:00.001Z', false],
    ['', false],
    ['invalid', false],
  ])('matches deadline %s: %s', (end_time, expected) => {
    expect(matchesMyVotesQuickFilter(vote({ end_time }), 'closing-soon', nowMs)).toBe(expected);
    expect(isVoteClosingSoon(vote({ end_time }), nowMs)).toBe(expected);
  });

  it('includes responded votes only in the deadline summary', () => {
    const responded = vote({ response_status: VoteResponseStatus.RESPONDED });
    expect(matchesMyVotesQuickFilter(responded, 'closing-soon', nowMs)).toBe(true);
    expect(matchesMyVotesQuickFilter(responded, 'needs-vote', nowMs)).toBe(false);
  });

  it.each(['2026-11-01T12:00:00Z', '2026-10-01T12:00:00Z', '', 'invalid'])('keeps awaiting-response semantics independent of deadline %s', (end_time) => {
    expect(matchesMyVotesQuickFilter(vote({ end_time }), 'needs-vote', nowMs)).toBe(true);
  });

  it('does not infer an invitation from an absent response status', () => {
    expect(matchesMyVotesQuickFilter(vote({ response_status: undefined }), 'needs-vote', nowMs)).toBe(false);
  });

  it.each([PollStatus.DISABLED, PollStatus.ENDED, 'unknown'])('excludes inactive status %s from both summaries', (status) => {
    expect(matchesMyVotesQuickFilter(vote({ status: status as PollStatus }), 'closing-soon', nowMs)).toBe(false);
    expect(isVoteClosingSoon(vote({ status: status as PollStatus }), nowMs)).toBe(false);
    expect(matchesMyVotesQuickFilter(vote({ status: status as PollStatus }), 'needs-vote', nowMs)).toBe(false);
  });

  it('normalizes mixed-case ACTIVE status', () => {
    const active = vote({ status: 'AcTiVe' as PollStatus });
    expect(matchesMyVotesQuickFilter(active, 'closing-soon', nowMs)).toBe(true);
    expect(isVoteClosingSoon(active, nowMs)).toBe(true);
    expect(matchesMyVotesQuickFilter(active, 'needs-vote', nowMs)).toBe(true);
  });
});

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
      expect(request.end_time_timezone).toBe(LEGACY_VOTE_TIMEZONE);
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
    // close_date's local fields read the vote zone's wall-clock (noon-pinned host-safe carrier), host-TZ independent.
    expect(form.close_date?.getFullYear()).toBe(2025);
    expect(form.close_date?.getMonth()).toBe(5);
    expect(form.close_date?.getDate()).toBe(1);
  });

  it('hydrates a deadline whose wall time falls in the browser zone DST gap without shifting it', () => {
    // Tokyo deadline 2027-03-14 02:30 JST = 2027-03-13T17:30Z. America/New_York springs forward at
    // 2:00 AM on 2027-03-14, so a New York browser has no local 2:30 that day — toZonedTime's
    // host-local carrier normalized it to 3:30, and resaving the edit form silently moved the
    // deadline by one hour. The Intl-parts hydration must read the exact wall time on any host.
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const form = mapVoteToFormValue(vote({ end_time: '2027-03-13T17:30:00.000Z', end_time_timezone: 'Asia/Tokyo' }));

      expect(form.close_time).toBe('02:30 AM');
      expect(form.close_date?.getFullYear()).toBe(2027);
      expect(form.close_date?.getMonth()).toBe(2);
      expect(form.close_date?.getDate()).toBe(14);
    } finally {
      // `process.env.TZ = previousTz` alone would coerce an originally-unset TZ into the string "undefined".
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('hydrates legacy votes (no stored zone) in the Pacific fallback zone', () => {
    // 2025-06-01T07:00Z is midnight in Los Angeles (PDT, UTC-7).
    const form = mapVoteToFormValue(vote({ end_time: '2025-06-01T07:00:00.000Z' }));

    expect(form.timezone).toBe('America/Los_Angeles');
    expect(form.close_time).toBe('12:00 AM');
    expect(form.close_date?.getDate()).toBe(1);
  });
});

describe('mapVoteToCloneFormValue', () => {
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

  const NOW = Date.parse('2025-05-01T00:00:00Z');

  it('prefixes the title with "Copy of "', () => {
    const form = mapVoteToCloneFormValue(vote({ name: 'Board election' }), NOW);
    expect(form.title).toBe('Copy of Board election');
  });

  it('does not double-prefix when cloning an already-cloned vote', () => {
    const form = mapVoteToCloneFormValue(vote({ name: 'Copy of Board election' }), NOW);
    expect(form.title).toBe('Copy of Board election');
  });

  it('clamps the prefixed title to the 200-character form limit', () => {
    const longName = 'B'.repeat(199);
    const form = mapVoteToCloneFormValue(vote({ name: longName }), NOW);
    expect(form.title.length).toBe(200);
    expect(form.title.startsWith('Copy of ')).toBe(true);
  });

  it('keeps the source deadline when it is still in the future', () => {
    const source = mapVoteToFormValue(vote({ end_time: '2025-06-01T00:00:00Z' }));
    const cloned = mapVoteToCloneFormValue(vote({ end_time: '2025-06-01T00:00:00Z' }), NOW);

    expect(cloned.close_date?.getTime()).toBe(source.close_date?.getTime());
    expect(cloned.close_time).toBe(source.close_time);
  });

  it('resets the deadline to 7 days out in the organizer timezone when the source deadline has already passed', () => {
    // NOW is 2025-05-01T00:00Z; +7 days in UTC is 2025-05-08 — host pinned to UTC so the carrier's
    // calendar fields land on that day regardless of the source's own stored zone (here, Tokyo).
    const previousTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const cloned = mapVoteToCloneFormValue(vote({ end_time: '2025-04-01T00:00:00Z', end_time_timezone: 'Asia/Tokyo' }), NOW);

      expect(cloned.timezone).toBe(getUserTimezone());
      expect(cloned.close_date?.getFullYear()).toBe(2025);
      expect(cloned.close_date?.getMonth()).toBe(4);
      expect(cloned.close_date?.getDate()).toBe(8);
      expect(cloned.close_time).toBe('11:59 PM');
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it("resets into the organizer's own timezone, not the legacy-vote fallback, when the source stored no zone", () => {
    const cloned = mapVoteToCloneFormValue(vote({ end_time: '2025-04-01T00:00:00Z', end_time_timezone: undefined }), NOW);
    expect(cloned.timezone).toBe(getUserTimezone());
  });

  it('preserves committee, eligibility and questions from the source vote', () => {
    const source = vote({
      committee_uid: 'committee-uid',
      committee_filters: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
      poll_questions: [
        {
          question_id: 'q1',
          prompt: 'Who should join?',
          type: 'single_choice',
          choices: [
            { choice_id: 'c1', choice_text: 'Alice' },
            { choice_id: 'c2', choice_text: 'Bob' },
          ],
        },
      ],
    });
    const cloned = mapVoteToCloneFormValue(source, NOW);

    expect(cloned.committee?.uid).toBe('committee-uid');
    expect(cloned.eligible_participants).toBe('voting_rep,alternate_voting_rep');
    expect(cloned.questions).toEqual([{ question: 'Who should join?', response_type: 'single', options: ['Alice', 'Bob'] }]);
  });
});

describe('mapFiltersToEligibility', () => {
  // Pins the real widening rule: it keys on presence of Observer/Emeritus, not on absence of
  // Alternate/Emeritus — a set missing Alternate/Emeritus but containing neither Observer nor
  // Emeritus is NOT widened to 'all'.
  it("widens to 'all' when the filter set contains Observer or Emeritus", () => {
    expect(mapFiltersToEligibility([CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.EMERITUS])).toBe('all');
    expect(mapFiltersToEligibility([CommitteeMemberVotingStatus.VOTING_REP])).toBe('voting_rep');
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

  it.each([
    [0, 200, 0],
    [1, 200, 1],
    [8, 12, 67],
    [198, 200, 99],
    [199, 200, 99],
    [200, 200, 100],
    [240, 200, 100],
  ])('matches table participation for %i of %i responses at %i percent', (responses, invited, expectedPercent) => {
    const stats = computeVoteParticipationStats(results({ num_votes_cast: responses, num_recipients: invited }));

    expect(stats.participationRate).toBe(expectedPercent);
    expect(stats.totalResponses).toBe(responses);
    expect(stats.eligibleVoters).toBe(invited);

    for (const status of [PollStatus.ACTIVE, PollStatus.ENDED]) {
      const vote: Vote = {
        uid: 'vote-uid',
        name: 'Board election',
        end_time: '2025-06-01T00:00:00Z',
        status,
        project_uid: 'project-uid',
        num_response_received: responses,
        total_voting_request_invitations: invited,
      };

      expect(computeVoteRowParticipation(vote).percent).toBe(stats.participationRate);
    }
  });

  it('keeps a zero-person electorate at zero in the results drawer', () => {
    expect(computeVoteParticipationStats(results({ num_votes_cast: 0, num_recipients: 0 })).participationRate).toBe(0);
  });
});

/** Minimal results fixture for the results view-model builders. */
function resultsWith(pollResults: PollQuestionResult[], overrides: Partial<VoteResultsResponse> = {}): VoteResultsResponse {
  return {
    poll_results: pollResults,
    comment_results: [],
    num_recipients: 10,
    num_votes_cast: 5,
    num_abstained: 0,
    poll_end_time: '2025-06-01T00:00:00Z',
    ...overrides,
  };
}

/** Generic question from [choiceId, voteCount, apiPercentage] tuples; `choices` omits ids listed in `untitled`. */
function genericQuestion(counts: [string, number, number][], untitled: string[] = []): PollQuestionResult {
  return {
    question: {
      question_id: 'q1',
      prompt: 'Approve the charter?',
      type: 'single_choice',
      choices: counts.filter(([id]) => !untitled.includes(id)).map(([id]) => ({ choice_id: id, choice_text: `Option ${id}` })),
    },
    generic_choice_votes: counts.map(([choiceId, voteCount, percentage]) => ({ choice_id: choiceId, vote_count: voteCount, percentage })),
    ranked_choice_votes: [],
  };
}

describe('buildVoteResultsQuestions', () => {
  it('returns no questions when results are missing or empty', () => {
    expect(buildVoteResultsQuestions(null, false)).toEqual([]);
    expect(buildVoteResultsQuestions(resultsWith([]), true)).toEqual([]);
  });

  it('maps question metadata and sums choice votes into totalVotes', () => {
    const [question] = buildVoteResultsQuestions(
      resultsWith([
        genericQuestion([
          ['c1', 3, 60],
          ['c2', 1, 20],
        ]),
      ]),
      false
    );
    expect(question.questionId).toBe('q1');
    expect(question.question).toBe('Approve the charter?');
    expect(question.totalVotes).toBe(4);
    expect(question.options.map((o) => [o.choiceId, o.text, o.voteCount, o.percentage])).toEqual([
      ['c1', 'Option c1', 3, 60],
      ['c2', 'Option c2', 1, 20],
    ]);
  });

  it('falls back to num_votes_cast for a missing upstream percentage', () => {
    const [question] = buildVoteResultsQuestions(
      resultsWith(
        [
          genericQuestion([
            ['c1', 2, 0],
            ['c2', 1, 0],
          ]),
        ],
        { num_votes_cast: 8 }
      ),
      false
    );
    expect(question.options.map((o) => o.percentage)).toEqual([25, 13]);
  });

  it('keeps a zero percentage when no votes were cast', () => {
    const [question] = buildVoteResultsQuestions(resultsWith([genericQuestion([['c1', 0, 0]])], { num_votes_cast: 0 }), false);
    expect(question.options[0].percentage).toBe(0);
  });

  it('falls back to the choice id when the choice text is missing', () => {
    const [question] = buildVoteResultsQuestions(resultsWith([genericQuestion([['c9', 1, 100]], ['c9'])]), false);
    expect(question.options[0].text).toBe('c9');
  });

  it('marks the leading option while live, without winner or tie markers', () => {
    const [question] = buildVoteResultsQuestions(
      resultsWith([
        genericQuestion([
          ['c1', 3, 60],
          ['c2', 1, 20],
        ]),
      ]),
      false
    );
    expect(question.options.map((o) => [o.isLeading, o.isWinner, o.isTied])).toEqual([
      [true, false, false],
      [false, false, false],
    ]);
  });

  it('marks a single winner only when closed', () => {
    const [question] = buildVoteResultsQuestions(
      resultsWith([
        genericQuestion([
          ['c1', 3, 60],
          ['c2', 1, 20],
        ]),
      ]),
      true
    );
    expect(question.options.map((o) => [o.isWinner, o.isTied])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it('marks ties only when closed', () => {
    const tied = resultsWith([
      genericQuestion([
        ['c1', 2, 40],
        ['c2', 2, 40],
        ['c3', 1, 20],
      ]),
    ]);
    expect(buildVoteResultsQuestions(tied, true)[0].options.map((o) => [o.isWinner, o.isTied])).toEqual([
      [false, true],
      [false, true],
      [false, false],
    ]);
    expect(buildVoteResultsQuestions(tied, false)[0].options.every((o) => !o.isTied && !o.isWinner)).toBe(true);
  });

  it('never marks a winner, tie or leader when every option has zero votes', () => {
    const [question] = buildVoteResultsQuestions(
      resultsWith([
        genericQuestion([
          ['c1', 0, 0],
          ['c2', 0, 0],
        ]),
      ]),
      true
    );
    expect(question.options.every((o) => !o.isWinner && !o.isTied && !o.isLeading)).toBe(true);
  });
});

describe('buildRankedQuestionViews', () => {
  function rankedQuestion(overrides: Partial<PollQuestionResult> = {}): PollQuestionResult {
    return {
      question: {
        question_id: 'q1',
        prompt: 'Rank the candidates',
        type: 'single_choice',
        choices: [
          { choice_id: 'c1', choice_text: 'Candidate One' },
          { choice_id: 'c2', choice_text: 'Candidate Two' },
        ],
      },
      generic_choice_votes: [],
      ranked_choice_votes: [
        {
          choice_id: 'c1',
          rank_counts: [
            { rank: 1, count: 3 },
            { rank: 2, count: 1 },
          ],
          condorcet_matrix: [],
        },
        { choice_id: 'c2', rank_counts: [], condorcet_matrix: [] },
      ],
      ...overrides,
    };
  }

  it('returns no questions when results are missing or empty', () => {
    expect(buildRankedQuestionViews(null)).toEqual([]);
    expect(buildRankedQuestionViews(resultsWith([]))).toEqual([]);
  });

  it('derives rank-count percentages against each choice total', () => {
    const [view] = buildRankedQuestionViews(resultsWith([rankedQuestion()]));
    expect(view.questionId).toBe('q1');
    expect(view.prompt).toBe('Rank the candidates');
    expect(view.choiceDistributions).toEqual([
      {
        choiceId: 'c1',
        choiceText: 'Candidate One',
        totalRanked: 4,
        rankCounts: [
          { rank: 1, count: 3, percentage: 75 },
          { rank: 2, count: 1, percentage: 25 },
        ],
      },
      { choiceId: 'c2', choiceText: 'Candidate Two', totalRanked: 0, rankCounts: [] },
    ]);
  });

  it('prefers winner-info choice text and falls back to the choice id', () => {
    const [view] = buildRankedQuestionViews(
      resultsWith([
        rankedQuestion({
          ranked_choice_winner_info: { poll_choices: [{ choice_id: 'c1', choice_text: 'Winner-info One' }], condorcet_irv_used_for_eliminations: false },
        }),
      ])
    );
    expect(view.choiceDistributions.map((d) => d.choiceText)).toEqual(['Winner-info One', 'c2']);
  });

  it('treats missing ranked votes as no distributions', () => {
    const question = rankedQuestion();
    // @ts-expect-error -- models a payload that omits the required ranked_choice_votes
    delete question.ranked_choice_votes;
    const [view] = buildRankedQuestionViews(resultsWith([question]));
    expect(view.choiceDistributions).toEqual([]);
  });

  it('flags a round summary for IRV and Meek STV only', () => {
    const views = buildRankedQuestionViews(
      resultsWith([rankedQuestion({ irv_round_summary: { rounds: [] } }), rankedQuestion({ meek_stv_round_summary: { rounds: [] } }), rankedQuestion()])
    );
    expect(views.map((v) => v.hasRoundSummary)).toEqual([true, true, false]);
  });
});

describe('mergeCommentResults', () => {
  function response(voteId: string, createdAt: string): PollCommentResponse {
    return { vote_id: voteId, comment_text: `Comment ${voteId}`, vote_creation_time: createdAt, abstained: false };
  }

  const older = response('r-old', '2025-06-01T00:00:00Z');
  const newer = response('r-new', '2025-06-02T00:00:00Z');
  const commentResults: PollCommentResult[] = [
    { prompt: { prompt_id: 'p1', prompt: 'Results prompt one' }, responses: [older, newer], total_responses: 3 },
    { prompt: { prompt_id: 'p2', prompt: 'Results prompt two' }, responses: [] },
  ];

  it('uses the detail prompts, left-joining responses newest-first', () => {
    const merged = mergeCommentResults(commentResults, [
      { prompt_id: 'p1', prompt: 'Detail prompt one' },
      { prompt_id: 'p3', prompt: 'Detail prompt three' },
    ]);
    expect(merged).toEqual([
      { prompt: { prompt_id: 'p1', prompt: 'Detail prompt one' }, responses: [newer, older], total_responses: 3 },
      { prompt: { prompt_id: 'p3', prompt: 'Detail prompt three' }, responses: [], total_responses: undefined },
    ]);
  });

  it('falls back to results prompts that have responses when the detail has no prompts', () => {
    for (const detailPrompts of [undefined, []]) {
      expect(mergeCommentResults(commentResults, detailPrompts)).toEqual([
        { prompt: { prompt_id: 'p1', prompt: 'Results prompt one' }, responses: [newer, older], total_responses: 3 },
      ]);
    }
  });

  it('does not mutate the API payload', () => {
    mergeCommentResults(commentResults, undefined);
    expect(commentResults[0].responses).toEqual([older, newer]);
  });
});

describe('computeVoteRowParticipation', () => {
  /** Minimal Vote fixture — the participation summary only reads status and the two indexed counts. */
  function rowVote(overrides: Partial<Vote> = {}): Vote {
    return {
      uid: 'vote-uid',
      name: 'Board election',
      end_time: '2025-06-01T00:00:00Z',
      status: PollStatus.ACTIVE,
      project_uid: 'project-uid',
      num_response_received: 8,
      total_voting_request_invitations: 12,
      ...overrides,
    };
  }

  it('summarises an active vote as responses of invited with a rounded percent', () => {
    expect(computeVoteRowParticipation(rowVote())).toEqual({
      state: VoteRowParticipationState.PROGRESS,
      responses: 8,
      invited: 12,
      percent: 67,
      label: '8 of 12 responded · 67%',
      secondaryLabel: null,
      ariaLabel: 'Participation: 8 of 12 responded, 67%',
    });
  });

  it('applies the same math to an ended vote, whatever the raw status casing', () => {
    const participation = computeVoteRowParticipation(rowVote({ status: 'ENDED' as PollStatus }));

    expect(participation.state).toBe(VoteRowParticipationState.PROGRESS);
    expect(participation.label).toBe('8 of 12 responded · 67%');
    expect(participation.ariaLabel).toBeNull();
  });

  it('shows a draft as not open, even when the payload carries counts', () => {
    expect(computeVoteRowParticipation(rowVote({ status: PollStatus.DISABLED }))).toMatchObject({
      state: VoteRowParticipationState.NOT_OPEN,
      responses: null,
      invited: null,
      percent: null,
      label: 'Not open yet',
      ariaLabel: null,
    });
  });

  it('reports missing responses as unavailable rather than zero', () => {
    expect(computeVoteRowParticipation(rowVote({ num_response_received: undefined }))).toMatchObject({
      state: VoteRowParticipationState.UNAVAILABLE,
      responses: null,
      percent: null,
      label: 'Unavailable',
      ariaLabel: null,
    });
  });

  it('never coerces a string count from upstream', () => {
    // @ts-expect-error: malformed upstream data intentionally violates the numeric count contract.
    const participation = computeVoteRowParticipation(rowVote({ num_response_received: '8' }));

    expect(participation.state).toBe(VoteRowParticipationState.UNAVAILABLE);
    expect(participation.ariaLabel).toBeNull();
  });

  it('shows the response count alone when the invited total is missing', () => {
    expect(computeVoteRowParticipation(rowVote({ total_voting_request_invitations: undefined }))).toMatchObject({
      state: VoteRowParticipationState.COUNT_ONLY,
      responses: 8,
      invited: null,
      percent: null,
      label: '8 responded',
      secondaryLabel: 'Total unavailable',
      ariaLabel: null,
    });
  });

  it('never produces a percent for a zero-person electorate', () => {
    const participation = computeVoteRowParticipation(rowVote({ num_response_received: 0, total_voting_request_invitations: 0 }));

    expect(participation).toMatchObject({ state: VoteRowParticipationState.NO_ELECTORATE, percent: null, label: 'No one invited', ariaLabel: null });
    expect(participation.label).not.toMatch(/%/);
  });

  // GH-4078: a just-opened vote's index row can still report a zero/missing electorate.
  it.each([0, undefined])('shows a just-opened vote with a %s electorate as counting, never "No one invited"', (invited) => {
    const participation = computeVoteRowParticipation(rowVote({ num_response_received: undefined, total_voting_request_invitations: invited }), true);

    expect(participation).toMatchObject({
      state: VoteRowParticipationState.COUNTING,
      responses: null,
      invited: null,
      percent: null,
      label: 'Counting invitations…',
      ariaLabel: null,
    });
  });

  it('shows the real participation of a just-opened vote once its electorate is reported', () => {
    expect(computeVoteRowParticipation(rowVote({ num_response_received: 0, total_voting_request_invitations: 4 }), true)).toMatchObject({
      state: VoteRowParticipationState.PROGRESS,
      label: '0 of 4 responded · 0%',
    });
  });

  it('keeps a just-created draft as not open while it awaits its count', () => {
    expect(computeVoteRowParticipation(rowVote({ status: PollStatus.DISABLED, total_voting_request_invitations: 0 }), true).state).toBe(
      VoteRowParticipationState.NOT_OPEN
    );
  });

  it('treats zero responses with a known electorate as a confirmed 0%', () => {
    expect(computeVoteRowParticipation(rowVote({ num_response_received: 0 }))).toMatchObject({
      state: VoteRowParticipationState.PROGRESS,
      percent: 0,
      label: '0 of 12 responded · 0%',
    });
  });

  it('provides a progress-bar summary for an active vote with raw uppercase status', () => {
    expect(computeVoteRowParticipation(rowVote({ status: 'ACTIVE' as PollStatus })).ariaLabel).toBe('Participation: 8 of 12 responded, 67%');
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('caps incomplete participation at 99%% for a %s vote', (status) => {
    expect(computeVoteRowParticipation(rowVote({ status, num_response_received: 199, total_voting_request_invitations: 200 }))).toMatchObject({
      percent: 99,
      label: '199 of 200 responded · 99%',
      ariaLabel: status === PollStatus.ACTIVE ? 'Participation: 199 of 200 responded, 99%' : null,
    });
  });

  it('shows 100% when every invited voter has responded', () => {
    expect(computeVoteRowParticipation(rowVote({ num_response_received: 200, total_voting_request_invitations: 200 }))).toMatchObject({
      percent: 100,
      label: '200 of 200 responded · 100%',
      ariaLabel: 'Participation: 200 of 200 responded, 100%',
    });
  });

  it('clamps the percent to 100 under index lag but keeps the raw counts in the label', () => {
    expect(computeVoteRowParticipation(rowVote({ num_response_received: 13 }))).toMatchObject({ percent: 100, label: '13 of 12 responded · 100%' });
  });

  it('never words participation as quorum, approval, or an outcome', () => {
    const rows = [
      rowVote(),
      rowVote({ status: PollStatus.DISABLED }),
      rowVote({ num_response_received: undefined }),
      rowVote({ total_voting_request_invitations: undefined }),
      rowVote({ total_voting_request_invitations: 0 }),
    ];

    for (const participation of rows.map((vote) => computeVoteRowParticipation(vote))) {
      const text = [participation.label, participation.secondaryLabel, participation.ariaLabel].join(' ');
      expect(text).not.toMatch(/quorum|approv|pass|win/i);
    }
  });
});

describe('compareVotesByRecency', () => {
  /** Minimal Vote fixture — the comparator only reads uid, status, and creation_time. */
  function recencyVote(overrides: Partial<Vote> = {}): Vote {
    return {
      uid: 'vote-uid',
      name: 'Board election',
      end_time: '2025-06-01T00:00:00Z',
      status: PollStatus.ENDED,
      project_uid: 'project-uid',
      creation_time: '2025-05-01T00:00:00Z',
      ...overrides,
    };
  }

  const uids = (votes: Vote[]): string[] => votes.map((v) => v.uid);

  it('sorts active votes before ended and disabled votes', () => {
    const sorted = [
      recencyVote({ uid: 'ended', status: PollStatus.ENDED, creation_time: '2025-05-10T00:00:00Z' }),
      recencyVote({ uid: 'active', status: PollStatus.ACTIVE, creation_time: '2025-05-01T00:00:00Z' }),
      recencyVote({ uid: 'disabled', status: PollStatus.DISABLED, creation_time: '2025-05-20T00:00:00Z' }),
    ].sort(compareVotesByRecency);

    // 'active' leads despite being the oldest; 'disabled' precedes 'ended' on creation_time desc.
    expect(uids(sorted)).toEqual(['active', 'disabled', 'ended']);
  });

  it('orders newest-created first within a tier', () => {
    const sorted = [
      recencyVote({ uid: 'older', creation_time: '2025-05-01T00:00:00Z' }),
      recencyVote({ uid: 'newest', creation_time: '2025-06-10T00:00:00Z' }),
      recencyVote({ uid: 'middle', creation_time: '2025-05-15T00:00:00Z' }),
    ].sort(compareVotesByRecency);

    expect(uids(sorted)).toEqual(['newest', 'middle', 'older']);
  });

  it('keeps ended and disabled votes in one tier, interleaved by creation_time desc', () => {
    const sorted = [
      recencyVote({ uid: 'disabled-new', status: PollStatus.DISABLED, creation_time: '2025-05-20T00:00:00Z' }),
      recencyVote({ uid: 'ended-old', status: PollStatus.ENDED, creation_time: '2025-05-01T00:00:00Z' }),
      recencyVote({ uid: 'ended-new', status: PollStatus.ENDED, creation_time: '2025-05-25T00:00:00Z' }),
    ].sort(compareVotesByRecency);

    expect(uids(sorted)).toEqual(['ended-new', 'disabled-new', 'ended-old']);
  });

  it('sorts a vote with a missing creation_time last within its tier', () => {
    const sorted = [recencyVote({ uid: 'no-timestamp', creation_time: undefined }), recencyVote({ uid: 'old', creation_time: '2020-01-01T00:00:00Z' })].sort(
      compareVotesByRecency
    );

    expect(uids(sorted)).toEqual(['old', 'no-timestamp']);
  });

  it('treats an unparseable creation_time like a missing one instead of producing NaN', () => {
    const sorted = [recencyVote({ uid: 'garbage', creation_time: 'not-a-date' }), recencyVote({ uid: 'old', creation_time: '2020-01-01T00:00:00Z' })].sort(
      compareVotesByRecency
    );

    expect(uids(sorted)).toEqual(['old', 'garbage']);
  });

  it('tiers a non-canonical-case ACTIVE vote into the active group — Vote.status casing is not runtime-guaranteed (poll.utils.ts)', () => {
    const sorted = [
      recencyVote({ uid: 'ended-new', status: PollStatus.ENDED, creation_time: '2025-06-01T00:00:00Z' }),
      recencyVote({ uid: 'loud-active', status: 'ACTIVE' as PollStatus, creation_time: '2025-05-01T00:00:00Z' }),
    ].sort(compareVotesByRecency);

    // 'loud-active' leads despite being older and non-canonically cased.
    expect(uids(sorted)).toEqual(['loud-active', 'ended-new']);
  });

  it('breaks creation_time ties on uid ascending so pagination is deterministic', () => {
    const sorted = [
      recencyVote({ uid: 'bbb', creation_time: '2025-05-01T00:00:00Z' }),
      recencyVote({ uid: 'aaa', creation_time: '2025-05-01T00:00:00Z' }),
      recencyVote({ uid: 'ccc' }), // default creation_time matches the other two
    ].sort(compareVotesByRecency);

    expect(uids(sorted)).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('votePermalinkPath', () => {
  it('builds the flat, lens-independent permalink path', () => {
    expect(votePermalinkPath('abc')).toBe('/votes/abc');
  });

  it('encodes reserved characters so the uid stays one path segment', () => {
    expect(votePermalinkPath('a/b?c#d')).toBe('/votes/a%2Fb%3Fc%23d');
  });
});

describe('voter results helpers', () => {
  const vote = (overrides: Partial<Vote> = {}): Vote => ({
    uid: 'synthetic-vote',
    name: 'Synthetic election',
    project_uid: 'synthetic-project',
    status: PollStatus.ACTIVE,
    end_time: '2026-10-10T12:00:00Z',
    ...overrides,
  });
  const response = (overrides: Partial<MyVoteResponse> = {}): MyVoteResponse => ({
    uid: 'synthetic-response',
    vote_uid: 'synthetic-vote',
    vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE,
    ...overrides,
  });
  const responded = response({ vote_status: IndexedVoteResponseStatus.RESPONDED });

  describe('resolveVoterResultsState', () => {
    it.each<[string, Vote | null, MyVoteResponse | null, boolean, boolean, VoteResponseStatus | undefined, VoterResultsState]>([
      ['no vote loaded yet', null, null, false, false, undefined, 'not_voted'],
      ['removed voter, even on a closed vote', vote({ status: PollStatus.ENDED }), response({ voter_removed: true }), false, false, undefined, 'access_denied'],
      ['settled empty response (never invited)', vote({ status: PollStatus.ENDED }), null, false, false, undefined, 'not_participant'],
      ['empty response still loading', vote(), null, true, false, undefined, 'not_voted'],
      ['empty response after a failed lookup', vote(), null, false, true, undefined, 'not_voted'],
      ['closed vote for a participant', vote({ status: PollStatus.ENDED }), responded, false, false, undefined, 'closed'],
      ['closed vote for an invitee who never voted', vote({ status: PollStatus.ENDED }), response(), false, false, undefined, 'closed'],
      ['mixed-case Ended status for a participant', vote({ status: 'Ended' as PollStatus }), responded, false, false, undefined, 'closed'],
      ['upper-case ENDED status for a participant', vote({ status: 'ENDED' as PollStatus }), responded, false, false, undefined, 'closed'],
      ['active vote with a recorded ballot', vote(), responded, false, false, undefined, 'submitted'],
      ['active vote, list row says responded', vote(), response(), false, false, VoteResponseStatus.RESPONDED, 'submitted'],
      ['active vote, vote row says responded', vote({ response_status: VoteResponseStatus.RESPONDED }), response(), false, false, undefined, 'submitted'],
      [
        'active vote, list row status wins over the vote row',
        vote({ response_status: VoteResponseStatus.RESPONDED }),
        response(),
        false,
        false,
        VoteResponseStatus.AWAITING_RESPONSE,
        'not_voted',
      ],
      ['active vote awaiting a ballot', vote(), response(), false, false, undefined, 'not_voted'],
    ])('%s', (_label, v, my, loading, error, listStatus, expected) => {
      expect(resolveVoterResultsState(v, my, loading, error, listStatus)).toBe(expected);
    });
  });

  describe('canVoterFetchVoteResults', () => {
    const ended = vote({ status: PollStatus.ENDED });

    it.each<[string, Vote | null, MyVoteResponse | null, boolean, boolean, boolean]>([
      ['ended vote with a settled matching response', ended, responded, false, false, true],
      ['ended vote for an invitee who never voted', ended, response(), false, false, true],
      ['mixed-case Ended status', vote({ status: 'Ended' as PollStatus }), responded, false, false, true],
      ['upper-case ENDED status', vote({ status: 'ENDED' as PollStatus }), responded, false, false, true],
      ['active vote', vote(), responded, false, false, false],
      ['vote not loaded', null, responded, false, false, false],
      ['removed voter', ended, response({ voter_removed: true }), false, false, false],
      ['no response row', ended, null, false, false, false],
      ['response still loading', ended, responded, true, false, false],
      ['response lookup failed', ended, responded, false, true, false],
      ['stale vote from another uid', vote({ uid: 'other-vote', status: PollStatus.ENDED }), responded, false, false, false],
      ['stale response from another uid', ended, response({ vote_uid: 'other-vote', vote_status: IndexedVoteResponseStatus.RESPONDED }), false, false, false],
    ])('%s', (_label, v, my, loading, error, expected) => {
      expect(canVoterFetchVoteResults('synthetic-vote', v, my, loading, error)).toBe(expected);
    });
  });

  describe('getVoteVisibilityRules', () => {
    it.each<['voter' | 'creator', boolean]>([
      ['creator', true],
      ['creator', false],
      ['voter', true],
      ['voter', false],
    ])('describes the %s view (closed: %s) of a pseudo-anonymous vote without exposing ballots', (audience, isClosed) => {
      const rules = getVoteVisibilityRules(audience, true, isClosed);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules).toContain('No one sees how another voter voted on this page.');
    });

    it.each<['voter' | 'creator', boolean]>([
      ['creator', true],
      ['creator', false],
      ['voter', true],
      ['voter', false],
    ])('never promises individual ballots with missing privacy metadata for %s (closed: %s)', (audience, isClosed) => {
      const rules = getVoteVisibilityRules(audience, undefined, isClosed);
      expect(rules).toContain('No one sees how another voter voted on this page.');
      expect(rules.at(-1)).toBe('Ballot privacy information is unavailable.');
      expect(rules.join(' ')).not.toContain('Voters tab');
      expect(rules.join(' ')).not.toContain('can see each voter');
    });

    it.each<['voter' | 'creator', boolean]>([
      ['creator', true],
      ['creator', false],
      ['voter', true],
      ['voter', false],
    ])('treats null privacy as unavailable for %s (closed: %s)', (audience, isClosed) => {
      const rules = getVoteVisibilityRules(audience, null, isClosed);
      expect(rules).toContain('No one sees how another voter voted on this page.');
      expect(rules.at(-1)).toBe('Ballot privacy information is unavailable.');
      expect(rules.join(' ')).not.toContain('Named ballot');
      expect(rules.join(' ')).not.toContain('Voters tab');
    });

    it('says who can read ballots on a named vote (#3914)', () => {
      expect(getVoteVisibilityRules('creator', false, false)).toContain(
        "You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots."
      );
      expect(getVoteVisibilityRules('voter', false, true)).toContain("Vote managers can see each voter's ballot. Other voters can't see yours.");
      expect(getVoteVisibilityRules('voter', false, true)).not.toContain('No one sees how another voter voted on this page.');
    });

    it('describes draft ballots as available only once voting opens', () => {
      const rules = getVoteVisibilityRules('creator', false, false, false);
      expect(rules).toContain("Once voting opens, you can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
      expect(rules).not.toContain("You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
      expect(getVoteVisibilityRules('creator', true, false, false)).toContain('No one sees how another voter voted on this page.');
    });

    it('tells managers they see live totals while voters wait for close', () => {
      expect(getVoteVisibilityRules('creator', false, false)).toEqual([
        'As a manager, you can follow live totals and comments until the vote closes.',
        'Voters see only their own response until the vote closes.',
        "You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.",
        'Named ballot: each ballot is recorded against the voter who cast it.',
      ]);
    });

    it('tells voters totals are hidden until close and shared with invited voters after', () => {
      expect(getVoteVisibilityRules('voter', false, false)[0]).toBe('You see only your own response. Totals and comments stay hidden until the vote closes.');
      expect(getVoteVisibilityRules('voter', false, true)[0]).toBe('Invited voters see the final totals and comments.');
      expect(getVoteVisibilityRules('creator', false, true)[1]).toBe('Invited voters now see the final totals and comments.');
    });

    it('names the ballot privacy for named and pseudo-anonymous votes', () => {
      for (const audience of ['voter', 'creator'] as const) {
        for (const isClosed of [true, false]) {
          expect(getVoteVisibilityRules(audience, true, isClosed).at(-1)).toBe('Pseudo-anonymous ballot: results are shown without voter names.');
          expect(getVoteVisibilityRules(audience, false, isClosed).at(-1)).toBe('Named ballot: each ballot is recorded against the voter who cast it.');
        }
      }
    });
  });
});

describe('isRankedPollType', () => {
  it.each([
    ['generic', PollType.GENERIC, false],
    ['majority', PollType.MAJORITY, false],
    ['undefined', undefined, false],
    ['null', null, false],
    ['meek_stv', PollType.MEEK_STV, true],
    ['instant_runoff_vote', PollType.INSTANT_RUNOFF_VOTE, true],
    ['condorcet_irv', PollType.CONDORCET_IRV, true],
    ['an unrecognized string', 'something_new', false],
  ] as const)('%s -> %s', (_label, input, expected) => {
    expect(isRankedPollType(input)).toBe(expected);
  });
});

describe('voter list helpers (#3914)', () => {
  const yes = { choice_id: 'c-yes', choice_text: 'Yes' };
  const no = { choice_id: 'c-no', choice_text: 'No' };
  const maybe = { choice_id: 'c-maybe', choice_text: 'Maybe' };
  const alice = { choice_id: 'c-alice', choice_text: 'Alice' };
  const bob = { choice_id: 'c-bob', choice_text: 'Bob' };
  const cara = { choice_id: 'c-cara', choice_text: 'Cara' };
  const dev = { choice_id: 'c-dev', choice_text: 'Dev' };

  const singleVote: Vote = {
    uid: 'vote-1',
    name: 'Approve the budget',
    end_time: '2026-11-01T00:00:00Z',
    status: PollStatus.ENDED,
    project_uid: 'project-1',
    poll_type: PollType.GENERIC,
    poll_questions: [{ question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', choices: [yes, no, maybe] }],
  };
  const multipleVote: Vote = {
    ...singleVote,
    poll_questions: [{ question_id: 'q-1', prompt: 'Pick topics', type: 'multiple_choice', choices: [yes, no, maybe, alice] }],
  };
  const rankedVote: Vote = {
    ...singleVote,
    poll_type: PollType.MEEK_STV,
    poll_questions: [{ question_id: 'q-1', prompt: 'Rank the candidates', type: 'single_choice', choices: [alice, bob, cara, dev] }],
  };
  const multiQuestionVote: Vote = {
    ...singleVote,
    poll_questions: [
      { question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', choices: [yes, no] },
      { question_id: 'q-2', prompt: 'Who chairs?', type: 'single_choice', choices: [alice, bob] },
    ],
  };

  function voter(overrides: Partial<VoteVoter> = {}): VoteVoter {
    return { uid: 'b-1', user_name: 'Avery Example', status: VoteVoterStatus.VOTED, poll_answers: [], ...overrides };
  }

  function answer(questionId: string, userChoice: UserChoice[], rankedChoice: UserChoice[] = []): PollAnswer {
    return { question_id: questionId, prompt: '', type: 'single_choice', user_choice: userChoice, ranked_user_choice: rankedChoice };
  }

  describe('getVoteVoterStatus', () => {
    it('keeps a recognized status', () => {
      expect(getVoteVoterStatus({ status: VoteVoterStatus.ABSTAINED })).toBe(VoteVoterStatus.ABSTAINED);
    });

    it('reads an unrecognized status as not voted', () => {
      expect(getVoteVoterStatus({ status: 'pending' as VoteVoterStatus })).toBe(VoteVoterStatus.NOT_VOTED);
    });
  });

  describe('buildVoteVoterChoiceSummaries', () => {
    it('shows a single-choice ballot as one chip without a question prefix', () => {
      const summaries = buildVoteVoterChoiceSummaries(singleVote, voter({ poll_answers: [answer('q-1', [yes])] }));
      expect(summaries).toEqual([{ questionId: 'q-1', ranked: false, chips: ['Yes'], overflow: 0 }]);
    });

    it('keeps two chips of a multiple-choice ballot and counts the rest', () => {
      const summaries = buildVoteVoterChoiceSummaries(multipleVote, voter({ poll_answers: [answer('q-1', [yes, no, maybe, alice])] }));
      expect(summaries[0]).toMatchObject({ chips: ['Yes', 'No'], overflow: 2 });
    });

    it('formats a ranked ballot by preference order', () => {
      const ranked = [
        { ...cara, choice_rank: 2 },
        { ...bob, choice_rank: 1 },
        { ...alice, choice_rank: 3 },
      ];
      const summaries = buildVoteVoterChoiceSummaries(rankedVote, voter({ poll_answers: [answer('q-1', [], ranked)] }));
      expect(summaries[0]).toEqual({ questionId: 'q-1', ranked: true, chips: ['1 Bob', '2 Cara'], overflow: 1 });
    });

    it('prefixes each question of a multi-question ballot', () => {
      const summaries = buildVoteVoterChoiceSummaries(multiQuestionVote, voter({ poll_answers: [answer('q-1', [no]), answer('q-2', [bob])] }));
      expect(summaries.map((summary) => [summary.questionLabel, summary.chips])).toEqual([
        ['Q1', ['No']],
        ['Q2', ['Bob']],
      ]);
    });

    it('uses the current choice text from the vote and falls back to the ballot', () => {
      const summaries = buildVoteVoterChoiceSummaries(
        singleVote,
        voter({
          poll_answers: [
            answer('q-1', [
              { choice_id: 'c-yes', choice_text: 'Old yes' },
              { choice_id: 'c-gone', choice_text: 'Removed' },
            ]),
          ],
        })
      );
      expect(summaries[0].chips).toEqual(['Yes', 'Removed']);
    });

    it('returns nothing for abstained and not-voted voters', () => {
      expect(buildVoteVoterChoiceSummaries(singleVote, voter({ status: VoteVoterStatus.ABSTAINED }))).toEqual([]);
      expect(buildVoteVoterChoiceSummaries(singleVote, voter({ status: VoteVoterStatus.NOT_VOTED }))).toEqual([]);
    });
  });

  describe('buildVoteVoterChoiceFilterOptions', () => {
    it('lists one option per choice, keyed by question and choice', () => {
      expect(buildVoteVoterChoiceFilterOptions(singleVote)).toEqual([
        { label: 'Yes', value: 'q-1:c-yes' },
        { label: 'No', value: 'q-1:c-no' },
        { label: 'Maybe', value: 'q-1:c-maybe' },
      ]);
    });

    it('prefixes labels with the question number when there are several questions', () => {
      expect(buildVoteVoterChoiceFilterOptions(multiQuestionVote).map((option) => option.label)).toEqual(['Q1: Yes', 'Q1: No', 'Q2: Alice', 'Q2: Bob']);
    });

    it('labels ranked options as first choices', () => {
      expect(buildVoteVoterChoiceFilterOptions(rankedVote)[0]).toEqual({ label: 'First choice: Alice', value: 'q-1:c-alice' });
    });
  });

  describe('matchesVoteVoterChoice', () => {
    it('matches any selected choice of a generic question', () => {
      const multi = voter({ poll_answers: [answer('q-1', [yes, maybe])] });
      expect(matchesVoteVoterChoice(multi, 'q-1:c-maybe', multipleVote)).toBe(true);
      expect(matchesVoteVoterChoice(multi, 'q-1:c-no', multipleVote)).toBe(false);
    });

    it('matches only the rank-1 choice of a ranked question', () => {
      const ranked = voter({
        poll_answers: [
          answer(
            'q-1',
            [],
            [
              { ...bob, choice_rank: 1 },
              { ...alice, choice_rank: 2 },
            ]
          ),
        ],
      });
      expect(matchesVoteVoterChoice(ranked, 'q-1:c-bob', rankedVote)).toBe(true);
      expect(matchesVoteVoterChoice(ranked, 'q-1:c-alice', rankedVote)).toBe(false);
    });

    it('matches no one for a choice that no longer exists or a malformed key', () => {
      const yesVoter = voter({ poll_answers: [answer('q-1', [yes])] });
      expect(matchesVoteVoterChoice(yesVoter, 'q-1:c-gone', singleVote)).toBe(false);
      expect(matchesVoteVoterChoice(yesVoter, 'q-9:c-yes', singleVote)).toBe(false);
      expect(matchesVoteVoterChoice(yesVoter, 'no-separator', singleVote)).toBe(false);
    });

    it('never matches an abstained or not-voted voter', () => {
      expect(matchesVoteVoterChoice(voter({ status: VoteVoterStatus.ABSTAINED, poll_answers: [answer('q-1', [yes])] }), 'q-1:c-yes', singleVote)).toBe(false);
    });
  });

  describe('buildVoteVoterRowView', () => {
    it('maps identity, role and the current ballot time', () => {
      const row = buildVoteVoterRowView(
        singleVote,
        voter({
          user_org_name: 'Acme Motors',
          user_voting_status: 'Voting Rep',
          user_role: 'Chair',
          submitted_at: '2026-10-20T10:00:00Z',
          poll_answers: [answer('q-1', [yes])],
        })
      );
      expect(row).toMatchObject({
        uid: 'b-1',
        displayName: 'Avery Example',
        organization: 'Acme Motors',
        role: 'Voting Rep',
        committeeRole: 'Chair',
        status: VoteVoterStatus.VOTED,
        statusLabel: 'Voted',
        submittedAt: '2026-10-20T10:00:00Z',
        hasBallot: true,
      });
    });

    it('labels a non-voter by vote state and gives them no ballot', () => {
      const notVoted = voter({ status: VoteVoterStatus.NOT_VOTED });
      expect(buildVoteVoterRowView(singleVote, notVoted)).toMatchObject({ statusLabel: 'Did not vote', hasBallot: false });
      expect(buildVoteVoterRowView({ ...singleVote, status: PollStatus.ACTIVE }, notVoted).statusLabel).toBe('Not voted yet');
    });

    it('falls back to the username, then the email, for the name', () => {
      expect(buildVoteVoterRowView(singleVote, voter({ user_name: '', username: 'avery' })).displayName).toBe('avery');
      expect(buildVoteVoterRowView(singleVote, voter({ user_name: '', user_email: 'avery@acme-motors.example' })).displayName).toBe(
        'avery@acme-motors.example'
      );
    });
  });

  describe('sortVoteVotersForDisplay', () => {
    const rows = (vote: Vote) =>
      [
        voter({ uid: 'v-dana', user_name: 'Dana', status: VoteVoterStatus.NOT_VOTED }),
        voter({ uid: 'v-cole', user_name: 'Cole', poll_answers: [answer('q-1', [no])] }),
        voter({ uid: 'v-bea', user_name: 'Bea', status: VoteVoterStatus.ABSTAINED }),
        voter({ uid: 'v-abe', user_name: 'Abe', poll_answers: [answer('q-1', [yes])] }),
        voter({ uid: 'v-ari', user_name: 'Ari', status: VoteVoterStatus.NOT_VOTED }),
        voter({ uid: 'v-al', user_name: 'Al', poll_answers: [answer('q-1', [no])] }),
      ].map((row) => buildVoteVoterRowView(vote, row));

    it('lists non-voters first while the vote is open, then by name', () => {
      const vote = { ...singleVote, status: PollStatus.ACTIVE };
      expect(sortVoteVotersForDisplay(rows(vote), vote).map((row) => row.uid)).toEqual(['v-ari', 'v-dana', 'v-abe', 'v-al', 'v-bea', 'v-cole']);
    });

    it('orders by choice, then abstained, then non-voters after close', () => {
      expect(sortVoteVotersForDisplay(rows(singleVote), singleVote).map((row) => row.uid)).toEqual(['v-abe', 'v-al', 'v-cole', 'v-bea', 'v-ari', 'v-dana']);
    });

    it('orders a closed ranked vote by first choice', () => {
      const ranked = [
        voter({ uid: 'v-b', user_name: 'B', poll_answers: [answer('q-1', [], [{ ...bob, choice_rank: 1 }])] }),
        voter({
          uid: 'v-a',
          user_name: 'A',
          poll_answers: [
            answer(
              'q-1',
              [],
              [
                { ...alice, choice_rank: 1 },
                { ...bob, choice_rank: 2 },
              ]
            ),
          ],
        }),
      ].map((row) => buildVoteVoterRowView(rankedVote, row));
      expect(sortVoteVotersForDisplay(ranked, rankedVote).map((row) => row.uid)).toEqual(['v-a', 'v-b']);
    });

    it('does not mutate its input', () => {
      const input = rows(singleVote);
      const before = input.map((row) => row.uid);
      sortVoteVotersForDisplay(input, singleVote);
      expect(input.map((row) => row.uid)).toEqual(before);
    });
  });

  describe('countVoteVotersByStatus', () => {
    it('counts each status and the total', () => {
      const counts = countVoteVotersByStatus([
        { status: VoteVoterStatus.VOTED },
        { status: VoteVoterStatus.VOTED },
        { status: VoteVoterStatus.ABSTAINED },
        { status: VoteVoterStatus.NOT_VOTED },
      ]);
      expect(counts).toEqual({ all: 4, voted: 2, abstained: 1, not_voted: 1 });
    });

    it('returns zeros for no rows', () => {
      expect(countVoteVotersByStatus([])).toEqual({ all: 0, voted: 0, abstained: 0, not_voted: 0 });
    });
  });

  describe('buildVoteBallotQuestions', () => {
    it('marks the selected choice of a single-choice question', () => {
      const [question] = buildVoteBallotQuestions(singleVote, voter({ poll_answers: [answer('q-1', [no])] }));
      expect(question).toMatchObject({ number: 1, prompt: 'Approve?', ranked: false, multiple: false });
      expect(question.choices.map((choice) => [choice.text, choice.selected])).toEqual([
        ['Yes', false],
        ['No', true],
        ['Maybe', false],
      ]);
    });

    it('flags multiple-choice questions for checkbox markers', () => {
      const [question] = buildVoteBallotQuestions(multipleVote, voter({ poll_answers: [{ ...answer('q-1', [yes, maybe]), type: 'multiple_choice' }] }));
      expect(question.multiple).toBe(true);
      expect(question.choices.filter((choice) => choice.selected).map((choice) => choice.text)).toEqual(['Yes', 'Maybe']);
    });

    it('splits a ranked question into ranked and unranked choices', () => {
      const [question] = buildVoteBallotQuestions(
        rankedVote,
        voter({
          poll_answers: [
            answer(
              'q-1',
              [],
              [
                { ...cara, choice_rank: 2 },
                { ...alice, choice_rank: 1 },
              ]
            ),
          ],
        })
      );
      expect(question.ranked).toBe(true);
      expect(question.rankedChoices.map((choice) => [choice.rank, choice.text])).toEqual([
        [1, 'Alice'],
        [2, 'Cara'],
      ]);
      expect(question.unrankedChoices.map((choice) => choice.text)).toEqual(['Bob', 'Dev']);
    });

    it('numbers every question and leaves unanswered ones unselected', () => {
      const questions = buildVoteBallotQuestions(multiQuestionVote, voter({ status: VoteVoterStatus.ABSTAINED }));
      expect(questions.map((question) => question.number)).toEqual([1, 2]);
      expect(questions.every((question) => question.choices.every((choice) => !choice.selected))).toBe(true);
    });

    it('keeps a selected choice that is no longer on the question', () => {
      const [question] = buildVoteBallotQuestions(singleVote, voter({ poll_answers: [answer('q-1', [{ choice_id: 'c-gone', choice_text: 'Removed' }])] }));
      expect(question.choices.at(-1)).toEqual({ choiceId: 'c-gone', text: 'Removed', selected: true });
    });
  });
});
