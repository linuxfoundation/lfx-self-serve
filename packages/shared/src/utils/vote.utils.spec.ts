// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

// vote.utils.ts imports @angular/forms, whose import graph reaches Angular's partially-compiled
// @angular/common. Under vitest that needs the JIT compiler as a fallback, so load it before
// importing the module under test (same shim as the apps/lfx-one spec files).
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { PollStatus } from '../enums';
import type { Vote, VoteFormValue } from '../interfaces/poll.interface';
import { buildCreateVoteRequest, buildDraftUpdateVoteRequest, buildDraftVoteRequest, buildUpdateVoteRequest, mapVoteToFormValue } from './vote.utils';

/** Minimal VoteFormValue fixture — the request builders only read the fields set here. */
function formValue(overrides: Partial<VoteFormValue> = {}): VoteFormValue {
  return {
    title: 'Board election',
    description: 'Pick the next board members',
    committee: { uid: 'committee-uid', name: 'Board' },
    eligible_participants: 'voting_rep',
    close_date: new Date('2025-06-01T00:00:00Z'),
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
});
