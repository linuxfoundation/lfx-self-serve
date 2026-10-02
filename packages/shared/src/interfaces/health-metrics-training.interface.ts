// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import type { HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `T2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsTrainingSectionKey = (typeof HEALTH_METRICS_TRAINING_SECTIONS)[number]['key'];

/** Training's sub-nav badge, keyed to its own sections. */
export interface HealthMetricsTrainingSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsTrainingSectionKey;
}

/** `GET /api/analytics/training-presence` query. */
export interface HealthMetricsTrainingPresenceQuery {
  foundationSlug: string;
}

/** Whether the foundation runs a training programme through LF Education. */
export interface HealthMetricsTrainingPresence {
  hasProgramme: boolean;
}

/** What the Training tab renders: a skeleton while reading, the shell, the no-programme state, or an error. */
export type HealthMetricsTrainingPresenceState = 'loading' | 'present' | 'absent' | 'failed';
