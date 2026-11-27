// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  campaignMonitorGoogleAccountNote,
  campaignMonitorManagedElsewhere,
  campaignMonitorProvenance,
  campaignMonitorScope,
  campaignMonitorSystemAccountNote,
  withAccountWideSystemAccountRead,
  withRecordedProjects,
} from './campaign-monitor-scope.utils';

describe('campaignMonitorScope', () => {
  it.each([
    [true, true, 'granted', 'account'],
    [true, true, 'denied', undefined],
    [true, true, 'unverified', undefined],
    [true, false, 'granted', undefined],
    [false, true, 'granted', undefined],
  ] as const)('flag %s, opted in %s, role %s -> %s', (flagOn, requested, access, want) => {
    expect(campaignMonitorScope(flagOn, requested, access)).toBe(want);
  });
});

describe('withRecordedProjects', () => {
  const payload = {
    campaigns: [
      { platform_campaign_id: 'a', recorded_project_id: 'cncf' },
      { platform_campaign_id: 'b' },
      { platform_campaign_id: 'c', recorded_project_id: ' ' },
    ],
  };

  it('labels each row by campaign id: the recording project, or null when none records it', () => {
    const got = withRecordedProjects<
      { campaignId: string; recordedProjectId?: string | null },
      { campaigns: { campaignId: string; recordedProjectId?: string | null }[] }
    >({ campaigns: [{ campaignId: 'b' }, { campaignId: 'a' }, { campaignId: 'c' }, { campaignId: 'z' }] }, payload);
    expect(got.campaigns.map((c) => c.recordedProjectId)).toEqual([null, 'cncf', null, null]);
  });
});

describe('campaignMonitorProvenance', () => {
  it.each([
    [undefined, null],
    [null, 'Created outside LFX'],
    ['cncf', 'LFX: cncf'],
  ] as const)('%s -> %s', (recorded, want) => {
    expect(campaignMonitorProvenance(recorded)).toBe(want);
  });
});

describe('campaignMonitorManagedElsewhere', () => {
  it.each([
    [undefined, 'tlf', null],
    [null, 'tlf', null],
    ['tlf', 'tlf', null],
    ['cncf', 'tlf', 'cncf'],
  ] as const)('recorded %s, selected %s -> %s', (recorded, selected, want) => {
    expect(campaignMonitorManagedElsewhere(recorded, selected)).toBe(want);
  });
});

describe('withAccountWideSystemAccountRead', () => {
  it('marks a system-account read account-wide and replaces its project-only empty state', () => {
    expect(withAccountWideSystemAccountRead({ systemAccountRead: { accountId: '1', emptyMessage: 'No campaigns for this project' } })).toEqual({
      systemAccountRead: { accountId: '1', emptyMessage: 'No active campaigns found on this account.', accountWide: true },
    });
  });

  it('leaves a response without one alone', () => {
    const response: { campaigns: string[]; systemAccountRead?: { accountId: string | null; emptyMessage: string } } = { campaigns: [] };
    expect(withAccountWideSystemAccountRead(response)).toBe(response);
  });
});

describe('campaignMonitorSystemAccountNote', () => {
  it.each([
    [undefined, null],
    [{ accountId: null, emptyMessage: '' }, null],
    [
      { accountId: '512', emptyMessage: '' },
      'Read from LinkedIn account 512 through the LF system account. This project has no LinkedIn account bound of its own, so only the campaigns created for it are shown.',
    ],
    [
      { accountId: '512', emptyMessage: '', accountWide: true },
      'Read from LinkedIn account 512 through the LF system account. Every campaign on the account is shown, tagged with the project that created it or as created outside LFX.',
    ],
  ])('%j -> %s', (read, want) => {
    expect(campaignMonitorSystemAccountNote('LinkedIn', read)).toBe(want);
  });
});

describe('campaignMonitorGoogleAccountNote', () => {
  it.each([
    ['connection', '1', false, null],
    ['recorded_campaigns', undefined, false, null],
    [
      'recorded_campaigns',
      '1',
      false,
      "Read from Google Ads account 1, the account this project's campaigns were created under. This project has no Google Ads account bound of its own.",
    ],
    [
      'recorded_campaigns',
      '1',
      true,
      "Read from Google Ads account 1, the account this project's campaigns were created under, shown account-wide. This project has no Google Ads account bound of its own.",
    ],
    [
      'shared_account',
      '1',
      true,
      'Read from Google Ads account 1, the LF shared account, shown account-wide. This project has no Google Ads account bound of its own.',
    ],
  ] as const)('%s, %s, account-wide %s -> %s', (origin, accountId, accountWide, want) => {
    expect(campaignMonitorGoogleAccountNote(origin, accountId, accountWide)).toBe(want);
  });
});
