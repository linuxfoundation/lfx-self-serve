// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  EMPTY_READ_STATE,
  MAX_READ_IDS,
  MENTION_IDS_MAX_VALUES,
  MENTION_SENTIMENT_CONFIG,
  SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX,
  SOCIAL_LISTENING_PREFERENCE_NAME_PREFIXES,
  SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX,
  SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX,
} from '../constants/social-listening.constants';
import type { ReadStateData, SocialListeningMention } from '../interfaces/social-listening.interface';
import {
  buildMentionFilters,
  computeReadToggle,
  formatTag,
  garbageCollectReadState,
  isReadInState,
  isSocialListeningPreferenceName,
  mapRawToMention,
  mergeSelectedAuthors,
  normalizeKeywords,
  normalizePlatformKey,
  normalizeSentiment,
  parseBookmarkIds,
  parseReadState,
  socialListeningPreferenceName,
} from './social-listening.utils';

function rawMention(overrides: Partial<SocialListeningMention> = {}): SocialListeningMention {
  return {
    MENTION_ID: 'key-1',
    SOURCE_PLATFORM: 'reddit',
    SOCIAL_NETWORK: 'Reddit',
    KEYWORD: 'Kubernetes',
    MENTION_TS: '2026-02-01T12:00:00Z',
    AUTHOR: '@alice',
    AUTHOR_PROFILE_LINK: 'https://example.test/alice',
    TITLE: 'A title',
    BODY: 'Some body',
    SENTIMENT: 'positive',
    RELEVANCE_SCORE: 'high',
    RELEVANCE_COMMENT: 'Directly on topic',
    TAGS: 'ai, ai_agents',
    URL: 'https://example.test/post',
    IMAGE_URL: 'https://example.test/img.png',
    SUBREDDIT: 'r/kubernetes',
    LANGUAGE: 'en',
    ...overrides,
  } as SocialListeningMention;
}

describe('normalizeSentiment', () => {
  it.each(['positive', 'neutral', 'negative'])('keeps the configured value %s', (value) => {
    expect(normalizeSentiment(value)).toBe(value);
    expect(normalizeSentiment(value.toUpperCase())).toBe(value);
  });

  it.each([
    { label: 'an upstream value with no config entry', input: 'mixed' },
    { label: 'unknown', input: 'unknown' },
    { label: 'null', input: null },
    { label: 'undefined', input: undefined },
    { label: 'empty', input: '   ' },
    { label: 'a prototype key', input: 'constructor' },
  ])('falls back to neutral for $label', ({ input }) => {
    expect(normalizeSentiment(input)).toBe('neutral');
  });

  it('never returns a value the display config cannot resolve', () => {
    for (const input of ['mixed', 'unknown', 'toString', '', 'POSITIVE']) {
      expect(MENTION_SENTIMENT_CONFIG[normalizeSentiment(input)]).toBeDefined();
    }
  });
});

describe('normalizePlatformKey', () => {
  it.each([
    { input: 'x', expected: 'twitter' },
    { input: 'X', expected: 'twitter' },
    { input: 'Reddit', expected: 'reddit' },
    { input: 'hacker news', expected: 'hackernews' },
    { input: ' YouTube ', expected: 'youtube' },
    { input: 'mastodon', expected: 'other' },
    { input: '', expected: 'other' },
    { input: 'constructor', expected: 'other' },
    { input: 'toString', expected: 'other' },
  ])('maps "$input" to $expected', ({ input, expected }) => {
    expect(normalizePlatformKey(input)).toBe(expected);
  });
});

describe('mapRawToMention', () => {
  it('maps a well-formed row', () => {
    const mention = mapRawToMention(rawMention());

    expect(mention).toMatchObject({
      id: 'key-1',
      platform: 'reddit',
      keyword: 'kubernetes',
      authorName: '@alice',
      sentiment: 'positive',
      relevance: 'high',
      tags: ['ai', 'ai_agents'],
      // The `r/` prefix is stripped so the card can render it itself.
      subreddit: 'kubernetes',
      analysis: 'Directly on topic',
    });
  });

  it('buckets an off-list sentiment as neutral instead of leaking it into the display config', () => {
    const mention = mapRawToMention(rawMention({ SENTIMENT: 'mixed' }));

    expect(mention.sentiment).toBe('neutral');
    expect(MENTION_SENTIMENT_CONFIG[mention.sentiment]).toBeDefined();
  });

  it.each([null, undefined, ''])('buckets a %s sentiment as neutral', (value) => {
    expect(mapRawToMention(rawMention({ SENTIMENT: value as string })).sentiment).toBe('neutral');
  });

  it('whitelists relevance to high/low', () => {
    expect(mapRawToMention(rawMention({ RELEVANCE_SCORE: 'HIGH' })).relevance).toBe('high');
    expect(mapRawToMention(rawMention({ RELEVANCE_SCORE: 'medium' })).relevance).toBe('low');
    expect(mapRawToMention(rawMention({ RELEVANCE_SCORE: '' })).relevance).toBe('low');
  });

  it('falls back to the social network when the platform column is blank', () => {
    expect(mapRawToMention(rawMention({ SOURCE_PLATFORM: '', SOCIAL_NETWORK: 'Bluesky' })).platform).toBe('bluesky');
  });

  it('synthesizes an analysis line when the relevance comment is missing', () => {
    const mention = mapRawToMention(rawMention({ RELEVANCE_COMMENT: '', SENTIMENT: 'negative', SOCIAL_NETWORK: 'Reddit' }));

    expect(mention.analysis).toBe('Mention from Reddit with negative sentiment.');
  });

  it('coalesces every nullable string field rather than rendering "null"', () => {
    const mention = mapRawToMention({ MENTION_ID: 'key-2' } as SocialListeningMention);

    expect(mention).toMatchObject({
      keyword: '',
      timestamp: '',
      authorName: 'Unknown',
      title: '',
      content: '',
      tags: [],
      originalUrl: '',
      imageUrl: '',
      subreddit: '',
      language: '',
      sentiment: 'neutral',
      platform: 'other',
    });
  });

  it('splits and trims the comma-joined TAGS column, dropping empties', () => {
    expect(mapRawToMention(rawMention({ TAGS: ' ai , , ai_agents ,' })).tags).toEqual(['ai', 'ai_agents']);
    expect(mapRawToMention(rawMention({ TAGS: '' })).tags).toEqual([]);
  });
});

describe('buildMentionFilters', () => {
  const base = { sentiment: 'all', relevance: 'all', platform: 'all', keywords: [] as string[], tags: [] as string[] };

  it('omits every "all" and empty value', () => {
    expect(buildMentionFilters({ ...base, authors: [], sourceProjectId: 'all', language: 'all', hasTitle: 'all', search: '' })).toEqual({});
  });

  it('carries every active dimension through', () => {
    const filters = buildMentionFilters({
      sentiment: 'positive',
      relevance: 'high',
      platform: 'reddit',
      keywords: ['Kubernetes', 'KUBERNETES'],
      tags: ['ai'],
      authors: ['@alice'],
      sourceProjectId: 'proj-1',
      language: 'en',
      hasTitle: 'yes',
      search: 'mesh',
    });

    expect(filters).toEqual({
      sentiment: 'positive',
      relevance: 'high',
      platform: 'reddit',
      keywords: ['kubernetes'],
      tags: ['ai'],
      authors: ['@alice'],
      sourceProjectId: 'proj-1',
      language: 'en',
      hasTitle: 'yes',
      search: 'mesh',
    });
  });

  it('omits absent optional dimensions entirely', () => {
    expect(buildMentionFilters({ ...base, sentiment: 'negative' })).toEqual({ sentiment: 'negative' });
  });

  it('emits mentionIds only when the bookmarked set is non-empty', () => {
    expect(buildMentionFilters({ ...base, mentionIds: ['m1', 'm2'] })).toEqual({ mentionIds: ['m1', 'm2'] });
    expect(buildMentionFilters({ ...base, mentionIds: [] })).toEqual({});
    expect(buildMentionFilters(base)).toEqual({});
  });
});

describe('small helpers', () => {
  it('trims, lowercases, and dedupes keywords, preserving first-seen order', () => {
    expect(normalizeKeywords(['B', 'a', 'b', 'A'])).toEqual(['b', 'a']);
    expect(normalizeKeywords([' ai ', 'ai', '  ', ''])).toEqual(['ai']);
    expect(normalizeKeywords([])).toEqual([]);
  });

  it('title-cases tags and special-cases ai', () => {
    expect(formatTag('ai_agents')).toBe('AI Agents');
    expect(formatTag('ai')).toBe('AI');
    expect(formatTag('cloud_native')).toBe('Cloud Native');
    expect(formatTag('')).toBe('');
  });

  it('re-adds selected authors that dropped out of the rescoped options', () => {
    const options = [{ AUTHOR: '@alice', PLATFORM: 'reddit', MENTION_COUNT: 3, platformIcon: 'i', platformIconClass: 'c' }];

    expect(mergeSelectedAuthors(options, ['@alice'])).toBe(options);

    const merged = mergeSelectedAuthors(options, ['@alice', '@bob']);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ AUTHOR: '@bob', PLATFORM: '', MENTION_COUNT: 0 });
  });
});

describe('parseBookmarkIds', () => {
  it('parses a JSON string and accepts a pre-parsed array', () => {
    expect(parseBookmarkIds('["m1","m2"]')).toEqual(['m1', 'm2']);
    expect(parseBookmarkIds(['m1', 'm2'])).toEqual(['m1', 'm2']);
  });

  it('drops non-string and empty entries', () => {
    expect(parseBookmarkIds(['m1', '', 42, null, 'm2'])).toEqual(['m1', 'm2']);
  });

  it('caps the list at the server limit', () => {
    const overCap = Array.from({ length: MENTION_IDS_MAX_VALUES + 50 }, (_, i) => `m${i}`);
    expect(parseBookmarkIds(overCap)).toHaveLength(MENTION_IDS_MAX_VALUES);
  });

  it('returns an empty list for corrupt JSON or a non-array payload', () => {
    expect(parseBookmarkIds('{not json')).toEqual([]);
    expect(parseBookmarkIds('{"ids":["m1"]}')).toEqual([]);
    expect(parseBookmarkIds(null)).toEqual([]);
  });
});

describe('parseReadState', () => {
  it('parses a JSON string and accepts a pre-parsed object', () => {
    const doc = { readBeforeTs: '2026-02-01 12:00:00', readIds: ['m1'], unreadIds: ['m2'] };
    expect(parseReadState(JSON.stringify(doc))).toEqual(doc);
    expect(parseReadState(doc)).toEqual(doc);
  });

  it('returns the empty state for non-object or array payloads', () => {
    expect(parseReadState(null)).toEqual(EMPTY_READ_STATE);
    expect(parseReadState('42')).toEqual(EMPTY_READ_STATE);
    expect(parseReadState(['m1'])).toEqual(EMPTY_READ_STATE);
  });

  it('filters per-field type drift', () => {
    expect(parseReadState({ readBeforeTs: 42, readIds: ['m1', 7, null], unreadIds: 'nope' })).toEqual({ readBeforeTs: null, readIds: ['m1'], unreadIds: [] });
  });

  it('returns the empty state for corrupt JSON', () => {
    expect(parseReadState('{not json')).toEqual(EMPTY_READ_STATE);
  });
});

describe('garbageCollectReadState', () => {
  it('slices both arrays to the cap (newest tail) and keeps the cutoff', () => {
    const overCap = Array.from({ length: MAX_READ_IDS + 50 }, (_, i) => `m${i}`);
    const gc = garbageCollectReadState({ readBeforeTs: '2026-02-01T00:00:00Z', readIds: overCap, unreadIds: overCap });

    expect(gc.readBeforeTs).toBe('2026-02-01T00:00:00Z');
    expect(gc.readIds).toHaveLength(MAX_READ_IDS);
    expect(gc.unreadIds).toHaveLength(MAX_READ_IDS);
    expect(gc.readIds[0]).toBe('m50');
  });
});

describe('isReadInState', () => {
  const state: ReadStateData = { readBeforeTs: '2026-02-01 12:00:00', readIds: ['explicit-read'], unreadIds: ['explicit-unread'] };

  it('prefers explicit readIds, then unreadIds, then the cutoff', () => {
    expect(isReadInState(state, 'explicit-read', '2026-03-01 00:00:00')).toBe(true);
    expect(isReadInState(state, 'explicit-unread', '2026-01-01 00:00:00')).toBe(false);
  });

  it('compares against the cutoff with space-separated timestamps normalized to epoch ms', () => {
    expect(isReadInState(state, 'other', '2026-02-01 11:59:59')).toBe(true);
    expect(isReadInState(state, 'other', '2026-02-01 12:00:00')).toBe(true);
    expect(isReadInState(state, 'other', '2026-02-01 12:00:01')).toBe(false);
  });

  it('treats an empty timestamp as unread (NaN comparisons are false)', () => {
    expect(isReadInState(state, 'other', '')).toBe(false);
    expect(isReadInState({ ...state, readBeforeTs: null }, 'other', '')).toBe(false);
  });
});

describe('computeReadToggle', () => {
  const base: ReadStateData = { readBeforeTs: null, readIds: [], unreadIds: [] };

  it('appends to readIds when marking read beyond any cutoff', () => {
    expect(computeReadToggle(base, 'm1', '2026-03-01 00:00:00', false)).toEqual({ readBeforeTs: null, readIds: ['m1'], unreadIds: [] });
  });

  it('appends to unreadIds when un-reading a cutoff-covered mention', () => {
    const withCutoff: ReadStateData = { ...base, readBeforeTs: '2026-02-01 00:00:00' };
    expect(computeReadToggle(withCutoff, 'm1', '2026-01-01 00:00:00', true)).toEqual({ readBeforeTs: '2026-02-01 00:00:00', readIds: [], unreadIds: ['m1'] });
  });

  it('drops the explicit read id instead of adding an unread override when the cutoff does not cover the mention', () => {
    const state: ReadStateData = { readBeforeTs: null, readIds: ['m1'], unreadIds: [] };
    expect(computeReadToggle(state, 'm1', '2026-03-01 00:00:00', true)).toEqual(base);
  });

  it('drops the unread override instead of adding a read id when re-reading a cutoff-covered mention', () => {
    const state: ReadStateData = { readBeforeTs: '2026-02-01 00:00:00', readIds: [], unreadIds: ['m1'] };
    expect(computeReadToggle(state, 'm1', '2026-01-01 00:00:00', false)).toEqual({ readBeforeTs: '2026-02-01 00:00:00', readIds: [], unreadIds: [] });
  });

  it('is idempotent when the state already implies the toggle', () => {
    const state: ReadStateData = { readBeforeTs: null, readIds: ['m1'], unreadIds: [] };
    expect(computeReadToggle(state, 'm1', '2026-03-01 00:00:00', false)).toEqual(state);
  });

  it('slices the appended array to the cap, dropping the oldest entry', () => {
    const full = Array.from({ length: MAX_READ_IDS }, (_, i) => `m${i}`);
    const next = computeReadToggle({ readBeforeTs: null, readIds: full, unreadIds: [] }, 'new', '2026-03-01 00:00:00', false);

    expect(next.readIds).toHaveLength(MAX_READ_IDS);
    expect(next.readIds.at(-1)).toBe('new');
    expect(next.readIds).not.toContain('m0');
  });
});

describe('preference name builder + validator', () => {
  const sfid = '001ABC0000XYZDEFAAA';

  it('builds the exact PCC name strings with the ASCII " - " separator', () => {
    expect(socialListeningPreferenceName(SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX, sfid)).toBe(`Social Listening Bookmarks - ${sfid}`);
    expect(socialListeningPreferenceName(SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX, sfid)).toBe(`Social Listening Read State - ${sfid}`);
    expect(socialListeningPreferenceName(SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX, sfid)).toBe(`Social Listening Saved Filters - ${sfid}`);
  });

  it('accepts every allowlisted prefix with a non-empty suffix', () => {
    for (const prefix of SOCIAL_LISTENING_PREFERENCE_NAME_PREFIXES) {
      expect(isSocialListeningPreferenceName(`${prefix} - ${sfid}`)).toBe(true);
    }
  });

  it.each([
    { label: 'an unknown name', name: 'visibility' },
    { label: 'a PCC name with an em dash separator', name: `Social Listening Bookmarks — ${sfid}` },
    { label: 'an empty suffix', name: 'Social Listening Bookmarks - ' },
    { label: 'the bare prefix', name: 'Social Listening Bookmarks' },
    { label: 'a prefixed lookalike', name: 'Social Listening BookmarksLite - x' },
    { label: 'empty', name: '' },
  ])('rejects $label', ({ name }) => {
    expect(isSocialListeningPreferenceName(name)).toBe(false);
  });
});
