// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import type { HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `E2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsEventsSectionKey = (typeof HEALTH_METRICS_EVENTS_SECTIONS)[number]['key'];

/** Events' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsEventsSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsEventsSectionKey;
}
