// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';

import type { HealthMetricsNonMembersSubNavItem } from '../interfaces/health-metrics-non-members.interface';

/** Sub-nav items for the Non-Members tab. No section reads data yet, so none carries a badge or note. */
export function buildHealthMetricsNonMembersSubNavItems(): HealthMetricsNonMembersSubNavItem[] {
  return HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: '' }));
}
