// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_EVENTS_DATA_SECTIONS,
  HEALTH_METRICS_EVENTS_FORECAST_FOOTNOTE,
  HEALTH_METRICS_EVENTS_FORECAST_VERDICT_TONES,
  HEALTH_METRICS_EVENTS_SECTIONS,
} from './health-metrics-events.constants';
import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';

describe('HEALTH_METRICS_EVENTS_SECTIONS', () => {
  it('keys the nine sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key)).toEqual(['forecast', 'past', 'kpi', 'reg', 'rev', 'spon', 'spk', 'orgs', 'geo']);
  });

  it('holds a deep link only for the sections that read data', () => {
    expect(HEALTH_METRICS_EVENTS_DATA_SECTIONS).toEqual(['kpi', 'forecast', 'past', 'reg', 'rev', 'spon', 'spk', 'orgs', 'geo']);
  });

  // The forecast draws its own footnote, so the shell never adds one under its closed or empty states.
  it('leaves the forecast footnote to the section itself', () => {
    expect(HEALTH_METRICS_EVENTS_SECTIONS.find((section) => section.key === 'forecast')?.footnote).toEqual([]);
    expect(HEALTH_METRICS_EVENTS_FORECAST_FOOTNOTE.map((part) => part.text).join('')).toMatch(/^The forecast is a projection from historical pacing curves/);
  });
});

describe('HEALTH_METRICS_EVENTS_FORECAST_VERDICT_TONES', () => {
  it('names each tone as the design does, tinting all but the summary', () => {
    expect(Object.entries(HEALTH_METRICS_EVENTS_FORECAST_VERDICT_TONES).map(([tone, style]) => [tone, style.label, style.tintClass !== ''])).toEqual([
      ['ok', 'Healthy', true],
      ['watch', 'Needs attention', true],
      ['act', 'Needs action', true],
      ['none', 'Summary', false],
    ]);
    expect(HEALTH_METRICS_EVENTS_FORECAST_VERDICT_TONES.none.icon).toBe('fa-light fa-circle-info');
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Events tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'events')?.route).toBe('events');
  });
});
