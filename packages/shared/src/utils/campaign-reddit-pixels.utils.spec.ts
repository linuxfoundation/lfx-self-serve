// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { REDDIT_PIXEL_PICKER_REASONS, REDDIT_PIXEL_PICKER_TRUNCATED } from '../constants/campaign.constants';
import type { RedditPixelPickerState, RedditPixelPickerView } from '../interfaces/campaign.interface';
import { redditPixelPickerReason, redditPixelPickerView, redditPixelsFromPayload, redditPixelsQueryParams } from './campaign-reddit-pixels.utils';

describe('redditPixelsFromPayload', () => {
  it.each<[string, unknown]>([
    ['not an object', 'pixels'],
    ['an array', []],
    ['no pixels', { account_id: 't2_acct', pixel_count: 0, truncated: false }],
    ['pixels that are not a list', { account_id: 't2_acct', pixels: {}, pixel_count: 0, truncated: false }],
  ])('reads %s as unreadable', (_name, payload) => {
    expect(redditPixelsFromPayload(payload)).toBeNull();
  });

  it.each<[string, unknown, unknown]>([
    [
      'an account with no pixel',
      { account_id: 't2_acct', pixels: [], pixel_count: 0, truncated: false },
      { accountId: 't2_acct', pixels: [], pixelCount: 0, truncated: false },
    ],
    [
      'pixels camel-cased, an empty name kept and a blank business left out',
      {
        account_id: 't2_acct',
        pixels: [
          { id: 't2_pix1', name: 'Site pixel', business_id: 'biz_1' },
          { id: 't2_pix2', name: '', business_id: ' ' },
        ],
        pixel_count: 2,
        truncated: true,
      },
      {
        accountId: 't2_acct',
        pixels: [
          { id: 't2_pix1', name: 'Site pixel', businessId: 'biz_1' },
          { id: 't2_pix2', name: '' },
        ],
        pixelCount: 2,
        truncated: true,
      },
    ],
    [
      'unusable and repeated ids dropped, and counted as offered',
      {
        pixels: [{ id: 'has space' }, { id: 'a'.repeat(65) }, { id: 7 }, null, { id: 'ok_1', name: 3 }, { id: 'ok_1', name: 'again' }],
        pixel_count: 6,
        truncated: 'yes',
      },
      { accountId: '', pixels: [{ id: 'ok_1', name: '' }], pixelCount: 1, truncated: false },
    ],
  ])('reads %s', (_name, payload, expected) => {
    expect(redditPixelsFromPayload(payload)).toEqual(expected);
  });
});

describe('redditPixelsQueryParams', () => {
  it('names the project as the custom-audience read does', () => {
    expect(redditPixelsQueryParams('tlf')).toEqual({ project: 'tlf' });
  });
});

describe('redditPixelPickerReason', () => {
  it.each<[number, string]>([
    [403, REDDIT_PIXEL_PICKER_REASONS.restricted],
    [503, REDDIT_PIXEL_PICKER_REASONS.failed],
    [404, REDDIT_PIXEL_PICKER_REASONS.failed],
    [0, REDDIT_PIXEL_PICKER_REASONS.failed],
  ])('explains a %i', (status, expected) => {
    expect(redditPixelPickerReason(status)).toBe(expected);
  });
});

describe('redditPixelPickerView', () => {
  const state = (over: Partial<RedditPixelPickerState>): RedditPixelPickerState => ({ status: 'loaded', pixels: [], truncated: false, reason: null, ...over });
  const PIXELS = [
    { id: 't2_site', name: 'Site pixel' },
    { id: 't2_bare', name: ' ' },
  ];
  const CHOICES = [
    { value: 't2_site', label: 'Site pixel (t2_site)' },
    { value: 't2_bare', label: 't2_bare' },
  ];
  it.each<[string, RedditPixelPickerState, string, RedditPixelPickerView]>([
    ['a read in flight', state({ status: 'loading' }), '', { mode: 'loading', choices: [], heldIdUnlisted: false, note: null }],
    [
      'a refused read, as the typed box with why',
      state({ status: 'unavailable', reason: REDDIT_PIXEL_PICKER_REASONS.restricted }),
      't2_typed',
      { mode: 'text', choices: [], heldIdUnlisted: false, note: REDDIT_PIXEL_PICKER_REASONS.restricted },
    ],
    ['an empty list, as the typed box', state({}), '', { mode: 'text', choices: [], heldIdUnlisted: false, note: REDDIT_PIXEL_PICKER_REASONS.empty }],
    ['no read (no project), as the typed box', state({ status: 'idle' }), '', { mode: 'text', choices: [], heldIdUnlisted: false, note: null }],
    ['a list, an unnamed pixel by its id', state({ pixels: PIXELS }), '', { mode: 'select', choices: CHOICES, heldIdUnlisted: false, note: null }],
    ['a listed held id', state({ pixels: PIXELS }), ' t2_site ', { mode: 'select', choices: CHOICES, heldIdUnlisted: false, note: null }],
    ['an unlisted held id, kept', state({ pixels: PIXELS }), 't2_gone', { mode: 'select', choices: CHOICES, heldIdUnlisted: true, note: null }],
    [
      'a truncated list',
      state({ pixels: PIXELS, truncated: true }),
      '',
      { mode: 'select', choices: CHOICES, heldIdUnlisted: false, note: REDDIT_PIXEL_PICKER_TRUNCATED },
    ],
  ])('shows %s', (_name, read, held, expected) => {
    expect(redditPixelPickerView(read, held)).toEqual(expected);
  });
});
