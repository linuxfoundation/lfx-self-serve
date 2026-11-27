// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REDDIT_DELIVERY,
  REDDIT_BUDGET_COPY,
  REDDIT_DEVICE_PLATFORM_LABELS,
  REDDIT_DEVICE_PLATFORMS,
  REDDIT_PLACEMENTS,
} from '../constants/campaign.constants';
import type { RedditDeliveryCapabilities, RedditDeliveryDraft } from '../interfaces/campaign.interface';
import {
  normalizeRedditBudgetType,
  normalizeRedditEnumList,
  redditBudgetCopy,
  redditBudgetTypeRefusal,
  redditDeliveryField,
  redditDeliveryOptions,
  redditDeliveryRefusal,
  redditDeliveryWithOption,
  redditPlacementsRefusal,
} from './campaign-reddit-delivery.utils';

const PLACEMENTS = 'redditConfig.placements';
const PLATFORMS = 'redditConfig.platforms';
const EXPAND = 'redditConfig.expandTargeting';
const BUDGET = 'redditConfig.budgetType';

describe('redditPlacementsRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['not an object', null, true],
    ['nothing set, without the flag', { budgetUsd: 50 }, false],
    // campaign-service reads null and an empty list as absent, so they need no flag.
    ['null and empty lists, without the flag', { placements: [], platforms: null, expandTargeting: null }, false],
    ['every placement and device', { placements: ['FEED', 'COMMENTS_PAGE'], platforms: ['DESKTOP', 'MOBILE_NATIVE', 'MOBILE_WEB'] }, true],
    ['lower case and padded entries, as campaign-service reads them', { placements: [' feed '], platforms: ['mobile_web'] }, true],
    ['ſ, which Go upper-cases to S', { platforms: ['deſktop'] }, true],
    // campaign-service drops duplicates rather than refusing them.
    ['a repeated entry', { placements: ['FEED', 'feed'] }, true],
    ['expandTargeting false', { expandTargeting: false }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditPlacementsRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, boolean, string, string]>([
    ['a case variant of a key, whatever the flag', { Placements: ['FEED'] }, false, PLACEMENTS, 'spelled exactly'],
    ['a list that is not an array', { platforms: 'DESKTOP' }, true, PLATFORMS, 'list of text'],
    ['a list with a non-text entry', { placements: ['FEED', 1] }, true, PLACEMENTS, 'list of text'],
    ['an expandTargeting that is not a boolean', { expandTargeting: 'true' }, true, EXPAND, 'true or false'],
    ['placements without the flag', { placements: ['FEED'] }, false, PLACEMENTS, 'not enabled'],
    ['platforms without the flag', { platforms: ['DESKTOP'] }, false, PLATFORMS, 'not enabled'],
    // The gate never depends on whether the value is the default.
    ['expandTargeting true without the flag', { expandTargeting: true }, false, EXPAND, 'not enabled'],
    ['a blank placement', { placements: ['FEED', '  '] }, true, PLACEMENTS, 'Entry 2 is blank'],
    ['an unknown placement', { placements: ['SIDEBAR'] }, true, PLACEMENTS, 'Entry 1 is not a Reddit placement'],
    ['ALL as a device', { platforms: ['ALL'] }, true, PLATFORMS, 'omit the list for every device'],
    ['an unknown device', { platforms: ['DESKTOP', 'TV'] }, true, PLATFORMS, 'Entry 2 is not a Reddit device'],
    ['both lists bad: placements first', { placements: ['X'], platforms: ['Y'] }, true, PLACEMENTS, 'Entry 1'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = redditPlacementsRefusal(raw, enabled);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(redditPlacementsRefusal({ placements: ['<script>'] }, true)?.message).not.toContain('<script>');
  });
});

describe('normalizeRedditEnumList', () => {
  it.each<[readonly string[], readonly string[], string[]]>([
    [[], REDDIT_PLACEMENTS, []],
    [['comments_page', ' FEED', 'feed'], REDDIT_PLACEMENTS, ['FEED', 'COMMENTS_PAGE']],
    [['MOBILE_WEB', 'desktop'], REDDIT_DEVICE_PLATFORMS, ['DESKTOP', 'MOBILE_WEB']],
  ])('normalises %o to the allowed order', (values, allowed, expected) => {
    expect(normalizeRedditEnumList(values, allowed, 'placement')).toEqual({ values: expected });
  });
});

describe('redditBudgetTypeRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['not an object', 'daily', false],
    ['no budget type, without the flag', { budgetUsd: 50 }, false],
    ['lifetime', { budgetType: 'lifetime' }, true],
    ['daily', { budgetType: 'daily' }, true],
    ['a padded, upper-case value, as campaign-service reads it', { budgetType: ' DAILY ' }, true],
    ['İ, which Go lower-cases to i', { budgetType: 'LİFETIME' }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditBudgetTypeRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, boolean, string]>([
    ['a case variant of the key, whatever the flag', { BudgetType: 'daily' }, false, 'spelled exactly'],
    ['null', { budgetType: null }, true, '"lifetime" or "daily", or omit it'],
    ['a number', { budgetType: 1 }, true, '"lifetime" or "daily", or omit it'],
    ['a blank value', { budgetType: '  ' }, true, 'is blank'],
    ['daily without the flag', { budgetType: 'daily' }, false, 'not enabled'],
    // The gate never depends on whether the value is the default.
    ['lifetime without the flag', { budgetType: 'lifetime' }, false, 'not enabled'],
    ['an unknown value', { budgetType: 'weekly' }, true, 'Send the budget type as "lifetime" or "daily".'],
  ])('refuses %s', (_name, raw, enabled, message) => {
    const refusal = redditBudgetTypeRefusal(raw, enabled);
    expect(refusal?.field).toBe(BUDGET);
    expect(refusal?.message).toContain(message);
  });
});

describe('normalizeRedditBudgetType', () => {
  it.each<[string, string | null]>([
    ['lifetime', 'lifetime'],
    [' Daily\t', 'daily'],
    ['dai ly', null],
    ['', null],
  ])('reads %j as %s', (raw, expected) => {
    expect(normalizeRedditBudgetType(raw)).toBe(expected);
  });
});

const BOTH_ON: RedditDeliveryCapabilities = { placements: true, budgetType: true };
const delivery = (over: Partial<RedditDeliveryDraft>): RedditDeliveryDraft => ({ ...DEFAULT_REDDIT_DELIVERY, ...over });

describe('redditDeliveryField', () => {
  it.each<[string, Partial<RedditDeliveryDraft>, RedditDeliveryCapabilities, Record<string, unknown>]>([
    ['nothing at the defaults', {}, BOTH_ON, {}],
    ['one placement', { placements: ['COMMENTS_PAGE'] }, BOTH_ON, { placements: ['COMMENTS_PAGE'] }],
    ['two devices, in campaign-service order', { platforms: ['MOBILE_WEB', 'DESKTOP'] }, BOTH_ON, { platforms: ['DESKTOP', 'MOBILE_WEB'] }],
    ['expansion off', { expandTargeting: false }, BOTH_ON, { expandTargeting: false }],
    ['a daily budget', { budgetType: 'daily' }, BOTH_ON, { budgetType: 'daily' }],
    // An empty list is held by redditDeliveryRefusal; on the wire it would mean every value.
    ['nothing for an empty list', { placements: [] }, BOTH_ON, {}],
    [
      'only the budget type with placements unanswered',
      { budgetType: 'daily', placements: ['FEED'], expandTargeting: false },
      { placements: null, budgetType: true },
      { budgetType: 'daily' },
    ],
    [
      'only the placements with the budget type off',
      { budgetType: 'daily', placements: ['FEED'] },
      { placements: true, budgetType: false },
      { placements: ['FEED'] },
    ],
    [
      'nothing with both off, whatever is held',
      { budgetType: 'daily', placements: ['FEED'], platforms: ['DESKTOP'], expandTargeting: false },
      { placements: false, budgetType: null },
      {},
    ],
  ])('sends %s', (_name, over, capabilities, expected) => {
    expect(redditDeliveryField(delivery(over), capabilities)).toEqual(expected);
  });
});

describe('redditDeliveryRefusal', () => {
  it.each<[string, Partial<RedditDeliveryDraft>, RedditDeliveryCapabilities, string | null]>([
    ['the defaults', {}, BOTH_ON, null],
    ['no placement', { placements: [] }, BOTH_ON, 'Choose at least one placement.'],
    ['no device', { platforms: [] }, BOTH_ON, 'Choose at least one device.'],
    ['no placement while placements are off, since none is sent', { placements: [] }, { placements: false, budgetType: true }, null],
  ])('%s', (_name, over, capabilities, expected) => {
    expect(redditDeliveryRefusal(delivery(over), capabilities)).toBe(expected);
  });
});

describe('redditDeliveryWithOption', () => {
  it.each<[string, string[], string, boolean, string[]]>([
    ['ticks one, in order', ['MOBILE_WEB'], 'DESKTOP', true, ['DESKTOP', 'MOBILE_WEB']],
    ['unticks one', ['DESKTOP', 'MOBILE_WEB'], 'DESKTOP', false, ['MOBILE_WEB']],
    ['keeps the last one ticked', ['MOBILE_WEB'], 'MOBILE_WEB', false, ['MOBILE_WEB']],
    ['ticks a ticked one once', ['DESKTOP'], 'DESKTOP', true, ['DESKTOP']],
  ])('%s', (_name, list, value, on, expected) => {
    expect(redditDeliveryWithOption(list, value, on, REDDIT_DEVICE_PLATFORMS)).toEqual(expected);
  });
});

describe('redditDeliveryOptions', () => {
  it('locks only the last ticked box', () => {
    expect(redditDeliveryOptions(['MOBILE_NATIVE'], REDDIT_DEVICE_PLATFORMS, REDDIT_DEVICE_PLATFORM_LABELS)).toEqual([
      { value: 'DESKTOP', label: 'Desktop', on: false, locked: false },
      { value: 'MOBILE_NATIVE', label: 'Mobile app', on: true, locked: true },
      { value: 'MOBILE_WEB', label: 'Mobile web', on: false, locked: false },
    ]);
    expect(redditDeliveryOptions([...REDDIT_PLACEMENTS], REDDIT_PLACEMENTS, { FEED: 'F', COMMENTS_PAGE: 'C' }).some((row) => row.locked)).toBe(false);
  });
});

describe('redditBudgetCopy', () => {
  it.each<[string, Partial<RedditDeliveryDraft>, RedditDeliveryCapabilities, string]>([
    ['lifetime, as always', {}, BOTH_ON, REDDIT_BUDGET_COPY.lifetime.label],
    ['daily once chosen', { budgetType: 'daily' }, BOTH_ON, REDDIT_BUDGET_COPY.daily.label],
    [
      'lifetime for a held daily the capability no longer confirms',
      { budgetType: 'daily' },
      { placements: true, budgetType: false },
      REDDIT_BUDGET_COPY.lifetime.label,
    ],
  ])('labels %s', (_name, over, capabilities, expected) => {
    expect(redditBudgetCopy(delivery(over), capabilities).label).toBe(expected);
  });
});
