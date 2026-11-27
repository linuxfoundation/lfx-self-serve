// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { REDDIT_DEVICE_PLATFORMS, REDDIT_PLACEMENTS } from '../constants/campaign.constants';
import { normalizeRedditBudgetType, normalizeRedditEnumList, redditBudgetTypeRefusal, redditPlacementsRefusal } from './campaign-reddit-delivery.utils';

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
