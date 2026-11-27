// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CampaignServiceAccountMonitor } from '../interfaces/campaign.interface';
import { campaignMonitorProvenance, campaignMonitorScope, withRecordedProjects } from './campaign-monitor-scope.utils';

describe('campaignMonitorScope', () => {
  it.each([
    [true, 'granted', 'account'],
    [true, 'denied', undefined],
    [true, 'unverified', undefined],
    [false, 'granted', undefined],
  ] as const)('flag %s, role %s -> %s', (flagOn, access, want) => {
    expect(campaignMonitorScope(flagOn, access)).toBe(want);
  });
});

describe('withRecordedProjects', () => {
  const payload = {
    campaigns: [
      { platform_campaign_id: 'a', recorded_project_id: 'cncf' },
      { platform_campaign_id: 'b' },
      { platform_campaign_id: 'c', recorded_project_id: ' ' },
    ],
  } as unknown as CampaignServiceAccountMonitor;

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
