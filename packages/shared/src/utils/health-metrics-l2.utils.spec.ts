// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '../constants/health-metrics-engagement.constants';
import { buildHealthMetricsL2SectionId, buildHealthMetricsL2SectionViews, isHealthMetricsL2SectionKey } from './health-metrics-l2.utils';

describe('buildHealthMetricsL2SectionId', () => {
  it('prefixes the key so the DOM id never collides with the bare URL fragment', () => {
    expect(buildHealthMetricsL2SectionId(HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX, 'committees')).toBe('sec-eng-committees');
  });
});

describe('buildHealthMetricsL2SectionViews', () => {
  it('resolves the anchor and heading id for every section, keeping its copy', () => {
    const views = buildHealthMetricsL2SectionViews(HEALTH_METRICS_ENGAGEMENT_SECTIONS, HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX);

    expect(views).toHaveLength(HEALTH_METRICS_ENGAGEMENT_SECTIONS.length);
    expect(views[0]).toEqual({
      ...HEALTH_METRICS_ENGAGEMENT_SECTIONS[0],
      id: `sec-eng-${HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key}`,
      headingId: `sec-eng-${HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key}-heading`,
    });
  });
});

describe('isHealthMetricsL2SectionKey', () => {
  it('accepts every shipped section key', () => {
    for (const section of HEALTH_METRICS_ENGAGEMENT_SECTIONS) {
      expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, section.key)).toBe(true);
    }
  });

  it('rejects anything else, including the prefixed DOM id and an absent fragment', () => {
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, 'sec-eng-committees')).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, 'groups')).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, null)).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, undefined)).toBe(false);
  });
});
