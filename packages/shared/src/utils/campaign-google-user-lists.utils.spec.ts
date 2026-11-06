// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { GoogleAdsUserListOption } from '../interfaces/campaign.interface';
import { googleUnpickedUserLists, googleUserListLabel } from './campaign-google-user-lists.utils';

const list = (overrides: Partial<GoogleAdsUserListOption> = {}): GoogleAdsUserListOption => ({
  resourceName: 'customers/8666746580/userLists/1',
  id: '1',
  name: 'KubeCon NA 2025 registrants',
  type: 'CRM_BASED',
  eligibleForSearch: true,
  ...overrides,
});

describe('googleUserListLabel', () => {
  it('names the list and its type in words', () => {
    expect(googleUserListLabel(list())).toBe('KubeCon NA 2025 registrants · Customer list');
  });

  it('warns when Google reports the list cannot serve on Search', () => {
    expect(googleUserListLabel(list({ type: 'RULE_BASED', eligibleForSearch: false }))).toBe(
      'KubeCon NA 2025 registrants · Website visitors · not eligible for Search'
    );
  });

  it('shows a type it does not know in sentence case', () => {
    expect(googleUserListLabel(list({ type: 'EXTERNAL_REMARKETING' }))).toBe('KubeCon NA 2025 registrants · External remarketing');
  });

  it('adds no warning when Google reported no eligibility, and no type when there is none', () => {
    expect(googleUserListLabel(list({ type: '', eligibleForSearch: null }))).toBe('KubeCon NA 2025 registrants');
  });
});

describe('googleUnpickedUserLists', () => {
  it('drops the lists already picked, keeping list order', () => {
    const lists = [list(), list({ resourceName: 'customers/8666746580/userLists/2', id: '2', name: 'B' }), list({ resourceName: 'customers/8666746580/userLists/3', id: '3', name: 'C' })];
    expect(googleUnpickedUserLists(lists, ['customers/8666746580/userLists/2']).map((l) => l.id)).toEqual(['1', '3']);
  });

  it('offers every list when nothing is picked', () => {
    expect(googleUnpickedUserLists([list()], [])).toHaveLength(1);
  });
});
