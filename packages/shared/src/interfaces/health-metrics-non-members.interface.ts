// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import type { HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `N2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsNonMembersSectionKey = (typeof HEALTH_METRICS_NON_MEMBERS_SECTIONS)[number]['key'];

/** Non-Members' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsNonMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsNonMembersSectionKey;
}
