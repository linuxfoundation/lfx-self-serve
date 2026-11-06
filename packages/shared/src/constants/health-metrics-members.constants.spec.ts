// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import {
  HEALTH_METRICS_MEMBERS_BREAKDOWN_PALETTE,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_RESERVED_COLORS,
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from './health-metrics-members.constants';

describe('HEALTH_METRICS_MEMBERS_SECTIONS', () => {
  it('keys the eight sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  it('holds a deep link for every section that reads data', () => {
    expect(HEALTH_METRICS_MEMBERS_DATA_SECTIONS).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });
});

describe('HEALTH_METRICS_MEMBERS_BREAKDOWN_PALETTE', () => {
  it("never repeats a colour, and holds the reserved tiers' own colours out", () => {
    const colors = HEALTH_METRICS_MEMBERS_BREAKDOWN_PALETTE.map((entry) => entry.color);

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).not.toContain(HEALTH_METRICS_MEMBERS_BREAKDOWN_RESERVED_COLORS.platinum);
    expect(colors).not.toContain(HEALTH_METRICS_MEMBERS_BREAKDOWN_RESERVED_COLORS.gold);
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'members')?.route).toBe('members');
  });
});
