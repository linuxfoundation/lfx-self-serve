// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';

import type { HealthMetricsMembersSubNavItem } from '../interfaces/health-metrics-members.interface';

/** Sub-nav items for the Members tab. No section reads data yet, so none carries a badge or note. */
export function buildHealthMetricsMembersSubNavItems(): HealthMetricsMembersSubNavItem[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: '' }));
}
