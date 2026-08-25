// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isVotingStatus, votingStatusPillClass, votingStatusRank } from './org-people-committee-members.constants';

describe('isVotingStatus', () => {
  it('treats a named voting status as voting', () => {
    expect(isVotingStatus('Voting Rep')).toBe(true);
  });

  it('treats an unrecognized non-blank status as voting (open-world)', () => {
    expect(isVotingStatus('Chair Emeritus')).toBe(true);
  });

  it.each(['Non-voting', 'None', '', '  ', null, undefined])('treats %j as non-voting', (status) => {
    expect(isVotingStatus(status)).toBe(false);
  });

  it('is case-insensitive and whitespace-trimmed for the closed-world exclusions', () => {
    expect(isVotingStatus('  NONE  ')).toBe(false);
    expect(isVotingStatus('non-VOTING')).toBe(false);
  });
});

describe('votingStatusPillClass', () => {
  it('returns the emerald voting classes for a voting status', () => {
    expect(votingStatusPillClass('Voting Rep')).toContain('emerald');
  });

  it('returns the neutral slate classes for a non-voting status', () => {
    expect(votingStatusPillClass('None')).toContain('slate');
  });
});

describe('votingStatusRank', () => {
  // Full ordering, lowest (best) to highest (worst) rank — the table an off-by-one in the
  // boundary constant would fail immediately rather than only on hand-picked pairs.
  it('ranks statuses lowest (best) to highest (worst) in this order', () => {
    const ranks = {
      votingRep: votingStatusRank('Voting Rep'),
      altVotingRep: votingStatusRank('Alternate Voting Rep'),
      observer: votingStatusRank('Observer'),
      emeritus: votingStatusRank('Emeritus'),
      unrecognizedVoting: votingStatusRank('Chair Emeritus'),
      none: votingStatusRank('None'),
      nonVoting: votingStatusRank('Non-voting'),
      blank: votingStatusRank(''),
      nullish: votingStatusRank(null),
    };

    expect(ranks.votingRep).toBeLessThan(ranks.altVotingRep);
    expect(ranks.altVotingRep).toBeLessThan(ranks.observer);
    expect(ranks.observer).toBeLessThan(ranks.emeritus);
    // The regression this file guards: an unrecognized-but-voting status must rank ABOVE
    // (numerically below) "None", not below it — a bare `length`-derived offset got this
    // backwards once already (see git history on this file).
    expect(ranks.emeritus).toBeLessThan(ranks.unrecognizedVoting);
    expect(ranks.unrecognizedVoting).toBeLessThan(ranks.none);
    // "Non-voting" isn't itself in VOTING_STATUS_PRIORITY but is semantically identical to
    // "None" per isVotingStatus — they must tie, not rank arbitrarily far apart.
    expect(ranks.nonVoting).toBe(ranks.none);
    expect(ranks.none).toBeLessThan(ranks.blank);
    expect(ranks.blank).toBe(Infinity);
    expect(ranks.nullish).toBe(Infinity);
  });

  it('is case-insensitive and whitespace-trimmed for listed statuses', () => {
    expect(votingStatusRank('  voting rep  ')).toBe(votingStatusRank('Voting Rep'));
  });
});
