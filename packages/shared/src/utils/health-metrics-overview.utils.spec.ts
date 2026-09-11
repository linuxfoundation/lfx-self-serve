// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS, HEALTH_METRICS_OVERVIEW_GROUP_ORDER } from '../constants/health-metrics-overview.constants';

import {
  buildHealthMetricsOverviewPccUrl,
  buildHealthMetricsOverviewRevenueStreams,
  buildHealthMetricsOverviewTiles,
  groupHealthMetricsOverviewFindings,
  resolveHealthMetricsOverviewGroupMeta,
} from './health-metrics-overview.utils';

import type {
  HealthMetricsAreaState,
  HealthMetricsFinding,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewRevenueStreamKey,
} from '../interfaces/health-metrics-overview.interface';

function areaState(overrides: Partial<HealthMetricsAreaState> = {}): HealthMetricsAreaState {
  return {
    area: 'eng',
    statValue: '8 of 31',
    statLabel: 'below 50%',
    statSource: 'finding:ENG-01',
    classification: 'act',
    evaluatedAt: '2026-09-01',
    ...overrides,
  };
}

function finding(overrides: Partial<HealthMetricsFinding> = {}): HealthMetricsFinding {
  return {
    classification: 'act',
    area: 'eng',
    title: 'Some finding',
    sentence: 'Plain sentence.',
    keyValue: '1',
    keyLabel: 'thing',
    linkTarget: 'eng.groups',
    sortRank: 10,
    evaluatedAt: '2026-09-01',
    ...overrides,
  };
}

describe('buildHealthMetricsOverviewTiles', () => {
  it('omits an area with no matching row instead of rendering an empty tile', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'eng' })], undefined);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].area).toBe('eng');
  });

  it('renders all 6 areas in the fixed order when every row is present', () => {
    const areas: HealthMetricsAreaState['area'][] = ['eng', 'evt', 'mem', 'non', 'trn', 'code'];
    const tiles = buildHealthMetricsOverviewTiles(
      areas.map((area) => areaState({ area })),
      undefined
    );
    expect(tiles.map((tile) => tile.area)).toEqual(areas);
  });

  it('attaches the insights URL to the code tile only', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'eng' }), areaState({ area: 'code' })], 'https://insights.example/foundation');
    expect(tiles.find((tile) => tile.area === 'eng')?.insightsUrl).toBeUndefined();
    expect(tiles.find((tile) => tile.area === 'code')?.insightsUrl).toBe('https://insights.example/foundation');
  });
});

describe('groupHealthMetricsOverviewFindings', () => {
  it('returns no groups for an empty findings list', () => {
    expect(groupHealthMetricsOverviewFindings([])).toEqual([]);
  });

  it('hides a group with no findings this period', () => {
    const groups = groupHealthMetricsOverviewFindings([finding({ classification: 'act' }), finding({ classification: 'ok' })]);
    expect(groups.map((group) => group.group)).toEqual(['Needs action', 'Going well']);
    expect(groups.map((group) => group.classification)).toEqual(['act', 'ok']);
  });

  it('sorts findings within a group by sortRank, independent of input order', () => {
    const groups = groupHealthMetricsOverviewFindings([finding({ sortRank: 20 }), finding({ sortRank: 10 })]);
    expect(groups[0].findings.map((row) => row.sortRank)).toEqual([10, 20]);
  });

  it('degrades an out-of-contract classification to the neutral group instead of throwing', () => {
    const groups = groupHealthMetricsOverviewFindings([finding({ classification: 'unknown' as HealthMetricsFinding['classification'] })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('Awaiting data');
  });
});

describe('buildHealthMetricsOverviewPccUrl', () => {
  it('builds a PCC report URL for a known link target', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj-1', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj-1/reports/health-metrics/meetings#committees'
    );
  });

  it('strips a trailing slash from the base URL before joining', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev/', 'proj-1', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj-1/reports/health-metrics/meetings#committees'
    );
  });

  it('encodes the project id in the URL path', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj 1/two', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj%201%2Ftwo/reports/health-metrics/meetings#committees'
    );
  });

  it('returns undefined for an unrecognized link target (e.g. code.insights, which opens externally instead)', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj-1', 'code.insights')).toBeUndefined();
  });

  it('returns undefined for a missing project id', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', '', 'eng.groups')).toBeUndefined();
  });
});

describe('resolveHealthMetricsOverviewGroupMeta', () => {
  it('resolves a known classification to its tone/icon', () => {
    expect(resolveHealthMetricsOverviewGroupMeta('act')).toEqual({ textClass: 'text-red-600', icon: 'fa-light fa-circle-exclamation' });
  });

  it('degrades an out-of-contract classification to the neutral tone/icon instead of throwing', () => {
    expect(resolveHealthMetricsOverviewGroupMeta('unknown' as HealthMetricsFinding['classification'])).toEqual({
      textClass: 'text-gray-500',
      icon: 'fa-light fa-circle-info',
    });
  });
});

describe('buildHealthMetricsOverviewRevenueStreams', () => {
  function revenue(overrides: Partial<HealthMetricsOverviewRevenue> = {}): HealthMetricsOverviewRevenue {
    return {
      total: 100,
      streams: [
        { key: 'memberships', value: 60 },
        { key: 'events', value: 40 },
      ],
      ...overrides,
    };
  }

  it('computes each stream’s percent share of the total and formats its value', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue());
    expect(streams).toEqual([
      { label: 'Memberships', dotClass: 'bg-blue-500', percent: 60, widthPercent: 60, valueLabel: expect.any(String) },
      { label: 'Events', dotClass: 'bg-emerald-500', percent: 40, widthPercent: 40, valueLabel: expect.any(String) },
    ]);
  });

  it('reports 0% for every stream when the total is 0, instead of dividing by zero', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ total: 0, streams: [{ key: 'training', value: 0 }] }));
    expect(streams[0].percent).toBe(0);
    expect(streams[0].widthPercent).toBe(0);
  });

  it('keeps widthPercent unrounded so independently-rounded segments cannot leave the bar short of 100%', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(
      revenue({
        total: 3,
        streams: [
          { key: 'memberships', value: 1 },
          { key: 'events', value: 1 },
          { key: 'training', value: 1 },
        ],
      })
    );
    expect(streams.map((stream) => stream.percent)).toEqual([33, 33, 33]);
    expect(streams.reduce((sum, stream) => sum + stream.widthPercent, 0)).toBeCloseTo(100);
  });

  it('degrades an out-of-contract stream key to a fallback label/color instead of throwing', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ streams: [{ key: 'unknown' as HealthMetricsOverviewRevenueStreamKey, value: 60 }] }));
    expect(streams[0].label).toBe('Other');
    expect(streams[0].dotClass).toBe('bg-gray-400');
  });
});

describe('HEALTH_METRICS_OVERVIEW_GROUP_ORDER', () => {
  it('is a permutation of every classification key, so the render order never silently drops a group', () => {
    expect([...HEALTH_METRICS_OVERVIEW_GROUP_ORDER].sort()).toEqual(Object.keys(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS).sort());
  });
});
