// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { buildHealthMetricsNonMembersSubNavItems } from './health-metrics-non-members.utils';

describe('buildHealthMetricsNonMembersSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsNonMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsNonMembersSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });
});
