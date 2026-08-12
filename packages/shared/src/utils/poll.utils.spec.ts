// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for poll.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

import { describe, expect, it } from 'vitest';

import { PollStatus } from '../enums';
import type { PollCommentResponse } from '../interfaces/poll.interface';
import { normalizePollStatus, sortCommentResponsesByRecency } from './poll.utils';

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
});
