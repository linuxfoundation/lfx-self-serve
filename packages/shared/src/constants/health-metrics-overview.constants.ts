// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Fixed area order and display metadata for the LFXV2-3365 Overview page. Area keys match the
 * `link_target` prefixes in {@link HEALTH_METRICS_OVERVIEW_LINK_TARGETS} (`eng.*`, `evt.*`, ...).
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
export const HEALTH_METRICS_OVERVIEW_GROUP_ORDER: (keyof typeof HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS)[] = ['act', 'watch', 'opp', 'ok', 'none'];

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
  'trn.enrollment': '/training',
} as const;

/** The one `link_target` that opens externally (LFX Insights) instead of a PCC anchor. */
export const HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET = 'code.insights';

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

/** Fixed 5-tag "Data sources" list in the rail — same tags for every foundation, per `railHTML()`. */
export const HEALTH_METRICS_OVERVIEW_DATA_SOURCES = ['Membership', 'Meetings', 'Events', 'Surveys', 'LFX Insights'] as const;

/** Non-functional visual-only period selector (design's `.per`) — pinned to YTD until a real backend supports re-filtering. */
export const HEALTH_METRICS_OVERVIEW_PERIODS = ['2023', '2024', '2025', 'YTD'] as const;
