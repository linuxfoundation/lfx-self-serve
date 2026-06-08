// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens — Projects page contracts (LFXV2-1883 / LFXV2-1884).
 *
 * These are the real API contracts the Projects page renders against. The current
 * implementation is fed by a demo-data fixture through `OrgLensProjectsService`; the
 * live Snowflake / LFX Insights integration (a separate story) will populate the same
 * shapes without any component changes.
 */

/** Influence band per the markup-mu methodology (Boysel et al.). Declared strongest → weakest. */
export type InfluenceBand = 'leading' | 'contributing' | 'participating' | 'non-lf';

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

/** Workspace preset / saved-filter identifier (`?workspace=`). */
export type OrgProjectsWorkspaceId = 'most-active' | 'all-projects' | 'most-influential' | 'where-we-lead';

/** Sortable Projects-table column keys (`?sort=`). */
export type OrgProjectsSortField = 'name' | 'foundation' | 'health' | 'technicalInfluence' | 'ecosystemInfluence' | 'influenceTrend';

/** Sort direction (`?dir=`). */
export type SortDirection = 'asc' | 'desc';

/** Influence Summary pill-tab mode (`?influenceTab=`). */
export type InfluenceSummaryMode = 'influential' | 'gains' | 'decreases';

/** A single Influence Summary card, derived from an `OrgLensProject` for the active mode. */
export interface InfluenceSummaryCard {
  /** The project this card represents. */
  project: OrgLensProject;
  /** Mode-specific primary metric line (e.g. "Influence score: 87.3 (Leading)", "+14.2 points (1y)"). */
  primaryMetric: string;
}
