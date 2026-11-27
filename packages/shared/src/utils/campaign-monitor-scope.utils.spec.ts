// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { campaignMonitorProvenance, campaignMonitorScope, withRecordedProjects } from './campaign-monitor-scope.utils';

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
