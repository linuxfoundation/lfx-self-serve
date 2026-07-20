// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Influence band per the markup-mu methodology (Boysel et al.). Declared strongest → weakest. */
export type InfluenceBand = 'leading' | 'contributing' | 'participating' | 'silent' | 'non-lf';

/** LFX Insights project health classification — the 5 bands of the Insights project Health Score component, plus `unavailable` when no score exists. */
export type HealthScore = 'excellent' | 'healthy' | 'stable' | 'unsteady' | 'critical' | 'unavailable';

/** Direction of a one-year influence trend, used for color-coding the sparkline + delta. */
export type InfluenceTrendDirection = 'up' | 'down' | 'flat';

/** A person (employee) associated with a project in a maintainer/contributor/participant role. */
export interface OrgLensProjectPerson {
  /** Stable identifier for the person. */
  id: string;
  /** Display name shown on avatar hover. */
  name: string;
  /** Avatar image URL; empty string falls back to initials. */
  avatarUrl: string;
}

/** Foundation a project belongs to (logo + name pill). */
export interface OrgLensProjectFoundation {
  /** URL-safe foundation slug, used by the `?foundation=` filter. */
  slug: string;
  /** Display name (e.g. "CNCF"). */
  name: string;
  /** Foundation logo URL; empty string falls back to a generic glyph. */
  logoUrl: string;
}

/** Rolling one-year influence trend: a sparkline series plus the headline percent delta. */
export interface InfluenceTrend {
  /** Percent change of the combined influence score, rolling 365 vs prior 365. */
  deltaPct: number;
  /** Percent change of the technical influence score, rolling 365 vs prior 365. */
  technicalDeltaPct: number;
  /** Percent change of the ecosystem influence score, rolling 365 vs prior 365. */
  ecosystemDeltaPct: number;
  /** Direction bucket derived from `deltaPct` (drives green/red/neutral styling). */
  direction: InfluenceTrendDirection;
  /** Ordered score samples (oldest → newest) for the sparkline. */
  series: number[];
}

/** The single largest signal contributing to a project's influence delta. */
export interface ChangeDriver {
  /** Human-readable driver label (e.g. "+3 maintainers", "-22% commits"). */
  label: string;
  /** Whether the driver pushed influence up or down. */
  direction: InfluenceTrendDirection;
}

/** A single project row in the Org Lens Projects table. */
export interface OrgLensProject {
  /** URL-safe project slug (links to Project Detail). */
  slug: string;
  /** Display name. */
  name: string;
  /** Project logo URL; empty string falls back to initials. */
  logoUrl: string;
  /** Owning foundation. */
  foundation: OrgLensProjectFoundation;
  /** CHAOSS health classification. */
  health: HealthScore;
  /** Technical influence band. */
  technicalInfluence: InfluenceBand;
  /** Ecosystem influence band. */
  ecosystemInfluence: InfluenceBand;
  /** Current combined influence score (markup-mu). */
  influenceScore: number;
  /** Combined influence score at T-365; `0` means no baseline (excluded from Gains). */
  priorYearScore: number;
  /** One-year influence trend. */
  trend: InfluenceTrend;
  /** Employees with maintainer roles on the project. */
  maintainers: OrgLensProjectPerson[];
  /** Employees with contributor roles on the project. */
  contributors: OrgLensProjectPerson[];
  /** Employees with participant roles on the project. */
  participants: OrgLensProjectPerson[];
  /** Commit count over the trailing 12 months. */
  commits1y: number;
  /** Largest single driver of the influence delta (used by Influence Summary cards). */
  changeDriver: ChangeDriver;
  /** Short project description shown in the health-detail popover. */
  description: string;
  /** CHAOSS-style health sub-scores (0–100) shown in the health-detail popover. */
  healthMetrics: ProjectHealthMetric[];
}

/** A single CHAOSS health sub-score (0–100) shown in the health-detail popover. */
export interface ProjectHealthMetric {
  /** Metric name, e.g. `Contributors`, `Popularity`, `Development`, `Security`. */
  label: string;
  /** Score on a 0–100 scale, rendered as a progress bar. */
  value: number;
}

/** Top-level response for the Org Lens Projects page. */
export interface OrgLensProjectsResponse {
  /** URL-safe org slug, used in the CSV export filename. */
  orgSlug: string;
  /** Display name of the organization. */
  orgName: string;
  /** ISO timestamp of the LFX Insights data build, rendered as the freshness label. */
  dataUpdatedAt: string;
  /** All projects the organization is associated with. */
  projects: OrgLensProject[];
}

export interface OrgLensProjectSearchResult {
  slug: string;
  name: string;
  logoUrl: string;
  foundation: OrgLensProjectFoundation;
}

export interface OrgLensProjectSearchResponse {
  results: OrgLensProjectSearchResult[];
}

export interface AddableProjectOption {
  value: string;
  label: string;
  logoUrl: string;
}

export type OrgProjectsWorkspaceId = string;

export interface OrgProjectsWorkspace {
  id: OrgProjectsWorkspaceId;
  name: string;
  projectSlugs: string[];
}

export interface OrgProjectsWorkspacesResponse {
  workspaces: OrgProjectsWorkspace[];
}

/** Sortable Projects-table column keys (`?sort=`). */
export type OrgProjectsSortField = 'name' | 'health' | 'technicalInfluence' | 'ecosystemInfluence' | 'influenceTrend' | 'contributors' | 'participants';

/** Sort direction (`?dir=`). */
export type SortDirection = 'asc' | 'desc';

export type OrgProjectsAriaSort = 'ascending' | 'descending' | 'none';

export type OrgProjectsEmptyAction = 'addProject' | 'resetFilters' | 'retry';

export interface OrgProjectsEmptyState {
  icon: string;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  ctaIcon?: string;
  action?: OrgProjectsEmptyAction;
}

/** A single rounded bar in the influence signal-strength icon (precomputed for the table view-model). */
export interface OrgProjectsSignalBar {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tailwind `fill-*` class for the bar. */
  colorClass: string;
}

/** Projects-table row: the project plus presentation values precomputed off the template hot path. */
export interface OrgProjectsTableRow extends OrgLensProject {
  insightsUrl: string;
  technicalBars: OrgProjectsSignalBar[];
  ecosystemBars: OrgProjectsSignalBar[];
  /** Display label for the technical influence band (e.g. "Leading"). */
  technicalBandLabel: string;
  /** Display label for the ecosystem influence band (e.g. "Contributing"). */
  ecosystemBandLabel: string;
  /** Health badge display label (e.g. "Excellent"). */
  healthLabel: string;
  healthBadge: { bg: string; text: string };
  /** Pre-built Chart.js dataset for the sparkline; stable reference avoids re-allocation on recompute. */
  sparklineDataset: { labels: string[]; datasets: { data: number[]; borderColor: string; fill: boolean }[] };
  /**
   * Pre-rendered HTML for the Influence Trend hover tooltip.
   * Rendered with `[escape]="false"` — must stay component-authored only; never map from server/API input.
   */
  trendTooltipHtml: string;
  /** Plain-text trend summary for screen readers / keyboard focus. */
  trendAriaLabel: string;
  trendDeltaLabel: string;
  showTrendArrow: boolean;
  trendArrowIcon: string;
  trendDeltaTextClass: string;
  trendArrowBadgeClass: string;
  /** Plain-text health summary (rating + sub-scores) for screen readers / keyboard focus. */
  healthAriaLabel: string;
}

export interface OrgLensProjectRow {
  ACCOUNT_ID: string;
  PROJECT_ID: string;
  PROJECT_SLUG: string;
  PROJECT_NAME: string;
  PROJECT_LOGO_URL: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_NAME: string | null;
  FOUNDATION_LOGO_URL: string | null;
  TECHNICAL_INFLUENCE: string | null;
  ECOSYSTEM_INFLUENCE: string | null;
  INFLUENCE_SCORE: number | null;
  PRIOR_YEAR_SCORE: number | null;
  DELTA_PCT: number | null;
  TECHNICAL_DELTA_PCT: number | null;
  ECOSYSTEM_DELTA_PCT: number | null;
  TREND_DIRECTION: string | null;
  COMBINED_SCORE_SERIES: unknown;
  DBT_RUN_AT: string | Date | null;
  HEALTH_OVERALL_SCORE: number | null;
  HEALTH_CONTRIBUTOR_PERCENTAGE: number | null;
  HEALTH_POPULARITY_PERCENTAGE: number | null;
  HEALTH_DEVELOPMENT_PERCENTAGE: number | null;
  HEALTH_SECURITY_PERCENTAGE: number | null;
  DESCRIPTION: string | null;
}

export interface OrgLensProjectPersonRow {
  PROJECT_SLUG: string;
  PARTICIPANT_ID: string;
  INVOLVEMENT_ROLE: 'maintainer' | 'contributor' | 'participant';
  PARTICIPANT_NAME: string | null;
  PARTICIPANT_AVATAR_URL: string | null;
}

export interface OrgProjectsWorkspaceResource {
  uid?: string;
  id?: string;
  name?: string;
}

export interface OrgProjectsWorkspaceProjectResource {
  b2b_org_workspace_uid?: string;
  project_uid?: string;
  project_slug?: string;
  project_name?: string;
}

export interface OrgProjectsMemberServiceWorkspaceProject {
  project_uid?: string;
  project_slug?: string;
}
