// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import {
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS,
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES,
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_MATRIX_CAPTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS,
} from './health-metrics-members.constants';

describe('HEALTH_METRICS_MEMBERS_SECTIONS', () => {
  it('keys the seven sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['tiers', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  it('holds a deep link for every section that reads data', () => {
    expect(HEALTH_METRICS_MEMBERS_DATA_SECTIONS).toEqual(['tiers', 'bridge', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });
});

describe('HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES', () => {
  it('labels every step except the closing total, whose label is built per year', () => {
    expect(Object.keys(HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS)).toEqual(HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES.filter((step) => step !== 'today'));
  });
});

describe('HEALTH_METRICS_MEMBERS_TIERS_MATRIX_CAPTIONS', () => {
  it("captions every mode with the design's lead, swapping only the unit", () => {
    expect(Object.keys(HEALTH_METRICS_MEMBERS_TIERS_MATRIX_CAPTIONS)).toEqual(HEALTH_METRICS_MEMBERS_TIERS_MODE_OPTIONS.map((option) => option.id));
    expect(HEALTH_METRICS_MEMBERS_TIERS_MATRIX_CAPTIONS).toEqual({
      members: 'the most-used table in PCC — exact counts',
      revenue: 'the most-used table in PCC — in USD',
    });
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'members')?.route).toBe('members');
  });
});
