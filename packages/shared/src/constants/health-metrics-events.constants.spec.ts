// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_EVENTS_DATA_SECTIONS, HEALTH_METRICS_EVENTS_SECTIONS } from './health-metrics-events.constants';
import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';

describe('HEALTH_METRICS_EVENTS_SECTIONS', () => {
  it('keys the nine sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key)).toEqual(['forecast', 'past', 'kpi', 'reg', 'rev', 'spon', 'spk', 'orgs', 'geo']);
  });

  it('holds a deep link only for the sections that read data', () => {
    expect(HEALTH_METRICS_EVENTS_DATA_SECTIONS).toEqual(['kpi', 'forecast', 'past']);
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Events tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'events')?.route).toBe('events');
  });
});
