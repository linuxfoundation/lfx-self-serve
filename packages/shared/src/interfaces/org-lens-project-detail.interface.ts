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
 * A single Our-Influence metric card, used for both the Technical and Ecosystem groups
 * (Maintainers, Contributors, …, Event Speakers, Certified Individuals, …). Each renders a
 * title, a 12-month trendline, and a descriptive sentence; the sentence is pre-split so the
 * stat renders bold. An empty `sparkline` shows a "No data" state.
 */
export interface OrgLensProjectInfluenceCard {
  key: string;
  label: string;
  /** Source shown above the card for ecosystem metrics (project name or foundation name); null for technical. */
  scopeLabel: string | null;
  /** 12 monthly bins, oldest → newest. Empty array → "No data". */
  sparkline: number[];
  /** Project-wide average monthly series (grey reference line). Same length as sparkline. */
  projectSparkline: number[];
  /** Descriptive sentence split so the middle stat can render bold. */
  caption: { prefix: string; emphasis: string; suffix: string };
}

/** One cell in a card-specific detail table row. Exactly one of `person` or `text` should be set. */
export interface OrgLensCardDetailCell {
  /** Renders as avatar initials + name when set. */
  person?: { name: string; avatarUrl?: string };
  /** Plain text value when not a person cell. */
  text?: string;
}

/** One row in the card-specific data table shown in the influence card detail drawer. */
export interface OrgLensCardDetailRow {
  cells: OrgLensCardDetailCell[];
}

/** Definition row shown at the top of the card detail drawer (mirrors app.lfx.dev format). */
export interface OrgLensCardDefinition {
  /** Plain-text description of what this metric counts or measures. */
  text: string;
  /** Determines the middle column header: 'count' → "Total count for this project"; 'average' → "Average for this project" */
  totalType: 'count' | 'average';
  /** Pre-formatted total or average value, e.g. "78", "1,764", "48.3 days". */
  total: string;
  /** Primary data source label, e.g. "LFX Insights", "LFX". */
  dataSource: string;
}

/** Complete drawer detail section for one influence card: definition row + card-specific data table. */
export interface OrgLensCardDetailSection {
  definition: OrgLensCardDefinition;
  /** Column header labels for the card-specific data table. */
  columns: string[];
  rows: OrgLensCardDetailRow[];
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
  technical: OrgLensProjectInfluenceCard[];
  ecosystem: OrgLensProjectInfluenceCard[];
  trend: OrgLensProjectTrendPoint[];
  /** All organizations contributing to the project; the viewing-org row is always included. */
  leaderboard: OrgLensProjectLeaderboardRow[];
  /** Keyed by card key — drawer definition + card-specific data table for each influence card. */
  cardDetails: Record<string, OrgLensCardDetailSection>;
}

/** Page-level lifecycle state for the Project Detail component. */
export type OrgLensProjectDetailPageState = 'loading' | 'error' | 'notFound' | 'ready';
