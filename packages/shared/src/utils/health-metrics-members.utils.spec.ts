// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import { buildHealthMetricsMembersSubNavItems } from './health-metrics-members.utils';

describe('buildHealthMetricsMembersSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsMembersSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });
});
