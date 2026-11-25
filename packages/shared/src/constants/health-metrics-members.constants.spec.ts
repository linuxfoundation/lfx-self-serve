// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import { HEALTH_METRICS_MEMBERS_DATA_SECTIONS, HEALTH_METRICS_MEMBERS_SECTIONS } from './health-metrics-members.constants';

describe('HEALTH_METRICS_MEMBERS_SECTIONS', () => {
  it('keys the eight sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  it('holds a deep link for every section that reads data', () => {
    expect(HEALTH_METRICS_MEMBERS_DATA_SECTIONS).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  // The design draws no caution or footnote under any Members section.
  it('carries no section note', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.filter((section) => 'note' in section)).toEqual([]);
  });

  it("describes at-risk and renewals in the design's words", () => {
    const description = (key: string) => HEALTH_METRICS_MEMBERS_SECTIONS.find((section) => section.key === key)?.description;

    expect(description('risk')).toBe('Members with unpaid invoices who may not renew.');
    expect(description('renewals')).toBe('Memberships coming up for renewal, and their value.');
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'members')?.route).toBe('members');
  });
});
