// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import type { HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `M2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsMembersSectionKey = (typeof HEALTH_METRICS_MEMBERS_SECTIONS)[number]['key'];

/** Members' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsMembersSectionKey;
}
