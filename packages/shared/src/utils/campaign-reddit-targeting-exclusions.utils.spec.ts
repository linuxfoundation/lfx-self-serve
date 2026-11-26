// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { redditTargetingExclusionsRefusal } from './campaign-reddit-targeting-exclusions.utils';

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
        laterLast
          ? { [earlier]: earlierValue, [later]: laterValue, ...exclusions }
          : { [later]: laterValue, [earlier]: earlierValue, ...exclusions };
      expect(redditTargetingExclusionsRefusal(config(colliding, clear), true)).toBeNull();
      expect(redditTargetingExclusionsRefusal(config(clear, colliding), true)?.field).toBe(field);
    });
  });

  it('never echoes a caller value', () => {
    expect(redditTargetingExclusionsRefusal({ excludedSubreddits: ['<script>'] }, true)?.message).not.toContain('<script>');
  });
});
