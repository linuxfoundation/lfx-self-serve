// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { computeVoteRowParticipation } from './vote-participation.utils';
import fixtures from './vote-participation.fixtures.json';

import type { PollStatus } from '../enums/poll.enum';
import type { Vote } from '../interfaces/poll.interface';

/**
 * Contract fixtures for the vote participation rules (epic #4140 / #4741). The same file is consumed by
 * lfx-mcp#193 in Go, so JSON has no NaN: the string "NaN" stands in for it, and a non-number count must read as
 * unavailable exactly like NaN does. `end_time` / `early_end_time` are passed through but do not affect the result. `awaitingInvitationCount` is optional (default false) and maps to the function's second argument.
 */
describe('vote-participation.fixtures.json', () => {
  it('has uniquely named entries', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(new Set(fixtures.map((fixture) => fixture.name)).size).toBe(fixtures.length);
  });

  it.each(fixtures)('computeVoteRowParticipation: $name', ({ input, expected }) => {
    // The contract deliberately sends null and "NaN" for counts the Vote interface types as `number`; only those two fields (and the JSON status string) are cast.
    const toCount = (value: number | string | null): number => (value === 'NaN' ? Number.NaN : (value as number));
    const vote: Vote = {
      uid: 'vote-uid',
      name: 'Fixture vote',
      project_uid: 'project-uid',
      status: input.status as PollStatus,
      end_time: input.end_time,
      early_end_time: input.early_end_time ?? undefined,
      num_response_received: toCount(input.num_response_received),
      total_voting_request_invitations: toCount(input.total_voting_request_invitations),
    };

    expect(computeVoteRowParticipation(vote, input.awaitingInvitationCount ?? false)).toMatchObject(expected);
  });
});
