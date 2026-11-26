// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditTargetingExclusionsDraft } from '../interfaces/campaign.interface';
import {
  redditTargetingExclusionAddRefusal,
  redditTargetingExclusionEntry,
  redditTargetingExclusionHeld,
  redditTargetingExclusionsBlock,
  redditTargetingExclusionsDraftRefusal,
  redditTargetingExclusionsField,
  redditTargetingExclusionsRefusal,
} from './campaign-reddit-targeting-exclusions.utils';

const SUBS = 'redditConfig.excludedSubreddits';
const GEOS = 'redditConfig.excludedGeoTargets';

describe('redditTargetingExclusionsRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['not an object', null, true],
    ['no exclusions, on a deployment without them', { budgetUsd: 50 }, false],
    // campaign-service reads null and an empty list as absent.
    ['null and empty lists, on a deployment without them', { excludedSubreddits: null, excludedGeoTargets: [] }, false],
    ['subreddits with and without r/', { excludedSubreddits: ['r/politics', 'R/news', 'gaming_2'] }, true],
    ['a name padded after r/', { excludedSubreddits: ['r/ politics'] }, true],
    // campaign-service drops duplicates rather than refusing them.
    ['a repeated subreddit', { excludedSubreddits: ['news', 'NEWS'] }, true],
    ['100 subreddits', { excludedSubreddits: Array.from({ length: 100 }, (_, i) => `sub_${i}`) }, true],
    ['countries beside explicit geo targets', { geoTargets: ['US'], excludedGeoTargets: ['ca', ' gb '] }, true],
    ['US excluded when sub-country locations replace the default', { subCountryGeoTargets: ['6252001'], excludedGeoTargets: ['US'] }, true],
    ['a repeated country', { geoTargets: ['US'], excludedGeoTargets: ['CA', 'ca'] }, true],
    // campaign-service decodes keys ignoring case, so a case variant of geoTargets is the targeting it compares against.
    ['US excluded beside a case-variant geoTargets', { GeoTargets: ['CA'], excludedGeoTargets: ['US'] }, true],
    ['SS excluded beside a geo target of ß, which Go leaves as it is', { geoTargets: ['ß'], excludedGeoTargets: ['SS'] }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditTargetingExclusionsRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, boolean, string, string]>([
    ['a case variant of a key, whatever the flag', { ExcludedSubreddits: ['news'] }, false, SUBS, 'spelled exactly'],
    ['a list that is not an array', { excludedSubreddits: 'news' }, true, SUBS, 'list of text'],
    ['a list with a non-text entry', { excludedGeoTargets: ['CA', 1] }, true, GEOS, 'list of text'],
    ['subreddits without the flag', { excludedSubreddits: ['news'] }, false, SUBS, 'not enabled'],
    ['countries without the flag', { excludedGeoTargets: ['CA'] }, false, GEOS, 'not enabled'],
    ['101 subreddits', { excludedSubreddits: Array.from({ length: 101 }, (_, i) => `sub_${i}`) }, true, SUBS, 'at most 100'],
    ['a blank subreddit', { excludedSubreddits: ['news', '  '] }, true, SUBS, '2 is blank'],
    ['only the r/ prefix', { excludedSubreddits: ['r/'] }, true, SUBS, '1 is blank'],
    ['a one-letter name', { excludedSubreddits: ['a'] }, true, SUBS, 'not a subreddit name'],
    ['a 22-letter name', { excludedSubreddits: ['a'.repeat(22)] }, true, SUBS, 'not a subreddit name'],
    // `/r/` is not a prefix campaign-service strips.
    ['a /r/ prefix', { excludedSubreddits: ['/r/news'] }, true, SUBS, 'not a subreddit name'],
    ['a hyphenated name', { excludedSubreddits: ['cloud-native'] }, true, SUBS, 'not a subreddit name'],
    ['a subreddit also targeted', { subreddits: ['r/Kubernetes'], excludedSubreddits: ['kubernetes'] }, true, SUBS, 'also targeted'],
    ['a subreddit targeted under a case-variant key', { Subreddits: ['news'], excludedSubreddits: ['news'] }, true, SUBS, 'also targeted'],
    ['51 countries', { excludedGeoTargets: Array.from({ length: 51 }, () => 'CA') }, true, GEOS, 'at most 50'],
    ['a blank country', { excludedGeoTargets: [' '] }, true, GEOS, '1 is blank'],
    ['a three-letter code', { excludedGeoTargets: ['CAN'] }, true, GEOS, 'ISO 3166-1'],
    ['an unassigned code', { excludedGeoTargets: ['XX'] }, true, GEOS, 'ISO 3166-1'],
    // Go upper-cases code point by code point, so ß and ﬅ are not SS and ST there.
    ['ß, which JavaScript would upper-case to SS', { excludedGeoTargets: ['ß'] }, true, GEOS, 'ISO 3166-1'],
    ['ﬅ, which JavaScript would upper-case to ST', { excludedGeoTargets: ['ﬅ'] }, true, GEOS, 'ISO 3166-1'],
    ['a country also targeted', { geoTargets: ['us', 'CA'], excludedGeoTargets: ['ca'] }, true, GEOS, 'also targeted'],
    ['US with no geo targets, the default', { excludedGeoTargets: ['US'] }, true, GEOS, 'also targeted'],
    // The subreddit list is checked before the country list, as campaign-service does.
    ['both lists bad', { excludedSubreddits: ['a'], excludedGeoTargets: ['XX'] }, true, SUBS, 'not a subreddit name'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = redditTargetingExclusionsRefusal(raw, enabled);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  // campaign-service re-marshals the config with sorted keys and keeps the last match, so of two spellings of one key the
  // later one in byte order decides, whichever order the caller sent them in.
  describe.each<[string, string, string, unknown, unknown, Record<string, unknown>, string]>([
    ['geoTargets', 'geoTargets', 'geotargets', ['US'], ['CA'], { excludedGeoTargets: ['US'] }, GEOS],
    ['subreddits', 'Subreddits', 'subreddits', ['news'], ['gaming'], { excludedSubreddits: ['news'] }, SUBS],
    ['subCountryGeoTargets', 'subCountryGeoTargets', 'subcountrygeotargets', [], ['6252001'], { excludedGeoTargets: ['US'] }, GEOS],
  ])('two spellings of %s', (_key, earlier, later, colliding, clear, exclusions, field) => {
    it.each([true, false])('the later spelling decides (later sent last: %s)', (laterLast) => {
      const config = (earlierValue: unknown, laterValue: unknown): Record<string, unknown> =>
        laterLast ? { [earlier]: earlierValue, [later]: laterValue, ...exclusions } : { [later]: laterValue, [earlier]: earlierValue, ...exclusions };
      expect(redditTargetingExclusionsRefusal(config(colliding, clear), true)).toBeNull();
      expect(redditTargetingExclusionsRefusal(config(clear, colliding), true)?.field).toBe(field);
    });
  });

  it('never echoes a caller value', () => {
    expect(redditTargetingExclusionsRefusal({ excludedSubreddits: ['<script>'] }, true)?.message).not.toContain('<script>');
  });
});

const NONE: RedditTargetingExclusionsDraft = { excludedSubreddits: [], excludedGeoTargets: [] };
const HELD: RedditTargetingExclusionsDraft = { excludedSubreddits: ['politics'], excludedGeoTargets: ['CA'] };
const TARGETED = { subreddits: ['r/kubernetes'], geoTargets: ['US', 'gb'] };

describe('redditTargetingExclusionsField', () => {
  it.each<[string, RedditTargetingExclusionsDraft, boolean | null, unknown]>([
    ['both lists on an explicit yes', HELD, true, { excludedSubreddits: ['politics'], excludedGeoTargets: ['CA'] }],
    ['only the non-empty list', { ...NONE, excludedGeoTargets: ['CA'] }, true, { excludedGeoTargets: ['CA'] }],
    ['nothing on a no', HELD, false, {}],
    ['nothing while unanswered', HELD, null, {}],
  ])('sends %s', (_name, exclusions, enabled, expected) => {
    expect(redditTargetingExclusionsField(exclusions, enabled)).toEqual(expected);
  });
});

describe('redditTargetingExclusionsDraftRefusal', () => {
  it.each<[string, RedditTargetingExclusionsDraft, string | null]>([
    ['lists clear of the targeting', HELD, null],
    ['a subreddit the targeting now holds', { ...NONE, excludedSubreddits: ['Kubernetes'] }, 'also targeted'],
    ['a country the targeting now holds', { ...NONE, excludedGeoTargets: ['GB'] }, 'also targeted'],
  ])('%s', (_name, exclusions, message) => {
    const refusal = redditTargetingExclusionsDraftRefusal(exclusions, TARGETED);
    if (message === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(message);
  });
});

describe('redditTargetingExclusionEntry and redditTargetingExclusionHeld', () => {
  it.each<[string, 'excludedSubreddits' | 'excludedGeoTargets', string, string]>([
    ['a subreddit after r/', 'excludedSubreddits', ' r/Politics ', 'Politics'],
    ['a country code', 'excludedGeoTargets', ' ca ', 'CA'],
    ['ß, which Go does not upper-case to SS', 'excludedGeoTargets', 'ß', 'ß'],
  ])('reads %s', (_name, key, raw, entry) => {
    expect(redditTargetingExclusionEntry(key, raw)).toBe(entry);
  });

  it('matches subreddits ignoring case and codes exactly', () => {
    expect(redditTargetingExclusionHeld(HELD, 'excludedSubreddits', 'POLITICS')).toBe(true);
    expect(redditTargetingExclusionHeld(HELD, 'excludedGeoTargets', 'GB')).toBe(false);
  });
});

describe('redditTargetingExclusionAddRefusal', () => {
  const full = (key: 'excludedSubreddits' | 'excludedGeoTargets', n: number): RedditTargetingExclusionsDraft => ({
    ...NONE,
    [key]: Array.from({ length: n }, (_, i) => (key === 'excludedSubreddits' ? `sub_${i}` : 'CA')),
  });

  it.each<[string, RedditTargetingExclusionsDraft, 'excludedSubreddits' | 'excludedGeoTargets', string, string | null]>([
    ['a new subreddit', HELD, 'excludedSubreddits', 'news', null],
    ['a subreddit the list holds, in another case', HELD, 'excludedSubreddits', 'Politics', null],
    ['a blank subreddit', HELD, 'excludedSubreddits', '', 'Enter a subreddit name.'],
    ['a hyphenated name', HELD, 'excludedSubreddits', 'cloud-native', '2 to 21 letters'],
    ['a targeted subreddit', HELD, 'excludedSubreddits', 'KUBERNETES', 'r/KUBERNETES is targeted'],
    ['a 101st subreddit', full('excludedSubreddits', 100), 'excludedSubreddits', 'news', 'at most 100 subreddits'],
    ['a new country', HELD, 'excludedGeoTargets', 'DE', null],
    ['a blank country', HELD, 'excludedGeoTargets', '', 'Enter a country.'],
    ['an unassigned code', HELD, 'excludedGeoTargets', 'XX', 'two-letter ISO'],
    ['ß', HELD, 'excludedGeoTargets', 'ß', 'two-letter ISO'],
    ['a targeted country', HELD, 'excludedGeoTargets', 'GB', 'GB is targeted'],
    ['a 51st country', full('excludedGeoTargets', 50), 'excludedGeoTargets', 'DE', 'at most 50 countries'],
  ])('%s', (_name, exclusions, key, entry, message) => {
    const refusal = redditTargetingExclusionAddRefusal(exclusions, key, entry, TARGETED);
    if (message === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(message);
  });

  it('counts the US default as targeted when there are no geo targets', () => {
    expect(redditTargetingExclusionAddRefusal(NONE, 'excludedGeoTargets', 'US', { subreddits: [], geoTargets: [] })).toContain('US is targeted');
  });
});

describe('redditTargetingExclusionsBlock', () => {
  it.each<[string, RedditTargetingExclusionsDraft, boolean | null, 'ready' | 'pending' | 'failed', string | null, string | null]>([
    ['nothing held', NONE, false, 'ready', 'b1', null],
    ['held on an explicit yes', HELD, true, 'ready', 'b1', null],
    ['held on a no', HELD, false, 'ready', 'b1', 'restricted'],
    ['held while the read is out', HELD, null, 'pending', 'b1', 'pending'],
    ['held on an unsaved brief', HELD, null, 'failed', null, 'unsaved'],
    ['held after a failed read', HELD, null, 'failed', 'b1', 'failed'],
  ])('%s', (_name, exclusions, enabled, createCapabilityRead, briefId, kind) => {
    expect(redditTargetingExclusionsBlock({ exclusions, enabled, createCapabilityRead, briefId })?.kind ?? null).toBe(kind);
  });
});
