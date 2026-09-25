// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import { buildHealthMetricsEventsSubNavItems } from './health-metrics-events.utils';

describe('buildHealthMetricsEventsSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsEventsSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsEventsSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });
});
