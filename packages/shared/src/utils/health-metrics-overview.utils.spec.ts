// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_MEMBERS_QUERY_PARAMS, HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS, HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import {
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS,
  HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_GROUP_ORDER,
  HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS,
  HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS,
} from '../constants/health-metrics-overview.constants';
import { HEALTH_METRICS_TRAINING_QUERY_PARAMS, HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';

import {
  buildHealthMetricsOverviewEngagementRoute,
  buildHealthMetricsOverviewEventsRoute,
  buildHealthMetricsOverviewMembersRoute,
  buildHealthMetricsOverviewNonMembersRoute,
  buildHealthMetricsOverviewRevenueStreams,
  buildHealthMetricsOverviewTabRoute,
  buildHealthMetricsOverviewTiles,
  buildHealthMetricsOverviewTrainingRoute,
  formatHealthMetricsOverviewAsOfLabel,
  groupHealthMetricsOverviewFindings,
  resolveHealthMetricsOverviewGroupMeta,
  resolveHealthMetricsOverviewKpiClassification,
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

  it('links the eng tile into the Engagement tab group attendance view', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'eng' })], undefined);
    expect(tiles[0].route).toEqual({
      commands: ['/foundation/health-metrics', 'engagement'],
      fragment: 'committees',
      queryParams: { groupType: null, groupPage: null },
    });
    expect(tiles[0].routeLabel).toBe('View groups');
  });

  it('links the evt tile into the Events tab forecast', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'evt', statValue: '81%' })], undefined);
    expect(tiles[0].route).toEqual({ commands: ['/foundation/health-metrics', 'events'], fragment: 'forecast', queryParams: { event: null } });
    expect(tiles[0].routeLabel).toBe('View forecast');
  });

  it('links the mem tile into the Members tab all members list', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'mem', statValue: '$250K' })], undefined);
    expect(tiles[0].route).toEqual({
      commands: ['/foundation/health-metrics', 'members'],
      fragment: 'list',
      queryParams: { memTier: null, memNps: null, memSearch: null, memPage: null },
    });
    expect(tiles[0].routeLabel).toBe('View members');
  });

  it('links the non tile into the Non-Members tab on the High fit organizations', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'non', statValue: '$75K' })], undefined);
    expect(tiles[0].route).toEqual({
      commands: ['/foundation/health-metrics', 'non-members'],
      fragment: 'orgs',
      queryParams: { nonFit: 'high-fit', nonSearch: null, nonPage: null },
    });
    expect(tiles[0].routeLabel).toBe('View organizations');
  });

  it('links the trn tile into the Training tab enrollment section', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'trn', statValue: '1,240' })], undefined);
    expect(tiles[0].route).toEqual({ commands: ['/foundation/health-metrics', 'training'], fragment: 'enroll', queryParams: {} });
    expect(tiles[0].routeLabel).toBe('View enrollment');
  });

  it('links no tile outside eng, evt, mem, non and trn', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'code' })], undefined);
    expect(tiles[0].route).toBeUndefined();
    expect(tiles[0].routeLabel).toBeUndefined();
  });

  it.each(['eng', 'evt', 'mem', 'non', 'trn'] as const)('drops the %s tile link when the tile has no figure to drill into', (area) => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area, statValue: '—' })], undefined);
    expect(tiles[0].route).toBeUndefined();
    expect(tiles[0].routeLabel).toBeUndefined();
  });

  it('carries showStatus through to the tile view model', () => {
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'evt', showStatus: false })], undefined);
    expect(tiles[0].showStatus).toBe(false);
  });
  it('carries statDetail through to the tile view model', () => {
    const statDetail = { text: '3 of 7 unsecured · $185K', tone: 'watch' as const };
    const tiles = buildHealthMetricsOverviewTiles([areaState({ area: 'mem', statDetail })], undefined);
    expect(tiles[0].statDetail).toEqual(statDetail);
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

describe('resolveHealthMetricsOverviewKpiClassification', () => {
  it.each([
    ['healthy', 'ok'],
    ['needs_attention', 'watch'],
    ['needs_action', 'act'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(resolveHealthMetricsOverviewKpiClassification(status)).toBe(expected);
  });

  it('normalizes case and surrounding whitespace before matching', () => {
    expect(resolveHealthMetricsOverviewKpiClassification(' Healthy ')).toBe('ok');
    expect(resolveHealthMetricsOverviewKpiClassification('NEEDS_ATTENTION')).toBe('watch');
  });

  it('degrades an unrecognized status to none instead of throwing', () => {
    expect(resolveHealthMetricsOverviewKpiClassification('unknown')).toBe('none');
  });

  it('degrades null or undefined to none', () => {
    expect(resolveHealthMetricsOverviewKpiClassification(null)).toBe('none');
    expect(resolveHealthMetricsOverviewKpiClassification(undefined)).toBe('none');
  });
});

describe('formatHealthMetricsOverviewAsOfLabel', () => {
  it('returns an empty string for a never-evaluated (empty evaluatedAt) area', () => {
    expect(formatHealthMetricsOverviewAsOfLabel('')).toBe('');
  });

  it('formats a populated ISO date as an "as of" label', () => {
    expect(formatHealthMetricsOverviewAsOfLabel('2026-03-05')).toBe('as of Mar 5, 2026');
  });
});

describe('buildHealthMetricsOverviewEngagementRoute', () => {
  // Pins each target's full route, including the null that clears a stale cut on arrival.
  it.each([
    ['eng.board', 'committees', { groupType: 'gov', groupPage: null }],
    ['eng.groups', 'committees', { groupType: null, groupPage: null }],
    ['eng.orgs', 'orgs', { orgFilter: null }],
    ['eng.participation', 'participation', { partMode: null }],
  ] as const)('links %s to its section with its arrival filters', (target, fragment, queryParams) => {
    expect(buildHealthMetricsOverviewEngagementRoute(target)).toEqual({
      commands: ['/foundation/health-metrics', 'engagement'],
      fragment,
      queryParams,
    });
  });

  it('points every Engagement target at a real section', () => {
    const sectionKeys = HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => section.key as string);
    for (const target of Object.keys(HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS) as (keyof typeof HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS)[]) {
      expect(sectionKeys).toContain(buildHealthMetricsOverviewEngagementRoute(target)?.fragment);
    }
  });

  it('returns undefined for another tab or Insights target', () => {
    expect(buildHealthMetricsOverviewEngagementRoute('trn.enrollment')).toBeUndefined();
    expect(buildHealthMetricsOverviewEngagementRoute('code.insights')).toBeUndefined();
  });
});

describe('buildHealthMetricsOverviewEventsRoute', () => {
  it('links evt.forecast to the forecast and clears a stale event pick', () => {
    expect(buildHealthMetricsOverviewEventsRoute('evt.forecast')).toEqual({
      commands: ['/foundation/health-metrics', 'events'],
      fragment: 'forecast',
      queryParams: { event: null },
    });
  });

  it('points every Events target at a real section', () => {
    const sectionKeys = HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key as string);
    for (const target of Object.keys(HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS) as (keyof typeof HEALTH_METRICS_OVERVIEW_EVENTS_LINK_TARGETS)[]) {
      expect(sectionKeys).toContain(buildHealthMetricsOverviewEventsRoute(target)?.fragment);
    }
  });

  it('returns undefined for another tab or Insights target', () => {
    expect(buildHealthMetricsOverviewEventsRoute('eng.groups')).toBeUndefined();
    expect(buildHealthMetricsOverviewEventsRoute('mem.atrisk')).toBeUndefined();
    expect(buildHealthMetricsOverviewEventsRoute('trn.enrollment')).toBeUndefined();
    expect(buildHealthMetricsOverviewEventsRoute('code.insights')).toBeUndefined();
  });
});

describe('buildHealthMetricsOverviewMembersRoute', () => {
  // Pins each target's full route, including the nulls that clear a stale cut on arrival.
  it.each([
    ['mem.atrisk', 'risk', { riskBucket: null, riskPage: null }],
    ['mem.renewals', 'renewals', { renewalsWindow: null, renewalsPage: null }],
    ['mem.list', 'list', { memTier: null, memNps: null, memSearch: null, memPage: null }],
    ['mem.board', 'board', { boardCohort: null, boardPage: null }],
  ] as const)('links %s to its section with its arrival filters', (target, fragment, queryParams) => {
    expect(buildHealthMetricsOverviewMembersRoute(target)).toEqual({
      commands: ['/foundation/health-metrics', 'members'],
      fragment,
      queryParams,
    });
  });

  it('points every Members target at a real section', () => {
    const sectionKeys = HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key as string);
    for (const target of Object.keys(HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS) as (keyof typeof HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS)[]) {
      expect(sectionKeys).toContain(buildHealthMetricsOverviewMembersRoute(target)?.fragment);
    }
  });

  it('clears only params the Members tab reads', () => {
    const tabParams = Object.values(HEALTH_METRICS_MEMBERS_QUERY_PARAMS) as string[];
    for (const spec of Object.values(HEALTH_METRICS_OVERVIEW_MEMBERS_LINK_TARGETS)) {
      for (const param of Object.keys(spec.queryParams)) {
        expect(tabParams).toContain(param);
      }
    }
  });

  it('returns undefined for another tab or Insights target', () => {
    expect(buildHealthMetricsOverviewMembersRoute('eng.groups')).toBeUndefined();
    expect(buildHealthMetricsOverviewMembersRoute('evt.forecast')).toBeUndefined();
    expect(buildHealthMetricsOverviewMembersRoute('non.orgs')).toBeUndefined();
    expect(buildHealthMetricsOverviewMembersRoute('trn.enrollment')).toBeUndefined();
    expect(buildHealthMetricsOverviewMembersRoute('code.insights')).toBeUndefined();
  });
});

describe('buildHealthMetricsOverviewNonMembersRoute', () => {
  // Pins each target's full route, including the nulls that clear a stale cut on arrival.
  it.each([
    ['non.orgs', 'orgs', { nonFit: 'high-fit', nonSearch: null, nonPage: null }],
    ['non.conversion', 'conversion', {}],
  ] as const)('links %s to its section with its arrival filters', (target, fragment, queryParams) => {
    expect(buildHealthMetricsOverviewNonMembersRoute(target)).toEqual({
      commands: ['/foundation/health-metrics', 'non-members'],
      fragment,
      queryParams,
    });
  });

  it('points every Non-Members target at a real section', () => {
    const sectionKeys = HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.key as string);
    for (const target of Object.keys(HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS) as (keyof typeof HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS)[]) {
      expect(sectionKeys).toContain(buildHealthMetricsOverviewNonMembersRoute(target)?.fragment);
    }
  });

  it('sets only params the Non-Members tab reads', () => {
    const tabParams = Object.values(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS) as string[];
    for (const spec of Object.values(HEALTH_METRICS_OVERVIEW_NON_MEMBERS_LINK_TARGETS)) {
      for (const param of Object.keys(spec.queryParams)) {
        expect(tabParams).toContain(param);
      }
    }
  });

  it('returns undefined for another tab or Insights target', () => {
    expect(buildHealthMetricsOverviewNonMembersRoute('eng.groups')).toBeUndefined();
    expect(buildHealthMetricsOverviewNonMembersRoute('evt.forecast')).toBeUndefined();
    expect(buildHealthMetricsOverviewNonMembersRoute('mem.list')).toBeUndefined();
    expect(buildHealthMetricsOverviewNonMembersRoute('trn.enrollment')).toBeUndefined();
    expect(buildHealthMetricsOverviewNonMembersRoute('code.insights')).toBeUndefined();
  });
});

describe('buildHealthMetricsOverviewTrainingRoute', () => {
  it('links trn.enrollment to the enrollment section', () => {
    expect(buildHealthMetricsOverviewTrainingRoute('trn.enrollment')).toEqual({
      commands: ['/foundation/health-metrics', 'training'],
      fragment: 'enroll',
      queryParams: {},
    });
  });

  it('points every Training target at a real section', () => {
    const sectionKeys = HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.key as string);
    for (const target of Object.keys(HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS) as (keyof typeof HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS)[]) {
      expect(sectionKeys).toContain(buildHealthMetricsOverviewTrainingRoute(target)?.fragment);
    }
  });

  it('sets only params the Training tab reads', () => {
    const tabParams = Object.values(HEALTH_METRICS_TRAINING_QUERY_PARAMS) as string[];
    for (const spec of Object.values(HEALTH_METRICS_OVERVIEW_TRAINING_LINK_TARGETS)) {
      for (const param of Object.keys(spec.queryParams)) {
        expect(tabParams).toContain(param);
      }
    }
  });

  it('returns undefined for another tab or Insights target', () => {
    expect(buildHealthMetricsOverviewTrainingRoute('eng.groups')).toBeUndefined();
    expect(buildHealthMetricsOverviewTrainingRoute('evt.forecast')).toBeUndefined();
    expect(buildHealthMetricsOverviewTrainingRoute('mem.list')).toBeUndefined();
    expect(buildHealthMetricsOverviewTrainingRoute('non.orgs')).toBeUndefined();
    expect(buildHealthMetricsOverviewTrainingRoute('code.insights')).toBeUndefined();
  });
});

describe('buildHealthMetricsOverviewTabRoute', () => {
  it('resolves each in-app target to its own tab', () => {
    expect(buildHealthMetricsOverviewTabRoute('eng.orgs')?.commands).toEqual(['/foundation/health-metrics', 'engagement']);
    expect(buildHealthMetricsOverviewTabRoute('evt.forecast')?.commands).toEqual(['/foundation/health-metrics', 'events']);
    expect(buildHealthMetricsOverviewTabRoute('mem.renewals')?.commands).toEqual(['/foundation/health-metrics', 'members']);
    expect(buildHealthMetricsOverviewTabRoute('non.conversion')?.commands).toEqual(['/foundation/health-metrics', 'non-members']);
    expect(buildHealthMetricsOverviewTabRoute('trn.enrollment')?.commands).toEqual(['/foundation/health-metrics', 'training']);
  });

  it('returns undefined for the Insights target', () => {
    expect(buildHealthMetricsOverviewTabRoute('code.insights')).toBeUndefined();
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
      dataAvailable: true,
      total: 100,
      streams: [
        { key: 'memberships', value: 60, share: 60 },
        { key: 'events', value: 40, share: 40 },
      ],
      ...overrides,
    };
  }

  it('labels each stream with the model’s share and formats its value', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue());
    expect(streams).toEqual([
      { key: 'memberships', label: 'Memberships', dotClass: 'bg-blue-500', percentLabel: '60%', widthPercent: 60, valueLabel: expect.any(String) },
      { key: 'events', label: 'Events', dotClass: 'bg-emerald-500', percentLabel: '40%', widthPercent: 40, valueLabel: expect.any(String) },
    ]);
  });

  it('takes the legend percent and bar width from the model share rather than recomputing them from value/total', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ total: 100, streams: [{ key: 'training', value: 25, share: 31.6 }] }));
    expect(streams[0].percentLabel).toBe('32%');
    expect(streams[0].widthPercent).toBe(31.6);
  });

  it('draws no segment for a null share and clamps an out-of-range share to the bar', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(
      revenue({
        streams: [
          { key: 'events', value: 40, share: null },
          { key: 'memberships', value: 60, share: 120 },
          { key: 'training', value: 1, share: -5 },
        ],
      })
    );
    expect(streams.map((stream) => stream.widthPercent)).toEqual([0, 100, 0]);
  });

  it('renders "—" for the percent when the model has no share, keeping the value', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ streams: [{ key: 'events', value: 40, share: null }] }));
    expect(streams[0].percentLabel).toBe('—');
    expect(streams[0].valueLabel).not.toBe('—');
  });

  it('sizes the bar segment at 0 when the total and share are 0', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ total: 0, streams: [{ key: 'training', value: 0, share: 0 }] }));
    expect(streams[0].percentLabel).toBe('0%');
    expect(streams[0].widthPercent).toBe(0);
  });

  it('keeps widthPercent unrounded so independently-rounded segments cannot leave the bar short of 100%', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(
      revenue({
        total: 3,
        streams: [
          { key: 'memberships', value: 1, share: 33.33 },
          { key: 'events', value: 1, share: 33.33 },
          { key: 'training', value: 1, share: 33.34 },
        ],
      })
    );
    expect(streams.map((stream) => stream.percentLabel)).toEqual(['33%', '33%', '33%']);
    expect(streams.reduce((sum, stream) => sum + stream.widthPercent, 0)).toBeCloseTo(100);
  });

  it('renders a null stream as an em dash instead of $0 / 0%', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(revenue({ streams: [{ key: 'events', value: null, share: null }] }));
    expect(streams[0]).toEqual(expect.objectContaining({ percentLabel: '—', widthPercent: 0, valueLabel: '—' }));
  });

  it('degrades an out-of-contract stream key to a fallback label/color instead of throwing', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(
      revenue({ streams: [{ key: 'unknown' as HealthMetricsOverviewRevenueStreamKey, value: 60, share: 60 }] })
    );
    expect(streams[0].label).toBe('Other');
    expect(streams[0].dotClass).toBe('bg-gray-400');
  });

  it('preserves each stream’s own raw key even when two degrade to the same fallback label, so @for can track by a unique value', () => {
    const streams = buildHealthMetricsOverviewRevenueStreams(
      revenue({
        streams: [
          { key: 'unknown-a' as HealthMetricsOverviewRevenueStreamKey, value: 30, share: 30 },
          { key: 'unknown-b' as HealthMetricsOverviewRevenueStreamKey, value: 30, share: 30 },
        ],
      })
    );
    expect(streams.map((stream) => stream.label)).toEqual(['Other', 'Other']);
    expect(streams.map((stream) => stream.key)).toEqual(['unknown-a', 'unknown-b']);
  });
});

describe('HEALTH_METRICS_OVERVIEW_GROUP_ORDER', () => {
  it('is a permutation of every classification key, so the render order never silently drops a group', () => {
    expect([...HEALTH_METRICS_OVERVIEW_GROUP_ORDER].sort()).toEqual(Object.keys(HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS).sort());
  });
});
