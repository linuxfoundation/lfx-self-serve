// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { computeVoteRowParticipation } from './vote-participation.utils';
import fixtures from './vote-participation.fixtures.json';

import type { Vote } from '../interfaces/poll.interface';

/**
 * Contract fixtures for the vote participation rules (epic #4140 / #4741). The same file is consumed by
 * lfx-mcp#193 in Go, so JSON has no NaN: the string "NaN" stands in for it, and a non-number count must read as
 * unavailable exactly like NaN does. `end_time` / `early_end_time` are passed through but do not affect the result.
 */
describe('vote-participation.fixtures.json', () => {
  it('has uniquely named entries', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(new Set(fixtures.map((fixture) => fixture.name)).size).toBe(fixtures.length);
  });

  it.each(fixtures)('computeVoteRowParticipation: $name', ({ input, expected }) => {
    const toCount = (value: number | string | null): number | null => (value === 'NaN' ? Number.NaN : (value as number | null));
    const vote = {
      uid: 'vote-uid',
      name: 'Fixture vote',
      project_uid: 'project-uid',
      status: input.status,
      end_time: input.end_time,
      early_end_time: input.early_end_time,
      num_response_received: toCount(input.num_response_received),
      total_voting_request_invitations: toCount(input.total_voting_request_invitations),
    } as unknown as Vote;

    expect(computeVoteRowParticipation(vote)).toMatchObject(expected);
  });
});
