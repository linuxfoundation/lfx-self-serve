// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';

import type { HealthMetricsTrainingSectionKey, HealthMetricsTrainingSubNavItem } from '../interfaces/health-metrics-training.interface';

/** Sub-nav items for the Training tab; a section without a count carries no badge. */
export function buildHealthMetricsTrainingSubNavItems(
  counts: Partial<Record<HealthMetricsTrainingSectionKey, number | null>> = {}
): HealthMetricsTrainingSubNavItem[] {
  return HEALTH_METRICS_TRAINING_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: counts[section.key] ?? null, note: '' }));
}
