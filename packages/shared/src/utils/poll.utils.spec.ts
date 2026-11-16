// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for poll.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

import { describe, expect, it } from 'vitest';

import { PollStatus } from '../enums';
import type { PollCommentResponse } from '../interfaces/poll.interface';
import {
  countVotesByStatus,
  getVoteEndedEarlyDetailTooltip,
  normalizePollStatus,
  sortCommentResponsesByRecency,
  sortCommentResponsesByText,
} from './poll.utils';

describe('getVoteEndedEarlyDetailTooltip', () => {
  it('states the early-close date without inferring the closure reason or participation', () => {
    expect(getVoteEndedEarlyDetailTooltip('Oct 20, 2026')).toBe('Vote closed early on Oct 20, 2026.');
  });
});

describe('normalizePollStatus', () => {
  it('returns an already-lowercase status unchanged', () => {
    expect(normalizePollStatus(PollStatus.ACTIVE)).toBe(PollStatus.ACTIVE);
  });

  it('lowercases an uppercase/mixed-case status that matches a real member', () => {
    expect(normalizePollStatus('ACTIVE')).toBe(PollStatus.ACTIVE);
    expect(normalizePollStatus('Ended')).toBe(PollStatus.ENDED);
  });

  it('returns undefined for a nullish status instead of throwing', () => {
    expect(normalizePollStatus(null)).toBeUndefined();
    expect(normalizePollStatus(undefined)).toBeUndefined();
  });

  it('returns undefined for a value that is not a real PollStatus member', () => {
    expect(normalizePollStatus('archived')).toBeUndefined();
    expect(normalizePollStatus('')).toBeUndefined();
  });
});

describe('countVotesByStatus', () => {
  it('returns all zeros for an empty collection', () => {
    expect(countVotesByStatus([])).toEqual({ all: 0, active: 0, disabled: 0, ended: 0 });
  });

  it('buckets each recognized status, normalizing legacy mixed-case values', () => {
    const votes = [{ status: PollStatus.ACTIVE }, { status: 'AcTiVe' }, { status: PollStatus.DISABLED }, { status: 'ENDED' }, { status: PollStatus.ENDED }];

    // @ts-expect-error Mixed-case legacy strings intentionally violate the canonical status enum.
    expect(countVotesByStatus(votes)).toEqual({ all: 5, active: 2, disabled: 1, ended: 2 });
  });

  it('counts an unrecognized or missing status toward all only', () => {
    const votes = [{ status: 'unrecognized' }, { status: undefined }, { status: PollStatus.ACTIVE }];

    // @ts-expect-error Unknown and missing statuses intentionally violate the required enum contract.
    expect(countVotesByStatus(votes)).toEqual({ all: 3, active: 1, disabled: 0, ended: 0 });
  });
});

describe('sortCommentResponsesByRecency', () => {
  /** Minimal PollCommentResponse fixture — the sort only reads `vote_creation_time`. */
  function response(voteId: string, voteCreationTime: string): PollCommentResponse {
    return { vote_id: voteId, comment_text: `comment ${voteId}`, vote_creation_time: voteCreationTime, abstained: false };
  }

  it('sorts responses newest-first by vote_creation_time', () => {
    const input = [response('oldest', '2025-01-01T10:00:00Z'), response('newest', '2025-03-01T10:00:00Z'), response('middle', '2025-02-01T10:00:00Z')];

    expect(sortCommentResponsesByRecency(input).map((r) => r.vote_id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('does not mutate the input array', () => {
    const input = [response('older', '2025-01-01T10:00:00Z'), response('newer', '2025-02-01T10:00:00Z')];

    sortCommentResponsesByRecency(input);

    expect(input.map((r) => r.vote_id)).toEqual(['older', 'newer']);
  });

  it('sinks unparseable timestamps to the bottom instead of scrambling the comparator', () => {
    const input = [response('broken', 'not-a-date'), response('real', '2025-02-01T10:00:00Z')];

    expect(sortCommentResponsesByRecency(input).map((r) => r.vote_id)).toEqual(['real', 'broken']);
  });

  it('returns an empty array unchanged', () => {
    expect(sortCommentResponsesByRecency([])).toEqual([]);
  });

  it('sinks a response with no vote_creation_time (pseudo-anonymous, #3916) to the bottom', () => {
    const input: PollCommentResponse[] = [{ comment_text: 'anonymous' }, response('real', '2025-02-01T10:00:00Z')];

    expect(sortCommentResponsesByRecency(input).map((r) => r.comment_text)).toEqual(['comment real', 'anonymous']);
  });
});

describe('sortCommentResponsesByText', () => {
  it('sorts responses by comment_text', () => {
    const input: PollCommentResponse[] = [{ comment_text: 'Charlie' }, { comment_text: 'alpha' }, { comment_text: 'Bravo' }];

    expect(sortCommentResponsesByText(input).map((r) => r.comment_text)).toEqual(['alpha', 'Bravo', 'Charlie']);
  });

  it('does not mutate the input array', () => {
    const input: PollCommentResponse[] = [{ comment_text: 'second' }, { comment_text: 'first' }];

    sortCommentResponsesByText(input);

    expect(input.map((r) => r.comment_text)).toEqual(['second', 'first']);
  });

  it('returns an empty array unchanged', () => {
    expect(sortCommentResponsesByText([])).toEqual([]);
  });
});
