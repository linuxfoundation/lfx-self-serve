// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import { HEALTH_METRICS_MEMBERS_DATA_SECTIONS, HEALTH_METRICS_MEMBERS_SECTIONS } from './health-metrics-members.constants';

describe('HEALTH_METRICS_MEMBERS_SECTIONS', () => {
  it('keys the seven sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['tiers', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  it('holds no data section until a section issue wires one', () => {
    expect(HEALTH_METRICS_MEMBERS_DATA_SECTIONS).toEqual([]);
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'members')?.route).toBe('members');
  });
});
