// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditTargetingListKey } from '../interfaces/campaign.interface';
import {
  redditTargetingListAddRefusal,
  redditTargetingListEntry,
  redditTargetingListHeld,
  redditTargetingListsCapability,
  redditTargetingListsInEffect,
} from './campaign-reddit-targeting-lists.utils';

describe('redditTargetingListsCapability', () => {
  it.each<[boolean | null, boolean]>([
    [true, true],
    [false, false],
    [null, false],
  ])('reads %s as %s', (enabled, expected) => {
    expect(redditTargetingListsCapability(enabled)).toBe(expected);
  });
});

describe('redditTargetingListsInEffect', () => {
  const seed = { subreddits: ['r/kubernetes'], interests: ['Technology'] };
  const edited = { subreddits: ['devops'], interests: [] };

  it.each<[string, typeof edited | null, boolean | null, typeof seed]>([
    ['the edits on a yes', edited, true, edited],
    ['the seed on a no, keeping the edits out of the request', edited, false, seed],
    ['the seed while the answer is out', edited, null, seed],
    ['the seed when nothing was edited', null, true, seed],
  ])('uses %s', (_name, edits, enabled, expected) => {
    expect(redditTargetingListsInEffect(seed, edits, enabled)).toEqual(expected);
  });
});

describe('redditTargetingListEntry', () => {
  it.each<[RedditTargetingListKey, string, string]>([
    ['subreddits', ' r/Kubernetes ', 'Kubernetes'],
    ['subreddits', '/r/devops', 'devops'],
    ['subreddits', 'golang', 'golang'],
    ['interests', '  Technology  ', 'Technology'],
    ['interests', 'r/not_a_prefix_here', 'r/not_a_prefix_here'],
  ])('reads a %s entry %j as %j', (key, raw, entry) => {
    expect(redditTargetingListEntry(key, raw)).toBe(entry);
  });
});

describe('redditTargetingListAddRefusal', () => {
  const full = (n: number): string[] => Array.from({ length: n }, (_, i) => `entry_${i}`);

  it.each<[string, string[], RedditTargetingListKey, string, string | null]>([
    ['a new subreddit', ['kubernetes'], 'subreddits', 'golang', null],
    ['a held subreddit, in another case (adding changes nothing)', ['kubernetes'], 'subreddits', 'Kubernetes', null],
    ['a subreddit seeded with its r/ (adding changes nothing)', ['r/kubernetes'], 'subreddits', 'kubernetes', null],
    [
      'a subreddit that is not a subreddit name',
      [],
      'subreddits',
      'cloud-native',
      'Enter a subreddit name: 2 to 21 letters, digits or underscores, optionally after r/.',
    ],
    ['a blank subreddit', [], 'subreddits', '', 'Enter a subreddit name.'],
    ['a blank interest', [], 'interests', '', 'Enter a Reddit interest name or id.'],
    ['a 101st subreddit', full(100), 'subreddits', 'golang', 'At most 100 subreddits.'],
    ['a held entry on a full list', full(100), 'subreddits', 'ENTRY_3', null],
    ['a 201st interest', full(200), 'interests', 'Technology', 'At most 200 interests.'],
  ])('%s', (_name, entries, key, entry, expected) => {
    expect(redditTargetingListAddRefusal(entries, key, entry)).toBe(expected);
  });

  it('matches held entries ignoring case', () => {
    expect(redditTargetingListHeld(['Technology'], 'interests', 'technology')).toBe(true);
    expect(redditTargetingListHeld(['r/Kubernetes'], 'subreddits', 'kubernetes')).toBe(true);
  });
});
