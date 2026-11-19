// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_WORLD_MAP_EMPTY_FILL, HEALTH_METRICS_WORLD_MAP_RAMP } from '../constants/health-metrics-world-map.constants';
import { buildHealthMetricsWorldMapView, formatHealthMetricsCountryFlag, healthMetricsWorldMapFill } from './health-metrics-world-map.utils';

import type { HealthMetricsWorldGeometry } from '../interfaces/health-metrics-world-map.interface';

const GEOMETRY: HealthMetricsWorldGeometry = {
  source: 'test',
  width: 960,
  height: 470,
  countries: [
    { code: 'US', name: 'United States', d: 'M0,0L1,1Z' },
    { code: 'FJ', name: 'Fiji', d: 'M2,2L3,3Z' },
    { code: 'NO', name: 'Norway', d: 'M4,4L5,5Z' },
  ],
};

describe('healthMetricsWorldMapFill', () => {
  it('steps through the six blues on a log scale against the largest value', () => {
    expect(HEALTH_METRICS_WORLD_MAP_RAMP).toEqual(['#D9E9FF', '#B8D9FF', '#85C2FF', '#009AFF', '#0082D9', '#0061A3']);
    // floor(log(v) / log(max + 1) × 6), against a max of 1,000: the + 1 keeps 10 and 100 just under their thirds.
    expect(healthMetricsWorldMapFill(1, 1000)).toBe('#D9E9FF');
    expect(healthMetricsWorldMapFill(10, 1000)).toBe('#B8D9FF');
    expect(healthMetricsWorldMapFill(100, 1000)).toBe('#009AFF');
    expect(healthMetricsWorldMapFill(1000, 1000)).toBe('#0061A3');
  });

  it('fills a country with nothing in neutral-200', () => {
    expect(HEALTH_METRICS_WORLD_MAP_EMPTY_FILL).toBe('#E2E8F0');
    expect(healthMetricsWorldMapFill(0, 1000)).toBe('#E2E8F0');
    expect(healthMetricsWorldMapFill(5, 0)).toBe('#E2E8F0');
  });
});

describe('buildHealthMetricsWorldMapView', () => {
  it('draws every outline, joins the figures by code and titles each popup with the data name', () => {
    const view = buildHealthMetricsWorldMapView(
      GEOMETRY,
      [
        { code: 'US', name: 'USA', value: 1000, valueLabel: '1,000 · 99%' },
        { code: 'FJ', name: 'Fiji', value: 1, valueLabel: '1 · <1%' },
        { code: null, name: 'Atlantis', value: 5, valueLabel: '5 · <1%' },
      ],
      'Registrations'
    );

    expect(view.viewBox).toBe('0 0 960 470');
    expect(view.paths.map((path) => [path.code, path.fill])).toEqual([
      ['US', '#0061A3'],
      ['FJ', '#D9E9FF'],
      ['NO', '#E2E8F0'],
    ]);
    expect(view.paths[0].tip).toEqual({
      title: 'USA',
      rows: [{ label: 'Registrations', value: '1,000 · 99%', color: '#0061A3', separated: false, inline: true }],
    });
  });

  it('reads a country with no figure as None, titled with its outline name', () => {
    const view = buildHealthMetricsWorldMapView(GEOMETRY, [], 'Registrations');

    expect(view.paths[2].tip).toEqual({
      title: 'Norway',
      rows: [{ label: 'Registrations', value: 'None', color: '#E2E8F0', separated: false, inline: true }],
    });
  });
});

describe('formatHealthMetricsCountryFlag', () => {
  it('spells a two-letter code as regional-indicator emoji, and nothing for anything else', () => {
    expect(formatHealthMetricsCountryFlag('US')).toBe('🇺🇸');
    expect(formatHealthMetricsCountryFlag('XK')).toBe('🇽🇰');
    expect(formatHealthMetricsCountryFlag(null)).toBe('');
    expect(formatHealthMetricsCountryFlag('usa')).toBe('');
  });
});
