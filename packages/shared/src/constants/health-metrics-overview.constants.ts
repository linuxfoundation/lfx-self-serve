// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsAreaState, HealthMetricsFinding } from '../interfaces/health-metrics-overview.interface';

/**
 * Fixed area order and display metadata for the LFXV2-3365 Overview page. Area keys match the
 * `link_target` prefixes in {@link HEALTH_METRICS_OVERVIEW_LINK_TARGETS} (`eng.*`, `evt.*`, ...).
 * Order here is the tile-strip render order — never re-sorted.
 */
export const HEALTH_METRICS_OVERVIEW_AREAS = [
  { key: 'eng', name: 'Engagement', icon: 'fa-light fa-handshake' },
  { key: 'evt', name: 'Events', icon: 'fa-light fa-calendar' },
  { key: 'mem', name: 'Members', icon: 'fa-light fa-building' },
  { key: 'non', name: 'Non-Members', icon: 'fa-light fa-magnifying-glass' },
  { key: 'trn', name: 'Training', icon: 'fa-light fa-graduation-cap' },
  { key: 'code', name: 'Code', icon: 'fa-light fa-code-branch' },
] as const;

/**
 * Urgency classification only — never category or size (logic spec hard constraint). Group name
 * is the fixed findings-list section a classification's rows render under.
 */
export const HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS = {
  act: { label: 'Needs action', group: 'Needs action', dotClass: 'bg-red-500', accentClass: 'border-l-red-500', textClass: 'text-red-600' },
  watch: { label: 'Needs attention', group: 'Needs attention', dotClass: 'bg-amber-500', accentClass: 'border-l-amber-500', textClass: 'text-amber-600' },
  opp: { label: 'Opportunity', group: 'Opportunities', dotClass: 'bg-blue-500', accentClass: 'border-l-blue-500', textClass: 'text-blue-600' },
  ok: { label: 'Going well', group: 'Going well', dotClass: 'bg-emerald-500', accentClass: 'border-l-emerald-500', textClass: 'text-emerald-600' },
  none: { label: 'Awaiting data', group: 'Awaiting data', dotClass: 'bg-gray-400', accentClass: 'border-l-gray-400', textClass: 'text-gray-500' },
} as const;

/** Findings-list section order — fixed, always rendered in this sequence; empty groups are hidden. */
export const HEALTH_METRICS_OVERVIEW_GROUP_ORDER = [
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.act.group,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.watch.group,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.opp.group,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.ok.group,
  HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none.group,
] as const;

/**
 * `link_target` → PCC anchor path, joined onto `…/project/{pcc_project_id}/reports/health-metrics`.
 * A one-line map so retiring a link when its Level 2 page ships is a one-line change.
 * `code.insights` is not here — it opens LFX Insights externally via `buildLensAwareInsightsUrl`.
 */
export const HEALTH_METRICS_OVERVIEW_LINK_TARGETS = {
  'eng.board': '/meetings#board',
  'eng.groups': '/meetings#committees',
  'eng.orgs': '/meetings#organizations',
  'eng.participation': '/meetings',
  'evt.forecast': '/events#forecast',
  'mem.atrisk': '/members#at-risk',
  'mem.renewals': '/members#renewals',
  'mem.list': '/members',
  'non.orgs': '/non-members',
  'trn.enrolment': '/training',
} as const;

/** The one `link_target` that opens externally (LFX Insights) instead of a PCC anchor. */
export const HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET = 'code.insights';

/**
 * Static fixture data standing in for LFXV2-3364's `hm_area_state` / `hm_findings` tables until
 * that backend ships — shaped to the exact agreed column contract so swapping in the real API
 * later only touches the container component's data source. Illustrative only: covers all 5
 * classifications and all 4 finding visual kinds, but isn't a real foundation's data.
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
    sentence: 'Lowest is <b>TAG App Delivery</b> at 29%.',
    keyValue: '8 of 31',
    keyLabel: 'below 50%',
    linkTarget: 'eng.groups',
    sortRank: 10,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'dots', groups: [{ label: 'Groups below 50% attendance', filled: 8, total: 31 }] },
  },
  {
    classification: 'act',
    area: 'mem',
    title: 'At-risk dues are climbing',
    sentence: 'Largest is <b>Contoso Systems</b> at $120K.',
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
    sentence: '<b>Open Source Summit</b> is at 62% of its registration goal.',
    keyValue: '62%',
    keyLabel: 'of goal, 3 weeks out',
    linkTarget: 'evt.forecast',
    sortRank: 30,
    evaluatedAt: '2026-09-01',
    visual: { kind: 'band', low: 55, high: 70, goal: 100, caption: 'Registration forecast vs. goal' },
  },
  {
    classification: 'watch',
    area: 'mem',
    title: 'Renewal risk rising',
    sentence: '<b>5 members</b> have not confirmed renewal within 30 days of expiry.',
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
    sentence: '<b>12 organizations</b> match member criteria but haven’t joined.',
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
    linkTarget: 'trn.enrolment',
    sortRank: 70,
    evaluatedAt: '2026-09-01',
  },
];
