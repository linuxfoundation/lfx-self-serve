// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { redditPixelsFromPayload, redditPixelsQueryParams } from './campaign-reddit-pixels.utils';

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
