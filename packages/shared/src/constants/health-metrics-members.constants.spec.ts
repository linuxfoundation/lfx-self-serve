// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE,
  HEALTH_METRICS_TABS,
} from './health-metrics-engagement.constants';
import { HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE } from './health-metrics-events.constants';
import {
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_SUB_NAV_CROSS_REFERENCE,
} from './health-metrics-members.constants';

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

describe('Level 2 sub-nav cross-references', () => {
  const sectionKeysByRoute: Record<string, readonly string[]> = {
    engagement: HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => section.key),
    members: HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key),
  };

  it.each([
    ['Engagement', HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE],
    ['Events', HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE],
    ['Members', HEALTH_METRICS_MEMBERS_SUB_NAV_CROSS_REFERENCE],
  ])('links %s to a routed tab and one of its sections', (_tab, crossReference) => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.label === crossReference.linkLabel)?.route).toBe(crossReference.route);
    expect(sectionKeysByRoute[crossReference.route]).toContain(crossReference.fragment);
  });
});
