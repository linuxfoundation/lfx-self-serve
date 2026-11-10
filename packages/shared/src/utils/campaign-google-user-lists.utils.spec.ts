// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { GoogleAdsUserListOption } from '../interfaces/campaign.interface';
import {
  googleAdsCanonicalPositiveId,
  googleCampaignAudienceSegmentFault,
  googleCampaignAudienceSegmentsRefusal,
  googleUnpickedUserLists,
  googleUserListLabel,
} from './campaign-google-user-lists.utils';

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
    const lists = [
      list(),
      list({ resourceName: 'customers/8666746580/userLists/2', id: '2', name: 'B' }),
      list({ resourceName: 'customers/8666746580/userLists/3', id: '3', name: 'C' }),
    ];
    expect(googleUnpickedUserLists(lists, ['customers/8666746580/userLists/2']).map((l) => l.id)).toEqual(['1', '3']);
  });

  it('offers every list when nothing is picked', () => {
    expect(googleUnpickedUserLists([list()], [])).toHaveLength(1);
  });
});

/**
 * One test per branch of upstream's `validateCampaignAudienceSegments` per-entry checks
 * (`search_campaign_audiences.go:88-104` at v1.0.33), the account match excepted, plus the accept-cases.
 */
describe('googleCampaignAudienceSegmentFault', () => {
  it('accepts a canonical user list', () => {
    expect(googleCampaignAudienceSegmentFault('customers/8666746580/userLists/111')).toBeNull();
  });

  it('refuses a blank entry', () => {
    expect(googleCampaignAudienceSegmentFault('')).toBe('blank');
  });

  it.each([
    ['a bare id', '111'],
    ['a customer id with dashes', 'customers/866-674-6580/userLists/111'],
    ['a trailing segment', 'customers/1/userLists/111/x'],
    ['a non-numeric list id', 'customers/1/userLists/abc'],
    ['another prefix', 'accounts/1/userLists/111'],
    ['a signed id', 'customers/1/userLists/+111'],
  ])('refuses %s as not a resource name', (_label, value) => {
    expect(googleCampaignAudienceSegmentFault(value)).toBe('shape');
  });

  it.each([
    ['a custom audience', 'customers/1/customAudiences/2'],
    ['an Audience', 'customers/1/audiences/2'],
  ])('refuses %s as not a user list', (_label, value) => {
    expect(googleCampaignAudienceSegmentFault(value)).toBe('notUserList');
  });

  it.each([
    ['a leading zero', 'customers/1/userLists/0111'],
    ['zero', 'customers/1/userLists/0'],
    ['an id past int64', 'customers/1/userLists/9223372036854775808'],
  ])('refuses %s as a non-canonical id', (_label, value) => {
    expect(googleCampaignAudienceSegmentFault(value)).toBe('id');
  });
});

describe('googleAdsCanonicalPositiveId', () => {
  it('accepts the largest int64 and refuses one more, as ParseInt does', () => {
    expect(googleAdsCanonicalPositiveId('9223372036854775807')).toBe(true);
    expect(googleAdsCanonicalPositiveId('9223372036854775808')).toBe(false);
    expect(googleAdsCanonicalPositiveId('10000000000000000000')).toBe(false);
  });
});

/** The list-level branches (`search_campaign_audiences.go:82-112`), in upstream's order. */
describe('googleCampaignAudienceSegmentsRefusal', () => {
  const lists = (n: number): string[] => Array.from({ length: n }, (_, i) => `customers/1/userLists/${i + 1}`);

  it('accepts an empty list and 20 distinct lists', () => {
    expect(googleCampaignAudienceSegmentsRefusal([])).toBeNull();
    expect(googleCampaignAudienceSegmentsRefusal(lists(20))).toBeNull();
  });

  it('accepts 80 raw entries that collapse to 20 lists, because the cap is on the distinct lists', () => {
    const twenty = lists(20);
    expect(googleCampaignAudienceSegmentsRefusal([...twenty, ...twenty, ...twenty, ...twenty])).toBeNull();
  });

  it('refuses more than 80 raw entries before judging any entry', () => {
    expect(googleCampaignAudienceSegmentsRefusal([...Array.from({ length: 81 }, () => 'customers/1/userLists/1'), ''])).toEqual({
      rule: 'entries',
      count: 82,
    });
  });

  it('refuses the first bad entry, by position', () => {
    expect(googleCampaignAudienceSegmentsRefusal(['customers/1/userLists/1', 'customers/1/customAudiences/2', ''])).toEqual({
      rule: 'entry',
      position: 2,
      fault: 'notUserList',
    });
  });

  it('refuses 21 distinct lists', () => {
    expect(googleCampaignAudienceSegmentsRefusal(lists(21))).toEqual({ rule: 'lists', count: 21 });
  });

  it('judges the entries before the distinct cap', () => {
    expect(googleCampaignAudienceSegmentsRefusal([...lists(21), 'nope'])).toEqual({ rule: 'entry', position: 22, fault: 'shape' });
  });
});
