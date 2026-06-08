// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FilterPillOption,
  HealthScore,
  InfluenceBand,
  InfluenceSummaryMode,
  InfluenceTrendDirection,
  OrgProjectsSortField,
  OrgProjectsWorkspaceId,
  SortDirection,
  TagSeverity,
} from '../interfaces';
import { lfxColors } from './colors.constants';

/** Workspace presets shown in the Workspace select (`?workspace=`). `most-active` is the default. */
export const ORG_PROJECTS_WORKSPACE_OPTIONS: ReadonlyArray<{ label: string; value: OrgProjectsWorkspaceId }> = [
  { label: 'Most Active Projects', value: 'most-active' },
  { label: 'All Projects', value: 'all-projects' },
  { label: 'Most Influential', value: 'most-influential' },
  { label: 'Where We Lead', value: 'where-we-lead' },
];

export const DEFAULT_ORG_PROJECTS_WORKSPACE_ID: OrgProjectsWorkspaceId = 'most-active';

export const VALID_ORG_PROJECTS_WORKSPACE_IDS = new Set<OrgProjectsWorkspaceId>(['most-active', 'all-projects', 'most-influential', 'where-we-lead']);

/** Influence Summary pill tabs (`?influenceTab=`). `influential` is the default. */
export const ORG_PROJECTS_INFLUENCE_TABS: ReadonlyArray<FilterPillOption & { id: InfluenceSummaryMode }> = [
  { id: 'influential', label: 'Most Influential' },
  { id: 'gains', label: 'Most Gains in Influence' },
  { id: 'decreases', label: 'Most Decreases in Influence' },
];

export const DEFAULT_INFLUENCE_SUMMARY_MODE: InfluenceSummaryMode = 'influential';

export const VALID_INFLUENCE_SUMMARY_MODES = new Set<InfluenceSummaryMode>(['influential', 'gains', 'decreases']);

/** Number of cards rendered per Influence Summary mode. */
export const INFLUENCE_SUMMARY_CARD_COUNT = 3;

/** Display labels for influence bands. */
export const INFLUENCE_BAND_LABELS: Record<InfluenceBand, string> = {
  leading: 'Leading',
  contributing: 'Contributing',
  participating: 'Participating',
  'non-lf': 'Non-LF',
};

/** Tag/badge severity per influence band (drives band-chip color). */
export const INFLUENCE_BAND_SEVERITY: Record<InfluenceBand, TagSeverity> = {
  leading: 'success',
  contributing: 'info',
  participating: 'warn',
  'non-lf': 'secondary',
};

/** Sparkline / delta color per trend direction (brand scale values; never hard-coded hex). */
export const INFLUENCE_TREND_COLOR: Record<InfluenceTrendDirection, string> = {
  up: lfxColors.emerald[500],
  down: lfxColors.red[500],
  flat: lfxColors.gray[400],
};

/** Sort rank for influence bands (strongest highest), used for the table tie-break. */
export const INFLUENCE_BAND_RANK: Record<InfluenceBand, number> = {
  leading: 3,
  contributing: 2,
  participating: 1,
  'non-lf': 0,
};

/** Display labels for health scores. */
export const HEALTH_SCORE_LABELS: Record<HealthScore, string> = {
  excellent: 'Excellent',
  healthy: 'Healthy',
  'at-risk': 'At Risk',
};

/** Tag/badge severity per health score (drives health-badge color). */
export const HEALTH_SCORE_SEVERITY: Record<HealthScore, TagSeverity> = {
  excellent: 'success',
  healthy: 'info',
  'at-risk': 'danger',
};

/** Projects-table page sizes; 25 is the default. */
export const ORG_PROJECTS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

export const DEFAULT_ORG_PROJECTS_PAGE_SIZE = 25;

/** Default Projects-table sort: Influence Trend, descending. */
export const DEFAULT_ORG_PROJECTS_SORT_FIELD: OrgProjectsSortField = 'influenceTrend';

export const DEFAULT_ORG_PROJECTS_SORT_DIR: SortDirection = 'desc';

export const VALID_ORG_PROJECTS_SORT_FIELDS = new Set<OrgProjectsSortField>([
  'name',
  'foundation',
  'health',
  'technicalInfluence',
  'ecosystemInfluence',
  'influenceTrend',
]);

/** Maximum avatars shown in a table avatar stack before collapsing into a `+N` chip. */
export const ORG_PROJECTS_AVATAR_STACK_LIMIT = 4;
