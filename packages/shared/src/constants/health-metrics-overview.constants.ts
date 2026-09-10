// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  'trn.enrollment': '/training',
} as const;

/** The one `link_target` that opens externally (LFX Insights) instead of a PCC anchor. */
export const HEALTH_METRICS_OVERVIEW_INSIGHTS_LINK_TARGET = 'code.insights';
