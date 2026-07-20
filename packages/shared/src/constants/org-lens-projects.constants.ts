// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HealthScore,
  InfluenceBand,
  InfluenceTrendDirection,
  OrgProjectsSortField,
  OrgProjectsWorkspace,
  OrgProjectsWorkspaceId,
  SortDirection,
} from '../interfaces';
import { lfxColors } from './colors.constants';

/** The default workspace for every company: all projects with any activity. */
export const DEFAULT_ORG_PROJECTS_WORKSPACE_ID: OrgProjectsWorkspaceId = 'all-activities';
export const DEFAULT_ORG_PROJECTS_WORKSPACE_NAME = 'All Projects with Activities';
export const ORG_PROJECTS_ALL_FOUNDATIONS_FILTER = 'all';

// Every company starts with only the default workspace; users add/rename/delete their own on top.
export const DEFAULT_ORG_PROJECTS_WORKSPACES: ReadonlyArray<OrgProjectsWorkspace> = [
  { id: DEFAULT_ORG_PROJECTS_WORKSPACE_ID, name: DEFAULT_ORG_PROJECTS_WORKSPACE_NAME, projectSlugs: [] },
];

export const DEFAULT_ALL_ACTIVITIES_PROJECT_LIMIT = 50;

/** Display labels for influence bands. */
export const INFLUENCE_BAND_LABELS: Record<InfluenceBand, string> = {
  leading: 'Leading',
  contributing: 'Contributing',
  participating: 'Participating',
  silent: 'Silent',
  'non-lf': 'Non-LF Project',
};

/** Sparkline / delta color per trend direction (brand scale values; never hard-coded hex). */
export const INFLUENCE_TREND_COLOR: Record<InfluenceTrendDirection, string> = {
  up: lfxColors.emerald[500],
  down: lfxColors.red[500],
  flat: lfxColors.gray[400],
};

export const INFLUENCE_TREND_TEXT_CLASS: Record<InfluenceTrendDirection, string> = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-500',
};

export const INFLUENCE_TREND_ARROW_BADGE_CLASS: Record<InfluenceTrendDirection, string> = {
  up: 'bg-emerald-100 text-emerald-600',
  down: 'bg-red-100 text-red-600',
  flat: 'bg-gray-100 text-gray-500',
};

export const INFLUENCE_TREND_ARROW_ICON: Record<InfluenceTrendDirection, string> = {
  up: 'fa-solid fa-arrow-up text-[9px]',
  down: 'fa-solid fa-arrow-down text-[9px]',
  flat: 'fa-solid fa-minus text-[9px]',
};

/** Sort rank for influence bands (strongest highest); also the number of filled signal bars (0–4). */
export const INFLUENCE_BAND_RANK: Record<InfluenceBand, number> = {
  leading: 4,
  contributing: 3,
  participating: 2,
  silent: 1,
  'non-lf': 0,
};

/** SVG fill class per influence band for the signal-strength bars icon (filled bars = rank; Non-LF has 0 + a slash). */
export const INFLUENCE_BAND_BAR_FILL_CLASS: Record<InfluenceBand, string> = {
  leading: 'fill-emerald-500',
  contributing: 'fill-blue-500',
  participating: 'fill-amber-500',
  silent: 'fill-red-500',
  'non-lf': 'fill-gray-400',
};

/** Lighter fill for the unfilled signal bars — a tint of the band color (per the org dashboard design). */
export const INFLUENCE_BAND_BAR_FILL_CLASS_LIGHT: Record<InfluenceBand, string> = {
  leading: 'fill-emerald-200',
  contributing: 'fill-blue-200',
  participating: 'fill-amber-200',
  silent: 'fill-red-200',
  'non-lf': 'fill-gray-200',
};

/** Display labels for health scores (5 Insights bands + Unavailable). */
export const HEALTH_SCORE_LABELS: Record<HealthScore, string> = {
  excellent: 'Excellent',
  healthy: 'Healthy',
  stable: 'Stable',
  unsteady: 'Unsteady',
  critical: 'Critical',
  unavailable: 'Unavailable',
};

export const HEALTH_SCORE_BADGE: Record<HealthScore, { bg: string; text: string }> = {
  excellent: { bg: lfxColors.emerald[100], text: lfxColors.emerald[700] },
  healthy: { bg: lfxColors.blue[100], text: lfxColors.blue[700] },
  stable: { bg: lfxColors.violet[100], text: lfxColors.violet[700] },
  unsteady: { bg: lfxColors.amber[100], text: lfxColors.amber[700] },
  critical: { bg: lfxColors.red[100], text: lfxColors.red[700] },
  unavailable: { bg: lfxColors.gray[100], text: lfxColors.gray[600] },
};

/** Projects-table page sizes; 25 is the default. */
export const ORG_PROJECTS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

export const DEFAULT_ORG_PROJECTS_PAGE_SIZE = 25;

/** Default Projects-table sort: Contributors descending (tie-break participants desc, then name). */
export const DEFAULT_ORG_PROJECTS_SORT_FIELD: OrgProjectsSortField = 'contributors';

export const DEFAULT_ORG_PROJECTS_SORT_DIR: SortDirection = 'desc';

export const VALID_ORG_PROJECTS_SORT_FIELDS = new Set<OrgProjectsSortField>([
  'name',
  'health',
  'technicalInfluence',
  'ecosystemInfluence',
  'influenceTrend',
  'contributors',
  'participants',
]);

export const DEFAULT_LFX_ONE_PLATINUM_SCHEMA = 'ANALYTICS.PLATINUM_LFX_ONE';
export const ORG_PROJECTS_OUTSIDE_LF_WAREHOUSE_SLUG = '__outside_lf__';
export const ORG_PROJECTS_OUTSIDE_LF_WIRE_SLUG = 'outside-lf';
export const ORG_PROJECTS_SEARCH_MIN_LENGTH = 2;
export const ORG_PROJECTS_SEARCH_LIMIT = 20;
export const ORG_PROJECTS_MEMBER_SERVICE_BULK_ADD_CHUNK_SIZE = 100;
