// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditCreateRefusalInput } from '../interfaces/campaign.interface';
import {
  normaliseRedditGeoCodes,
  redditBudgetIsUsable,
  redditCallToActionIsUnavailable,
  redditCreateRefusal,
  redditEffectiveGeoTargets,
  redditEffectiveKeywords,
  redditEffectiveSubreddits,
  redditEffectiveVideoGoal,
  redditObjectiveIsUnavailable,
  redditVideoGoalError,
  redditVideoPostError,
} from './campaign-reddit-form.utils';

describe('Reddit geo targets', () => {
  it.each([
    [
      [' us ', 'gb'],
      ['US', 'GB'],
    ],
    [['USA', 'U1', ''], []],
  ])('normalises %j to %j', (codes, expected) => {
    expect(normaliseRedditGeoCodes(codes)).toEqual(expected);
  });

  it.each([
    ['a usable recommendation', ['us'], 'GB', ['US']],
    ['an unusable recommendation, falling back to the country', ['USA'], 'gb', ['GB']],
    ['no recommendation', [], 'de', ['DE']],
    ['nothing usable at all', ['USA'], '', []],
  ])('targets %s', (_name, recommended, country, expected) => {
    expect(redditEffectiveGeoTargets(recommended, country)).toEqual(expected);
  });
});

describe('redditEffectiveSubreddits', () => {
  it('strips an optional r/ and drops blanks', () => {
    expect(redditEffectiveSubreddits(['r/k8s', ' /r/devops ', 'golang', 'R/Rust', '  '])).toEqual(['k8s', 'devops', 'golang', 'Rust']);
  });
});

describe('redditEffectiveKeywords', () => {
  it.each([
    [['kubernetes'], ['cloud'], ['kubernetes']],
    [[], ['cloud', 'native'], ['cloud', 'native']],
  ])('uses %j over the brief keywords %j', (own, brief, expected) => {
    expect(redditEffectiveKeywords(own, brief)).toEqual(expected);
  });
});

describe('redditBudgetIsUsable', () => {
  it.each([
    [1, true],
    [1_000_000_000, true],
    [0.5, false],
    [0, false],
    [1_000_000_001, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])('%s → %s', (budget, usable) => {
    expect(redditBudgetIsUsable(budget)).toBe(usable);
  });
});

describe('the Video Views goal and post', () => {
  it.each([
    ['VIDEO_VIEW_6S', 'VIDEO_VIEW_6S'],
    ['VIDEO_VIEW_99S', null],
    ['', null],
  ])('goal %j → %j', (goal, expected) => {
    expect(redditEffectiveVideoGoal(goal)).toBe(expected);
  });

  it.each([
    ['video_views', '', true],
    ['video_views', 'VIDEO_VIEW_15S', false],
    ['traffic', '', false],
  ] as const)('%s with goal %j errs: %s', (objective, goal, errs) => {
    expect(redditVideoGoalError(objective, goal) !== null).toBe(errs);
  });

  it.each([
    ['video_views', '', true],
    ['video_views', 'https://www.reddit.com/r/x/comments/1', false],
    ['awareness', '', false],
  ] as const)('%s with post %j errs: %s', (objective, postUrl, errs) => {
    expect(redditVideoPostError(objective, postUrl) !== null).toBe(errs);
  });
});

describe('stale objective and call to action', () => {
  it('offers every objective today', () => {
    expect(redditObjectiveIsUnavailable('traffic')).toBe(false);
    expect(redditObjectiveIsUnavailable('legacy' as never)).toBe(true);
  });

  it.each([
    ['', false],
    ['Learn More', false],
    ['RETIRED_LABEL', true],
  ])('call to action %j is unavailable: %s', (cta, unavailable) => {
    expect(redditCallToActionIsUnavailable(cta)).toBe(unavailable);
  });
});

describe('redditCreateRefusal', () => {
  const ok: RedditCreateRefusalInput = { budgetUsd: 50, geoTargetCount: 1, videoGoalError: null, videoPostError: null };

  it.each([
    ['nothing wrong', {}, null],
    ['an unusable budget', { budgetUsd: 0 }, 'Reddit Ads: set a budget Reddit accepts.'],
    ['no geo', { geoTargetCount: 0 }, 'Reddit Ads: add a location, or a country code.'],
    ['a goal error', { videoGoalError: 'x' }, 'Reddit Ads: fix the Video Views goal.'],
    ['a post error', { videoPostError: 'x' }, 'Reddit Ads: Video Views needs a video post.'],
    ['a budget and a geo error, budget first', { budgetUsd: 0, geoTargetCount: 0 }, 'Reddit Ads: set a budget Reddit accepts.'],
  ])('%s', (_name, over, expected) => {
    expect(redditCreateRefusal({ ...ok, ...over })).toBe(expected);
  });
});
