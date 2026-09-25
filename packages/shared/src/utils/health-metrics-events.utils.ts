// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';

import type { HealthMetricsEventsSubNavItem } from '../interfaces/health-metrics-events.interface';

/** Sub-nav items for the Events tab. No section reads data yet, so none carries a badge or note. */
export function buildHealthMetricsEventsSubNavItems(): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: '' }));
}
