// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885) payload contracts.
 *
 * This story is served from demo company fixtures through `OrgLensProjectDetailService`;
 * the live Snowflake / LFX Insights integration (a separate story) will populate the same
 * shapes without any component changes. The contracts are self-contained so the page can
 * ship independently of the sibling Projects page (LFXV2-1883 / LFXV2-1884).
 */

/** CHAOSS-derived project health classification — drives the hero badge color token. */
export type OrgLensProjectHealth = 'excellent' | 'healthy' | 'at-risk';

/** Leaderboard band per the markup-mu methodology (Boysel et al.). Strongest → weakest. */
export type OrgLensProjectBand = 'leading' | 'contributing' | 'participating' | 'non-lf';

/** Leaderboard score-type segmented control (`?score=`). */
export type OrgLensScoreType = 'combined' | 'technical' | 'ecosystem';

/** Leaderboard metric toggle (`?metric=`). Activity Count mode hides the Trend + Band columns. */
export type OrgLensLeaderboardMetric = 'influence' | 'activity';

/** Tab strip ids (URL `?tab=`). */
export type OrgLensProjectDetailTab = 'pd-influence' | 'pd-leaderboards';

/** Left/right hero block — project identity + derived stat tiles. */
export interface OrgLensProjectHero {
  projectName: string;
  description: string;
  /** Project logo URL; empty string falls back to initials. */
  logoUrl: string;
  /** External source link target (e.g. the project's GitHub / homepage). */
  sourceUrl: string | null;
  /** Human label for the source link (e.g. "Kubernetes - Production-grade container orchestration"). */
  sourceLabel: string | null;
  lfxInsightsUrl: string | null;
  /** Project's earliest commit ever (any author), ISO date. */
  firstCommit: string | null;
  /** Project-level CHAOSS / Insights software-value estimate in USD (not the org's individual return). */
  softwareValueUsd: number | null;
  health: OrgLensProjectHealth;
  foundationLabel: string;
  /** Last-updated timestamp, ISO. */
  lastUpdated: string;
}

/**
 * Technical-group card (Maintainers / Contributors / Commit Activities / Pull Requests).
 * `% of all` = orgCount / projectTotal over a rolling 365-day window.
 */
export interface OrgLensProjectTechnicalCard {
  key: 'maintainers' | 'contributors' | 'commits' | 'pull-requests';
  label: string;
  orgCount: number;
  projectTotal: number;
  /** 0..1 share of the project total attributable to org-affiliated authors. */
  pct: number;
  /** 12 monthly bins, oldest → newest. */
  sparkline: number[];
}

/**
 * Ecosystem-group card (Collaboration Activity / Meeting Attendance / Board Members /
 * Committee Members). Board/committee are foundation-level point-in-time seats; collaboration
 * and meetings are project-level. An empty `sparkline` renders a "No data" state.
 */
export interface OrgLensProjectEcosystemCard {
  key: 'collaboration' | 'meeting-attendance' | 'board-members' | 'committee-members';
  label: string;
  count: number;
  /** 0..1 "% of all" share, where applicable (collaboration, committee members); 0 otherwise. */
  pct: number;
  /** 12 monthly bins, oldest → newest. Empty array → no trendline data available. */
  sparkline: number[];
}

/** One monthly point on the Influence Trend chart. */
export interface OrgLensProjectTrendPoint {
  /** Year-month bin, e.g. "2025-07". */
  month: string;
  combined: number;
  technical: number;
  ecosystem: number;
}

/**
 * One organization row on the project leaderboard. Rank and band are derived client-side
 * from the active score-type / metric, so they are not carried on the wire.
 */
export interface OrgLensProjectLeaderboardRow {
  orgName: string;
  /** Org logo URL; empty string falls back to initials. */
  orgLogoUrl: string;
  /** Calculated Influence scores (markup-mu, 1 decimal) per score-type. */
  scores: { combined: number; technical: number; ecosystem: number };
  /** Raw activity count for Activity Count mode (whole number). */
  activityCount: number;
  /** 12-month trend sparkline, oldest → newest. */
  trendSparkline: number[];
  /** 1-year delta as a signed fraction (e.g. 0.12 = +12%). */
  trendDeltaPct: number;
  /** The viewing org's own row — always rendered and visually pinned. */
  isViewingOrg: boolean;
}

/** Full Project Detail payload. `accountId` + `projectSlug` echo the request envelope. */
export interface OrgLensProjectDetailResponse {
  accountId: string;
  projectSlug: string;
  hero: OrgLensProjectHero;
  technical: OrgLensProjectTechnicalCard[];
  ecosystem: OrgLensProjectEcosystemCard[];
  trend: OrgLensProjectTrendPoint[];
  /** All organizations contributing to the project; the viewing-org row is always included. */
  leaderboard: OrgLensProjectLeaderboardRow[];
}

/** Page-level lifecycle state for the Project Detail component. */
export type OrgLensProjectDetailPageState = 'loading' | 'error' | 'notFound' | 'ready';
