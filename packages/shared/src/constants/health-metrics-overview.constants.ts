// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { buildHealthMetricsYearOptions } from './dashboard-metrics.constants';

import type { HealthMetricsYearOption } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsOverviewEngagementLinkSpec, HealthOverviewKpisRow, HealthOverviewRevenueRow } from '../interfaces/health-metrics-overview.interface';

/**
 * Fixed area order and display metadata for the LFXV2-3365 Overview page. Area keys match the
 * `link_target` prefixes (`eng.*`, `evt.*`, ...) in {@link HEALTH_METRICS_OVERVIEW_LINK_TARGETS} and
 * {@link HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS}.
 * Order here is the tile-strip render order — never re-sorted.
 */
export const HEALTH_METRICS_OVERVIEW_AREAS = [
  { key: 'eng', name: 'Engagement', icon: 'fa-light fa-users' },
  { key: 'evt', name: 'Events', icon: 'fa-light fa-calendar' },
  { key: 'mem', name: 'Members', icon: 'fa-light fa-building' },
  { key: 'non', name: 'Non-Members', icon: 'fa-light fa-handshake' },
  { key: 'trn', name: 'Training', icon: 'fa-light fa-graduation-cap' },
  { key: 'code', name: 'Code', icon: 'fa-light fa-code-branch' },
] as const;

/**
 * Urgency classification only — never category or size (logic spec hard constraint). Group name
 * is the fixed findings-list section a classification's rows render under. `icon` matches the
 * design's `TTONE`/group-header icon set 1:1 — the same icon drives both the tile status row and
 * the finding-group heading.
 */
export const HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS = {
  act: {
    label: 'Needs action',
    group: 'Needs action',
    icon: 'fa-light fa-circle-exclamation',
    dotClass: 'bg-red-500',
    accentClass: 'border-l-red-500',
    textClass: 'text-red-600',
  },
  watch: {
    label: 'Needs attention',
    group: 'Needs attention',
    icon: 'fa-light fa-triangle-exclamation',
    dotClass: 'bg-amber-500',
    accentClass: 'border-l-amber-500',
    textClass: 'text-amber-600',
  },
  opp: {
    label: 'Opportunity',
    group: 'Opportunities',
    icon: 'fa-light fa-lightbulb',
    dotClass: 'bg-blue-500',
    accentClass: 'border-l-blue-500',
    textClass: 'text-blue-600',
  },
  ok: {
    label: 'Going well',
    group: 'Going well',
    icon: 'fa-light fa-circle-check',
    dotClass: 'bg-emerald-500',
    accentClass: 'border-l-emerald-500',
    textClass: 'text-emerald-600',
  },
  none: {
    label: 'Awaiting data',
    group: 'Awaiting data',
    icon: 'fa-light fa-circle-info',
    dotClass: 'bg-gray-400',
    accentClass: 'border-l-gray-400',
    textClass: 'text-gray-500',
  },
} as const;

/**
 * Findings-list section order — fixed, always rendered in this sequence; empty groups are hidden.
 * Classification keys (not display-string group labels) so a lookup back to tone/icon never has to
 * reverse a label into a key.
 */
export const HEALTH_METRICS_OVERVIEW_GROUP_ORDER = [
  'act',
  'watch',
  'opp',
  'ok',
  'none',
] as const satisfies readonly (keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS)[];

/**
 * `link_target` → PCC anchor path, joined onto `…/project/{pcc_project_id}/reports/health-metrics`.
 * A one-line map so retiring a link when its Level 2 page ships is a one-line change.
 * `code.insights` is not here — it opens LFX Insights externally via `buildLensAwareInsightsUrl`.
 * Engagement's targets moved to {@link HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS}.
 */
export const HEALTH_METRICS_OVERVIEW_LINK_TARGETS = {
  'evt.forecast': '/events#forecast',
  'mem.atrisk': '/members#at-risk',
  'mem.renewals': '/members#renewals',
  'mem.list': '/members',
  'non.orgs': '/non-members',
  'trn.enrollment': '/training',
} as const;

/**
 * `eng.*` `link_target` → the Engagement section that owns it, plus the section filters to apply on
 * arrival. A filter left `null` is cleared, so a stale cut carried over in the URL cannot hide the
 * responsible entity.
 */
export const HEALTH_METRICS_OVERVIEW_ENGAGEMENT_LINK_TARGETS = {
  'eng.board': { section: 'committees', queryParams: { groupType: 'gov', groupPage: null } },
  'eng.groups': { section: 'committees', queryParams: { groupType: null, groupPage: null } },
  'eng.orgs': { section: 'orgs', queryParams: { orgFilter: null } },
  'eng.participation': { section: 'participation', queryParams: { partMode: null } },
} as const satisfies Record<string, HealthMetricsOverviewEngagementLinkSpec>;

/** The stat value every no-data tile shows; the tile's drill-in link is withheld when it is set. */
export const HEALTH_METRICS_OVERVIEW_NO_DATA_STAT_VALUE = '—';

/** The Engagement tile links to the unfiltered group attendance view, the source of its counts. */
export const HEALTH_METRICS_OVERVIEW_ENGAGEMENT_TILE_LINK_TARGET = 'eng.groups';

/** The one `link_target` that opens externally (LFX Insights) instead of a PCC anchor. */
export const HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET = 'code.insights';

/**
 * Areas `ProjectService.buildHealthOverviewKpiAreaStates` builds from `HEALTH_OVERVIEW_KPIS` columns; the
 * iteration drops any area with no builder (`eng` is built separately from `ENGAGEMENT_GROUP_ATTENDANCE`).
 */
export const HEALTH_METRICS_OVERVIEW_LIVE_KPI_AREAS: ReadonlySet<(typeof HEALTH_METRICS_OVERVIEW_AREAS)[number]['key']> = new Set([
  'eng',
  'evt',
  'trn',
  'mem',
  'non',
  'code',
]);

/**
 * Period-suffixed `HEALTH_OVERVIEW_KPIS` columns, in their aliased uppercase form. `ProjectService`
 * builds the all-periods SELECT list and projects each period's row from this one list, so the alias
 * it emits and the key it later reads can't drift into a silent "no data" render for every period.
 */
export const HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS = [
  'EVENTS_PCT_OF_REGISTRATION_GOAL',
  'EVENTS_STATUS',
  'CERTIFICATIONS_EARNED_COUNT',
  'TRAINING_STATUS',
  'CONTRIBUTORS_COUNT',
] as const satisfies readonly (keyof HealthOverviewKpisRow)[];

/**
 * Period-suffixed `HEALTH_OVERVIEW_REVENUE` columns, in their aliased uppercase form. Same contract as
 * {@link HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS}: `ProjectService` lowercases these for the source column
 * and aliases them per range, so the emitted alias and the key it reads back can't drift.
 */
export const HEALTH_OVERVIEW_REVENUE_PERIOD_COLUMNS = [
  'REVENUE_USD',
  'FOUNDATION_TOTAL_REVENUE_USD',
] as const satisfies readonly (keyof HealthOverviewRevenueRow)[];

/**
 * Rail revenue-stream metadata, keyed to match `railHTML()`'s fixed 3-stream legend. Colors mirror
 * the design's `STREAM_COLOR` map (`#009aff`/`#00bc7d`/`#8e51ff`) — the closest `lfxColors` scales
 * to those hexes are blue/emerald/violet-500, so the rail never hard-codes a hex value.
 */
export const HEALTH_METRICS_OVERVIEW_REVENUE_STREAMS = {
  memberships: { label: 'Memberships', dotClass: 'bg-blue-500' },
  events: { label: 'Events', dotClass: 'bg-emerald-500' },
  training: { label: 'Training', dotClass: 'bg-violet-500' },
} as const;

/** Fixed "Data sources" list in the rail — only the sources the Overview actually reads today. */
export const HEALTH_METRICS_OVERVIEW_DATA_SOURCES = ['Membership', 'Meetings', 'Events', 'LFX Insights'] as const;

/**
 * Period selector (design's `.per`) — the 4 most recent options from {@link buildHealthMetricsYearOptions}
 * (3 completed years + YTD). Dropping the oldest option also keeps this in sync with
 * `HEALTH_OVERVIEW_REVENUE` and `HEALTH_OVERVIEW_KPIS`, which only expose 4 period-suffix columns (no
 * 4th-year-back variant) — `ProjectService` generates its all-periods column list from this very set,
 * so a 5th option here would emit a column neither table has. Call fresh per use, not once at module
 * load, so the labels stay correct across a calendar-year rollover in a long-running SSR process.
 */
export function buildHealthMetricsOverviewPeriods(): HealthMetricsYearOption[] {
  return buildHealthMetricsYearOptions().slice(-4);
}
