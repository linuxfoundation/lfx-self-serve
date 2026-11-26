// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_SUBREDDIT_NAME_PATTERN, REDDIT_TARGETING_LIST_LIMITS } from '../constants/campaign.constants';
import type { RedditTargetingListKey, RedditTargetingListsDraft } from '../interfaces/campaign.interface';

/**
 * Editable Reddit subreddits and interests (#6108 row 4). The Implement tab offers them only while campaign-service
 * resolves them before creating anything (`redditTargetingResolutionEnabled`): it then refuses an unknown community or
 * interest by entry, which the create flow shows. These rules catch what needs no Reddit lookup.
 */

/** Whether the Implement tab offers the lists for editing: only on an explicit yes, so an unanswered (`null`) read keeps them read-only. */
export function redditTargetingListsCapability(enabled: boolean | null): boolean {
  return enabled === true;
}

/**
 * The lists a create shows and sends: the operator's edits while the capability is an explicit yes, else the brief's
 * seed. Edits kept from a draft are never sent to a deployment that would not resolve them (Reddit refuses an unknown
 * interest and the create drops both lists), and are never lost while the answer is out: they apply once it is yes.
 */
export function redditTargetingListsInEffect(
  seed: RedditTargetingListsDraft,
  edited: RedditTargetingListsDraft | null,
  enabled: boolean | null
): RedditTargetingListsDraft {
  return edited !== null && redditTargetingListsCapability(enabled) ? edited : seed;
}

/** A typed entry as the list holds it: a subreddit trimmed, without an `r/` or `/r/` prefix; an interest trimmed. */
export function redditTargetingListEntry(key: RedditTargetingListKey, raw: string): string {
  const trimmed = raw.trim();
  return key === 'subreddits' ? trimmed.replace(/^\/?r\//i, '').trim() : trimmed;
}

/**
 * Whether `entries` already holds `entry` ({@link redditTargetingListEntry}), ignoring case as campaign-service matches
 * both lists. Held entries are read the same way first, since a brief may seed a subreddit with its `r/` prefix.
 */
export function redditTargetingListHeld(entries: readonly string[], key: RedditTargetingListKey, entry: string): boolean {
  const needle = entry.toLowerCase();
  return entries.some((held) => redditTargetingListEntry(key, held).toLowerCase() === needle);
}

/**
 * Why an entry ({@link redditTargetingListEntry}) is not added to its list, or `null`: blank, a subreddit that is not a
 * subreddit name (the excluded-communities rule), or a full list. An entry the list already holds is not an error
 * (adding it again changes nothing). Whether Reddit knows it is campaign-service's check, at Create.
 */
export function redditTargetingListAddRefusal(entries: readonly string[], key: RedditTargetingListKey, entry: string): string | null {
  if (entry === '') return key === 'subreddits' ? 'Enter a subreddit name.' : 'Enter a Reddit interest name or id.';
  if (key === 'subreddits' && !REDDIT_SUBREDDIT_NAME_PATTERN.test(entry)) {
    return 'Enter a subreddit name: 2 to 21 letters, digits or underscores, optionally after r/.';
  }
  const max = REDDIT_TARGETING_LIST_LIMITS[key];
  if (!redditTargetingListHeld(entries, key, entry) && entries.length >= max) return `At most ${max} ${key === 'subreddits' ? 'subreddits' : 'interests'}.`;
  return null;
}

/** A stored draft list: the strings of an array, else `undefined` (the brief's seed stands). */
export function redditTargetingListFromDraft(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}
