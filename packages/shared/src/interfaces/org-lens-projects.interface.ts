// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens — Projects page contracts (LFXV2-1883 / LFXV2-1884).
 *
 * The wire contracts (OrgLensProject, OrgLensProjectsResponse, etc.) are what the API returns;
 * the current implementation is fed by a demo-data fixture through `OrgLensProjectsService`, and the
 * live Snowflake / LFX Insights integration (a separate story) will populate the same shapes without
 * any component changes. The "Client-only view models" section at the bottom is NOT on the wire —
 * it is built in the component and must never be populated from API data.
 */

import { TagSeverity } from './components.interface';

/** Influence band per the markup-mu methodology (Boysel et al.). Declared strongest → weakest. */
export type InfluenceBand = 'leading' | 'contributing' | 'participating' | 'silent' | 'non-lf';

/** CHAOSS-derived project health classification (via LFX Insights). */
export type HealthScore = 'excellent' | 'healthy' | 'at-risk';

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

/** Workspace identifier (`?workspace=`). The default uses a stable slug; user-created workspaces get generated slugs. */
export type OrgProjectsWorkspaceId = string;

/** A saved Org Lens workspace (filter preset). Each company is seeded with the default; users add/rename/delete their own. */
export interface OrgProjectsWorkspace {
  id: OrgProjectsWorkspaceId;
  name: string;
}

/** Sortable Projects-table column keys (`?sort=`). */
export type OrgProjectsSortField = 'name' | 'health' | 'technicalInfluence' | 'ecosystemInfluence' | 'influenceTrend' | 'contributors' | 'participants';

/** Sort direction (`?dir=`). */
export type SortDirection = 'asc' | 'desc';

/*
 * ── Client-only view models (NOT API wire contracts) ─────────────────────────
 * Built in the component off the wire types above; never populated from API data.
 * `trendTooltipHtml` is component-authored markup rendered with `[escape]="false"`,
 * so it must never be sourced from the wire — keep these types out of any API mapping.
 */

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
  technicalBars: OrgProjectsSignalBar[];
  ecosystemBars: OrgProjectsSignalBar[];
  /** Display label for the technical influence band (e.g. "Leading"). */
  technicalBandLabel: string;
  /** Display label for the ecosystem influence band (e.g. "Contributing"). */
  ecosystemBandLabel: string;
  /** Health badge display label (e.g. "Excellent"). */
  healthLabel: string;
  /** Health badge severity token for lfx-tag. */
  healthSeverity: TagSeverity;
  /** Pre-built Chart.js dataset for the sparkline; stable reference avoids re-allocation on recompute. */
  sparklineDataset: { labels: string[]; datasets: { data: number[]; borderColor: string; fill: boolean }[] };
  /** Pre-rendered HTML for the Influence Trend hover tooltip. */
  trendTooltipHtml: string;
  /** Plain-text trend summary for screen readers / keyboard focus. */
  trendAriaLabel: string;
  /** Plain-text health summary (rating + sub-scores) for screen readers / keyboard focus. */
  healthAriaLabel: string;
}
