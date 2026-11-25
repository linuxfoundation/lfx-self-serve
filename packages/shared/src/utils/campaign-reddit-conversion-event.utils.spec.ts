// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditConversionEvent, RedditObjective } from '../interfaces/campaign.interface';
import {
  redditConversionEventBlock,
  redditConversionEventField,
  redditConversionEventFromDraft,
  redditConversionEventOffered,
  redditConversionEventRefusal,
} from './campaign-reddit-conversion-event.utils';

describe('redditConversionEventRefusal', () => {
  const NOT_TEXT =
    'The conversion event must be text naming a pixel event, one of PURCHASE, SIGN_UP, LEAD, PAGE_VISIT, VIEW_CONTENT, ADD_TO_CART, ADD_TO_WISHLIST, SEARCH. Omit it for the default, PURCHASE.';
  const OFF = 'Reddit conversion events are not enabled on this deployment. Reload the page and create again.';
  const OBJECTIVE = 'The conversion event applies to the conversions objective only. Omit it, or choose the conversions objective.';

  it.each([
    ['no config', undefined, true, null],
    ['no field, flag off', { budgetUsd: 50 }, false, null],
    ['a case variant of the key, flag off', { ConversionEvent: 'LEAD' }, false, 'Send the conversion event as "conversionEvent", spelled exactly.'],
    [
      'an event with a case-variant objective key',
      { conversionEvent: 'LEAD', Objective: 'traffic' },
      true,
      'Send the objective as "objective", spelled exactly, with a conversion event.',
    ],
    ['null', { conversionEvent: null }, true, NOT_TEXT],
    ['a number, flag off (shape before flag)', { conversionEvent: 1 }, false, NOT_TEXT],
    ['blank text', { conversionEvent: '  ' }, true, 'An empty conversion event is refused. Omit it for the default, PURCHASE.'],
    ['a valid event, flag off', { conversionEvent: 'LEAD' }, false, OFF],
    [
      'an unknown event',
      { conversionEvent: 'COMPLETE_REGISTRATION' },
      true,
      'The conversion event must be one of PURCHASE, SIGN_UP, LEAD, PAGE_VISIT, VIEW_CONTENT, ADD_TO_CART, ADD_TO_WISHLIST, SEARCH.',
    ],
    ['a lower-case event, objective omitted', { conversionEvent: ' sign_up ' }, true, null],
    ['an event, objective empty', { conversionEvent: 'LEAD', objective: '' }, true, null],
    ['an event on conversions', { conversionEvent: 'PURCHASE', objective: 'conversions' }, true, null],
    ['an event on traffic', { conversionEvent: 'LEAD', objective: 'traffic' }, true, OBJECTIVE],
    [
      'an event on a case variant of conversions',
      { conversionEvent: 'LEAD', objective: 'Conversions' },
      true,
      'The conversion event needs a Reddit objective Reddit supports. Choose the conversions objective.',
    ],
  ])('%s', (_name, raw, enabled, message) => {
    const refusal = redditConversionEventRefusal(raw, enabled);
    expect(refusal?.message ?? null).toBe(message);
    if (refusal) expect(refusal.field).toBe('redditConfig.conversionEvent');
  });
});

describe('the conversion event picker', () => {
  it.each([
    [true, 'conversions', true],
    [true, 'traffic', false],
    [false, 'conversions', false],
    [null, 'conversions', false],
  ] as const)('with the capability %s on %s, offered: %s', (enabled, objective, offered) => {
    expect(redditConversionEventOffered(enabled, objective)).toBe(offered);
  });

  it.each([
    ['LEAD', 'conversions', true, { conversionEvent: 'LEAD' }],
    ['PURCHASE', 'conversions', true, {}],
    ['LEAD', 'awareness', true, {}],
    ['LEAD', 'conversions', null, {}],
  ] as const)('sends %s on %s with the capability %s as %j', (event, objective, enabled, expected) => {
    expect(redditConversionEventField(event, objective, enabled)).toEqual(expected);
  });

  it.each([
    ['LEAD', 'conversions', true, 'ready', 'b1', null],
    ['PURCHASE', 'conversions', false, 'ready', 'b1', null],
    ['LEAD', 'traffic', false, 'ready', 'b1', null],
    ['LEAD', 'conversions', false, 'ready', 'b1', 'unsupported'],
    ['LEAD', 'conversions', null, 'pending', 'b1', 'pending'],
    ['LEAD', 'conversions', null, 'unknown', null, 'unsaved'],
    ['LEAD', 'conversions', null, 'failed', 'b1', 'failed'],
  ] as const)('holds %s on %s (capability %s, read %s, brief %s): %s', (event, objective, enabled, read, briefId, kind) => {
    expect(redditConversionEventBlock(event as RedditConversionEvent, objective as RedditObjective, enabled, read, briefId)?.kind ?? null).toBe(kind);
  });

  it.each([
    ['SIGN_UP', 'SIGN_UP'],
    ['sign_up', undefined],
    [42, undefined],
    [undefined, undefined],
  ])('restores %j as %j', (stored, expected) => {
    expect(redditConversionEventFromDraft(stored)).toBe(expected);
  });
});
