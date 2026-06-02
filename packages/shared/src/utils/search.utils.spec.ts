// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { UserSearchResult } from '../interfaces';
import { rankUserSearchResults, scoreUserSearchResult, UserSearchRelevance } from './search.utils';

function user(partial: Partial<UserSearchResult>): UserSearchResult {
  return {
    uid: partial.uid ?? 'uid',
    email: partial.email ?? '',
    first_name: partial.first_name ?? '',
    last_name: partial.last_name ?? '',
    job_title: partial.job_title ?? null,
    organization: partial.organization ?? null,
    committee: partial.committee ?? null,
    type: partial.type ?? 'committee_member',
    username: partial.username ?? null,
  };
}

const ilona = user({ uid: '1', first_name: 'Ilona', last_name: 'Maier', email: 'ilona.maier@example.com' });
// Name and email share no "il" — used as a clean non-match for "il" queries.
const bob = user({ uid: '2', first_name: 'Bob', last_name: 'Brown', email: 'bob.brown@example.com' });
// Name shares no contiguous "il"; only the email incidentally contains it.
const emailOnly = user({ uid: '3', first_name: 'Dana', last_name: 'Reyes', email: 'dreyes-il@example.com' });
// Neither name nor email contains "il" — pure upstream ngram/alias noise.
const noise = user({ uid: '4', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' });
// Only the LFID username contains "il".
const usernameOnly = user({ uid: '5', first_name: 'Sam', last_name: 'Park', email: 'sam.park@example.com', username: 'silke99' });

describe('scoreUserSearchResult', () => {
  it('scores an exact name match highest', () => {
    expect(scoreUserSearchResult(ilona, 'ilona')).toBe(UserSearchRelevance.ExactName);
    expect(scoreUserSearchResult(ilona, 'ilona maier')).toBe(UserSearchRelevance.ExactName);
  });

  it('scores a name-prefix match', () => {
    expect(scoreUserSearchResult(ilona, 'il')).toBe(UserSearchRelevance.NamePrefix);
    expect(scoreUserSearchResult(bob, 'bro')).toBe(UserSearchRelevance.NamePrefix);
  });

  it('scores a name substring (mid-name) match', () => {
    // "ai" is inside "maier" but not a prefix of any name field.
    expect(scoreUserSearchResult(ilona, 'ai')).toBe(UserSearchRelevance.NameSubstring);
  });

  it('scores a username-only match above email', () => {
    expect(scoreUserSearchResult(usernameOnly, 'il')).toBe(UserSearchRelevance.UsernameMatch);
  });

  it('scores an email-only match below name and username matches', () => {
    expect(scoreUserSearchResult(emailOnly, 'il')).toBe(UserSearchRelevance.EmailMatch);
  });

  it('scores no contiguous match as incidental', () => {
    expect(scoreUserSearchResult(noise, 'il')).toBe(UserSearchRelevance.Incidental);
  });

  it('is case insensitive', () => {
    expect(scoreUserSearchResult(ilona, 'ILONA')).toBe(UserSearchRelevance.ExactName);
  });
});

describe('rankUserSearchResults', () => {
  it('orders name > username > email > incidental for a name query', () => {
    const ranked = rankUserSearchResults([noise, emailOnly, usernameOnly, ilona], 'il');
    expect(ranked.map((r) => r.uid)).toEqual(['1', '5', '3', '4']);
  });

  it('demotes pure-incidental matches to the bottom rather than dropping them', () => {
    const ranked = rankUserSearchResults([noise, ilona], 'il');
    // Both retained — incidental is never hard-filtered (it may be a legitimate
    // alias hit the client cannot see) — but it sorts last.
    expect(ranked.map((r) => r.uid)).toEqual(['1', '4']);
  });

  it('keeps stable order within the same relevance tier', () => {
    const a = user({ uid: 'a', first_name: 'Ila', last_name: 'A', email: 'a@example.com' });
    const b = user({ uid: 'b', first_name: 'Ilb', last_name: 'B', email: 'b@example.com' });
    expect(rankUserSearchResults([a, b], 'il').map((r) => r.uid)).toEqual(['a', 'b']);
    expect(rankUserSearchResults([b, a], 'il').map((r) => r.uid)).toEqual(['b', 'a']);
  });

  it('retains every result (no cap), sorting real matches above demoted noise', () => {
    const noiseRows = Array.from({ length: 12 }, (_, i) => user({ uid: `n${i}`, first_name: 'Zed', last_name: 'Zane', email: `z${i}@example.com` }));
    const ranked = rankUserSearchResults([...noiseRows, ilona], 'il');
    // The real match floats to the top; nothing is dropped or capped.
    expect(ranked).toHaveLength(13);
    expect(ranked[0].uid).toBe('1');
  });

  it('ranks email matches first for an email query', () => {
    const match = user({ uid: 'm', first_name: 'Zoe', last_name: 'Quinn', email: 'find-me@corp.com' });
    const nonMatch = user({ uid: 'n', first_name: 'Al', last_name: 'King', email: 'other@corp.com' });
    const ranked = rankUserSearchResults([nonMatch, match], 'find-me@corp.com');
    expect(ranked[0].uid).toBe('m');
  });

  it('returns results unchanged for an empty query', () => {
    const input = [bob, ilona];
    expect(rankUserSearchResults(input, '   ')).toBe(input);
  });
});
