// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885) payload contracts.
 *
 * Populated by the Snowflake-backed BFF (`OrgLensProjectDetailService`). Sparklines and
 * trend series are stored on a 36-month axis (oldest → newest); the client slices to the
 * active `?range=` toggle (1y / 2y / all).
 */

import type { ChartData, ChartOptions, ChartType } from 'chart.js';

/** Dimension keyed by each side-by-side leaderboard. */
export type LeaderboardDimension = 'technical' | 'ecosystem';

/** Presentation VM for each influence card — includes chart objects typed for Chart.js. */
export interface InfluenceCardVm {
  key: string;
  title: string;
  scopeLabel: string | null;
  hasData: boolean;
  chartType: ChartType;
  chartData: ChartData<ChartType>;
  chartOptions: ChartOptions<ChartType>;
  valueSuffix: string;
  caption: { prefix: string; emphasis: string; suffix: string };
  statLabel: string;
  testId: string;
}

/** LFX Insights project health classification — the 5 bands of the Insights project Health Score component; drives the hero badge color token. */
export type OrgLensProjectHealth = 'excellent' | 'healthy' | 'stable' | 'unsteady' | 'critical';

/**
 * Precomputed org-influence tier, read straight through from the warehouse level column.
 * Weakest → strongest. "Non-LF" is not a tier here — it is a separate project classification
 * surfaced by each block payload's `isNonLfProject` flag and a null ecosystem level.
 */
export type OrgLensProjectBand = 'silent' | 'participating' | 'contributing' | 'leading';

/** Leaderboard score-type dimension. Reserved for a future toggle — not yet persisted as a URL param. */
export type OrgLensScoreType = 'combined' | 'technical' | 'ecosystem';

/** Leaderboard metric toggle (`?metric=`). Activity Count mode hides the Band column. */
export type OrgLensLeaderboardMetric = 'influence' | 'activity';

/** Time range selector (`?range=`) for the leaderboards tab — affects the stacked trend chart and leaderboard period labels. */
export type OrgLensLeaderboardTimeRange = '1y' | '2y' | 'all';

/** Tab strip ids (URL `?tab=`). */
export type OrgLensProjectDetailTab = 'pd-influence' | 'pd-leaderboards';

/** Left/right hero block — project identity + derived stat tiles. */
export interface OrgLensProjectHero {
  projectName: string;
  description: string;
  /** Project logo URL; empty string falls back to initials. */
  logoUrl: string;
  lfxInsightsUrl: string | null;
  /** Project's earliest commit ever (any author), ISO date. */
  firstCommit: string | null;
  /** Project-level CHAOSS / Insights software-value estimate in USD (not the org's individual return). */
  softwareValueUsd: number | null;
  /** Overall health tier; null when the warehouse has no health score for the project (hero hides the badge). */
  health: OrgLensProjectHealth | null;
  foundationLabel: string;
}

/**
 * A single Our-Influence metric card, used for both the Technical and Ecosystem groups
 * (Maintainers, Contributors, …, Event Speakers, Certified Individuals, …). Each renders a
 * title, a monthly trendline, and a descriptive sentence; the sentence is pre-split so the
 * stat renders bold. An empty `sparkline` shows a "No data" state.
 */
export interface OrgLensProjectInfluenceCard {
  key: string;
  label: string;
  /** Source shown above the card for ecosystem metrics (project name or foundation name); null for technical. */
  scopeLabel: string | null;
  /**
   * Dense monthly bins (up to 36), oldest → newest. Empty array → "No data". Client slices to active
   * range. A `null` bin is a genuine gap (avg-merge-time months with no merged PRs) — not a zero.
   */
  sparkline: (number | null)[];
  /** Project-wide average monthly series (grey reference line). Same length as sparkline. */
  projectSparkline: number[];
  /** Descriptive sentence split so the middle stat can render bold. */
  caption: { prefix: string; emphasis: string; suffix: string };
}

/** One cell in a card-specific detail table row. Exactly one of `person` or `text` should be set. */
export type OrgLensCardDetailCell = { person: { name: string; avatarUrl?: string; initials: string }; text?: never } | { text: string; person?: never };

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
  /** Roster rows; empty in the main response — the drawer pages them in lazily via OrgLensCardRosterPage. */
  rows: OrgLensCardDetailRow[];
}

/** One server-paginated page of a card drawer's roster rows. */
export interface OrgLensCardRosterPage {
  rows: OrgLensCardDetailRow[];
  /** Total roster rows for this card (all pages), for the paginator. */
  total: number;
}

/**
 * One organization row on the project leaderboard. Rank is derived client-side from the active
 * score-type / metric; the influence bands are precomputed in the warehouse and carried on the wire.
 */
export interface OrgLensProjectLeaderboardRow {
  orgName: string;
  /** Org logo URL; empty string falls back to initials. */
  orgLogoUrl: string;
  /** Calculated Influence scores (1 decimal) per score-type. */
  scores: { combined: number; technical: number; ecosystem: number };
  /** Precomputed warehouse influence tiers per score-type; ecosystem is null for non-LF projects (no ecosystem influence). */
  levels: { combined: OrgLensProjectBand; technical: OrgLensProjectBand; ecosystem: OrgLensProjectBand | null };
  /** Raw activity totals for Activity Count mode — contributions feed the technical board, collaborations the ecosystem board. */
  activityCount: {
    contributions: number;
    collaborations: number;
    contributionsPct: number;
    collaborationsPct: number;
  };
  /** Trailing 12-month combined series (fixed window, not range-scoped), oldest → newest. */
  trendSparkline: number[];
  /** 1-year delta as a signed fraction (e.g. 0.12 = +12%). */
  trendDeltaPct: number;
  /** Precomputed warehouse rank for Activity Count mode boards (org-dashboard parity). */
  warehouseRank?: number;
  /** The viewing org's own row — always rendered and visually pinned. */
  isViewingOrg: boolean;
}

/** Dense monthly combined-influence series for one org, oldest → newest. Feeds the stacked Influence Trend chart. */
export interface OrgLensProjectTrendSeries {
  accountId: string;
  orgName: string;
  orgLogoUrl: string;
  combined: number[];
}

/**
 * Lifecycle state for a single Project Detail data-fetching block (LFXV2-1885 UX contract).
 * Each block loads, renders, and fails independently; only the hero block gates the whole page.
 */
export type OrgLensBlockStatus = 'loading' | 'ready' | 'empty' | 'error';

/**
 * B1 Hero block — project identity + stat tiles + the project-level non-LF classification.
 * Range-independent: fetched once per (org, slug). A null hero block is the whole-page not-found.
 */
export interface OrgLensHeroBlock {
  hero: OrgLensProjectHero;
  isNonLfProject: boolean;
}

/** Hero block lifecycle state — the sole page-level gate; a null hero (404) is the whole-page not-found. */
export interface HeroState {
  status: 'loading' | 'ready' | 'notFound' | 'error';
  data: OrgLensHeroBlock | null;
}

/** Generic per-block lifecycle state for the tab-content blocks (B3/B4, B5, B6, B7, B8). */
export interface BlockState<T> {
  status: OrgLensBlockStatus;
  data: T | null;
}

/**
 * B3/B4 Our-Influence block — the Technical + Ecosystem card groups, plus the viewing org's own
 * precomputed influence tiers carried inline so the Our-Influence tab never depends on (or waits
 * for) the leaderboard blocks for its section-title band chips. Range-scoped.
 */
export interface OrgLensInfluenceBlock {
  technical: OrgLensProjectInfluenceCard[];
  ecosystem: OrgLensProjectInfluenceCard[];
  isNonLfProject: boolean;
  /** Viewing org's precomputed tiers for the section-title band chips; null when it has no leaderboard row. */
  levels: { technical: OrgLensProjectBand | null; ecosystem: OrgLensProjectBand | null };
}

/** B6 Influence Trend block — the per-org monthly combined-influence series. Range-scoped (client slices). */
export interface OrgLensTrendBlock {
  trend: OrgLensProjectTrendSeries[];
}

/**
 * B7/B8 Leaderboard block for one dimension (technical or ecosystem). Carries both the Calculated
 * Influence rows and the dimension's Activity Count rows so switching the metric toggle is a
 * client-side slice that never re-fetches. Range-scoped.
 */
export interface OrgLensLeaderboardBlock {
  /** Calculated Influence rows (ranked client-side by this board's dimension). */
  influence: OrgLensProjectLeaderboardRow[];
  /** Activity Count rows for this board's dimension (contributions for technical, collaborations for ecosystem). */
  activity: OrgLensProjectLeaderboardRow[];
  /** Project-level non-LF marker (ecosystem board only surfaces it). */
  isNonLfProject: boolean;
}
