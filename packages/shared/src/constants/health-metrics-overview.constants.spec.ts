// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  buildHealthMetricsOverviewPeriods,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_OVERVIEW_SIGNAL_BAND_CLASSIFICATIONS,
  HEALTH_OVERVIEW_SIGNAL_LINK_TARGETS,
  HEALTH_OVERVIEW_SIGNAL_PERIOD_RANGES,
} from './health-metrics-overview.constants';
import { buildHealthMetricsOverviewTabRoute } from '../utils/health-metrics-overview.utils';

describe('HEALTH_OVERVIEW_SIGNAL_PERIOD_RANGES', () => {
  it('covers exactly the ranges the period selector offers, so every period has a feed', () => {
    expect(Object.values(HEALTH_OVERVIEW_SIGNAL_PERIOD_RANGES).sort()).toEqual(
      buildHealthMetricsOverviewPeriods()
        .map((period) => period.range)
        .sort()
    );
  });
});

describe('HEALTH_OVERVIEW_SIGNAL_BAND_CLASSIFICATIONS', () => {
  it('maps every severity band onto a real classification', () => {
    for (const classification of Object.values(HEALTH_OVERVIEW_SIGNAL_BAND_CLASSIFICATIONS)) {
      expect(Object.keys(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS)).toContain(classification);
    }
  });
});

describe('HEALTH_OVERVIEW_SIGNAL_LINK_TARGETS', () => {
  it.each(Object.entries(HEALTH_OVERVIEW_SIGNAL_LINK_TARGETS))('links %s to an in-app section', (_signalKey, linkTarget) => {
    expect(buildHealthMetricsOverviewTabRoute(linkTarget)).toBeDefined();
  });
});

describe('HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS', () => {
  it('words the tile status chip per the design while the findings groups keep their headings', () => {
    expect(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.ok).toEqual(expect.objectContaining({ label: 'Healthy', group: 'Going well' }));
    expect(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none).toEqual(expect.objectContaining({ label: 'No data', group: 'Awaiting data' }));
  });

  // The design's accent (`#009aff`, our blue-500) colours both the Opportunity chip and its group heading.
  it('colours the Opportunity chip and the Opportunities heading with the accent blue-500', () => {
    expect(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.opp).toEqual(
      expect.objectContaining({ label: 'Opportunity', statusTextClass: 'text-blue-500', textClass: 'text-blue-500' })
    );
  });
});
