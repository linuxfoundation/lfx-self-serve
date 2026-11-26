// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditTargetingListKey } from '../interfaces/campaign.interface';
import {
  redditTargetingListAddRefusal,
  redditTargetingListEntry,
  redditTargetingListHeld,
  redditTargetingListsCapability,
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
    ['a blank subreddit', [], 'subreddits', '', 'Enter a subreddit name.'],
    ['a blank interest', [], 'interests', '', 'Enter a Reddit interest name or id.'],
    ['a 101st subreddit', full(100), 'subreddits', 'golang', 'At most 100 subreddits.'],
    ['a held entry on a full list', full(100), 'subreddits', 'ENTRY_3', null],
    ['a 201st interest', full(200), 'interests', 'Technology', 'At most 200 interests.'],
  ])('%s', (_name, entries, key, entry, expected) => {
    expect(redditTargetingListAddRefusal(entries, key, entry)).toBe(expected);
  });

  it('matches held entries ignoring case', () => {
    expect(redditTargetingListHeld(['Technology'], 'technology')).toBe(true);
  });
});
