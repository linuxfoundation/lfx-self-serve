// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import { HEALTH_METRICS_MEMBERS_SECTIONS } from './health-metrics-members.constants';
import {
  HEALTH_METRICS_TRAINING_DATA_SECTIONS,
  HEALTH_METRICS_TRAINING_SECTIONS,
  HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE,
} from './health-metrics-training.constants';

describe('HEALTH_METRICS_TRAINING_SECTIONS', () => {
  it('keys the two sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.key)).toEqual(['enroll', 'courses']);
  });

  it('marks the sections that read data', () => {
    expect(HEALTH_METRICS_TRAINING_DATA_SECTIONS).toEqual(['enroll']);
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Training tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'training')?.route).toBe('training');
  });
});

describe('HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE', () => {
  it('links to a routed tab and one of its sections', () => {
    const crossReference = HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE;

    expect(HEALTH_METRICS_TABS.find((tab) => tab.label === crossReference.linkLabel)?.route).toBe(crossReference.route);
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toContain(crossReference.fragment);
  });
});
