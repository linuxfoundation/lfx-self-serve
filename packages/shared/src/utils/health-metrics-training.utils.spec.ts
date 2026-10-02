// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import { buildHealthMetricsTrainingSubNavItems } from './health-metrics-training.utils';

describe('buildHealthMetricsTrainingSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsTrainingSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsTrainingSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });

  it('badges a section once it reports a count', () => {
    expect(buildHealthMetricsTrainingSubNavItems({ courses: 12 }).find((item) => item.key === 'courses')?.count).toBe(12);
  });
});
