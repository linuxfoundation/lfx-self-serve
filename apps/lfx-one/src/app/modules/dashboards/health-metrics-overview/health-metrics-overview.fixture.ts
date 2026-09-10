// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HealthMetricsAreaState, HealthMetricsFinding, HealthMetricsOverviewFoundationSummary, HealthMetricsOverviewRevenue } from '@lfx-one/shared/interfaces';

/**
 * Static fixture data standing in for LFXV2-3364's `hm_area_state` / `hm_findings` tables until
 * that backend ships — shaped to the exact agreed column contract so swapping in the real API
 * later only touches this container component's data source. Illustrative only: covers all 5
 * classifications and all 4 finding visual kinds, but isn't a real foundation's data.
 *
 * Kept component-local (not in `@lfx-one/shared`) since it's throwaway fixture data, not a shared
 * contract — delete this file once LFXV2-3364's API replaces it.
 */
export const HEALTH_METRICS_OVERVIEW_FIXTURE_AREA_STATE: HealthMetricsAreaState[] = [
  {
    area: 'eng',
    statValue: '8 of 31',
    statLabel: 'groups below 50% attendance',
    statSource: 'finding:ENG-01',
    classification: 'act',
    evaluatedAt: '2026-09-01',
  },
  { area: 'evt', statValue: '62%', statLabel: 'of registration goal', statSource: 'finding:EVT-01a', classification: 'watch', evaluatedAt: '2026-09-01' },
  { area: 'mem', statValue: '$1.30M', statLabel: 'dues overdue', statSource: 'finding:MEM-01', classification: 'act', evaluatedAt: '2026-09-01' },
  { area: 'non', statValue: '12', statLabel: 'high-fit orgs identified', statSource: 'finding:NON-01', classification: 'opp', evaluatedAt: '2026-09-01' },
  { area: 'trn', statValue: '—', statLabel: 'no data this period', statSource: 'standing:no-data', classification: 'none', evaluatedAt: '2026-09-01' },
  { area: 'code', statValue: '184', statLabel: 'active contributors', statSource: 'standing:contributors', classification: 'ok', evaluatedAt: '2026-09-01' },
];

export const HEALTH_METRICS_OVERVIEW_FIXTURE_FINDINGS: HealthMetricsFinding[] = [
  {
    classification: 'act',
    area: 'eng',
    title: 'Committee attendance below threshold',
    sentence: 'Lowest is TAG App Delivery at 29%.',
    emphasis: 'TAG App Delivery',
    keyValue: '8 of 31',
    keyLabel: 'below 50%',
    linkTarget: 'eng.groups',
    sortRank: 10,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'dots', groups: [{ label: 'Groups below 50% attendance', filled: 8, total: 31 }], caption: 'Groups below 50% attendance' },
  },
  {
    classification: 'act',
    area: 'mem',
    title: 'At-risk dues are climbing',
    sentence: 'Largest is Contoso Systems at $120K.',
    emphasis: 'Contoso Systems',
    keyValue: '$1.30M',
    keyLabel: 'overdue · 40 members',
    linkTarget: 'mem.atrisk',
    sortRank: 20,
    evaluatedAt: '2026-09-01',
    visual: {
      kind: 'bar',
      parts: [
        { label: 'At risk', value: 65, tone: 'act' },
        { label: 'Healthy', value: 35, tone: 'ok' },
      ],
      caption: 'Share of dues at risk',
    },
  },
  {
    classification: 'watch',
    area: 'evt',
    title: 'Event pacing below goal',
    sentence: 'Open Source Summit is at 62% of its registration goal.',
    emphasis: 'Open Source Summit',
    keyValue: '62%',
    keyLabel: 'of goal, 3 weeks out',
    linkTarget: 'evt.forecast',
    sortRank: 30,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'band', low: 55, high: 70, goal: 100, pred: 62, caption: 'Registration forecast vs. goal' },
  },
  {
    classification: 'watch',
    area: 'mem',
    title: 'Renewal risk rising',
    sentence: '5 members have not confirmed renewal within 30 days of expiry.',
    emphasis: '5 members',
    keyValue: '5 of 62',
    keyLabel: 'renewals at risk',
    linkTarget: 'mem.renewals',
    sortRank: 40,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'dots', groups: [{ label: 'At-risk renewals', filled: 5, total: 62 }] },
  },
  {
    classification: 'opp',
    area: 'non',
    title: 'High-fit prospects identified',
    sentence: '12 organizations match member criteria but haven’t joined.',
    emphasis: '12 organizations',
    keyValue: '12',
    keyLabel: 'high-fit orgs',
    linkTarget: 'non.orgs',
    sortRank: 50,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'tags', tags: ['Cloud', 'Fintech', 'Healthcare'] },
  },
  {
    classification: 'ok',
    area: 'code',
    title: 'Contributor base holding steady',
    sentence: 'Active contributors are flat quarter over quarter.',
    keyValue: '184',
    keyLabel: 'active contributors',
    linkTarget: 'code.insights',
    sortRank: 60,
    evaluatedAt: '2026-09-01',
  },
  {
    classification: 'none',
    area: 'trn',
    title: 'Awaiting enrollment data',
    sentence: 'No enrollment file received for this reporting period.',
    keyValue: '—',
    keyLabel: 'not yet available',
    linkTarget: 'trn.enrollment',
    sortRank: 70,
    evaluatedAt: '2026-09-01',
  },
];

/** Rail "Foundation Revenue" stand-in — mirrors the design's `d.revenue`. See the file header note on LFXV2-3364. */
export const HEALTH_METRICS_OVERVIEW_FIXTURE_REVENUE: HealthMetricsOverviewRevenue = {
  total: 2_450_000,
  streams: [
    { key: 'memberships', value: 1_680_000 },
    { key: 'events', value: 540_000 },
    { key: 'training', value: 230_000 },
  ],
};

/** Rail "Foundation" block stand-in — mirrors the design's `RAIL[CUR]`. See the file header note on LFXV2-3364. */
export const HEALTH_METRICS_OVERVIEW_FIXTURE_FOUNDATION_SUMMARY: HealthMetricsOverviewFoundationSummary = {
  size: 'Large',
  projects: 14,
  tiers: '4 tiers',
  board: '12 seats',
  nextRenewals: '5 in the next 30 days',
};
