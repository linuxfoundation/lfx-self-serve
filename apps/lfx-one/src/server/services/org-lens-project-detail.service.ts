// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA,
  ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS,
  PD_HEALTH_TAG,
  PD_TIME_RANGE_MONTHS,
  PD_TIME_RANGE_TYPE,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  OrgLeaderboardDetailBreakdown,
  OrgLeaderboardDetailCategoryFigure,
  OrgLeaderboardDetailLevel,
  OrgLensCardDetailCell,
  OrgLensCardDetailRow,
  OrgLensCardDetailSection,
  OrgLensCardRosterPage,
  OrgLensHeroBlock,
  OrgLensInfluenceBlock,
  OrgLensLeaderboardMetric,
  OrgLensLeaderboardPage,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectHealth,
  OrgLensProjectHero,
  OrgLensProjectInfluenceCard,
  OrgLensProjectLeaderboardRow,
  OrgLensProjectTrendSeries,
  OrgLensTrendBlock,
} from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, classifyHealthScore, normalizeHealthScoreCategoryV2 } from '@lfx-one/shared/utils';

import { toIsoDate } from '../helpers/date-format.helper';
import { escapeSqlLikePattern } from '../helpers/validation.helper';
import { buildOrgCacheKey, valkeyService } from './valkey.service';
import { SnowflakeService } from './snowflake.service';

interface HeroRow {
  PROJECT_NAME: string;
  PROJECT_SLUG: string;
  PROJECT_LOGO_URL: string | null;
  FOUNDATION_NAME: string | null;
  IS_LF_PROJECT: boolean | null;
  DESCRIPTION: string | null;
  HEALTH_OVERALL_SCORE_V2: number | null;
  HEALTH_SCORE_CATEGORY_V2: string | null;
  COVERED_CATEGORY_COUNT_V2: number | null;
  HEALTH_MAX_SCORE_V2: number | null;
  SOFTWARE_VALUE: number | null;
  FIRST_COMMIT_TS: Date | string | null;
}

interface CardsRow {
  TECH_MAINTAINERS_COUNT: number | null;
  TECH_CONTRIBUTORS_PCT: number | null;
  TECH_COMMITS_PCT: number | null;
  TECH_PR_OPENED_PCT: number | null;
  TECH_AVG_MERGE_TIME_SPEED_PCT: number | null;
  TECH_AVG_MERGE_TIME_SPEED_CATEGORY: string | null;
  ECO_COLLABORATION_PCT: number | null;
  ECO_MEETING_ATTENDANCE_COUNT: number | null;
  ECO_BOARD_MEMBERS_COUNT: number | null;
  ECO_COMMITTEE_MEMBERS_PCT: number | null;
  ECO_EVENT_ATTENDANCE_PCT: number | null;
  ECO_EVENT_SPEAKERS_PCT: number | null;
  ECO_EVENT_SPONSORSHIPS_PCT: number | null;
  ECO_MEETUP_ATTENDANCE_PCT: number | null;
  ECO_CERTIFIED_INDIVIDUALS_PCT: number | null;
  // Project-wide totals for the card-detail drawer "Total/Average for this project" line (DN9).
  // Read straight from the same range-scoped _tr models the headlines read — no re-derivation.
  TECH_MAINTAINERS_TOTAL: number | null;
  TECH_CONTRIBUTORS_TOTAL: number | null;
  TECH_COMMITS_TOTAL: number | null;
  TECH_PR_OPENED_TOTAL: number | null;
  TECH_AVG_MERGE_TIME_SECONDS: number | null;
  ECO_COLLABORATION_TOTAL: number | null;
  ECO_MEETING_ATTENDANCE_TOTAL: number | null;
  ECO_BOARD_MEMBERS_TOTAL: number | null;
  ECO_COMMITTEE_MEMBERS_TOTAL: number | null;
  ECO_EVENT_ATTENDANCE_TOTAL: number | null;
  ECO_EVENT_SPEAKERS_TOTAL: number | null;
  ECO_EVENT_SPONSORSHIPS_TOTAL: number | null;
  ECO_MEETUP_ATTENDANCE_TOTAL: number | null;
  ECO_CERTIFIED_INDIVIDUALS_TOTAL: number | null;
}

interface TrendRow {
  ACCOUNT_ID: string | null;
  ORG_NAME: string | null;
  ORG_LOGO_URL: string | null;
  SPAN_MONTH: Date | string | null;
  COMBINED_INFLUENCE_SCORE: number | null;
}

interface SparkRow {
  METRIC_KEY: string | null;
  SPAN_MONTH: Date | string | null;
  ORG_VALUE: number | null;
  PROJECT_VALUE: number | null;
}

/** One (account, bucket) combined-influence row from the lifetime-bucketed trend read model (`all`). */
interface TrendLifetimeRow {
  ACCOUNT_ID: string | null;
  ORG_NAME: string | null;
  ORG_LOGO_URL: string | null;
  BUCKET_INDEX: number | null;
  COMBINED_INFLUENCE_SCORE: number | null;
}

/** One (metric, bucket) sparkline row from the lifetime-bucketed sparkline read model (`all`). */
interface SparkLifetimeRow {
  METRIC_KEY: string | null;
  BUCKET_INDEX: number | null;
  ORG_VALUE: number | null;
  PROJECT_VALUE: number | null;
}

/** One bucket on a project's shared adaptive lifetime axis (from the bucket spine), oldest → newest. */
interface BucketAxisRow {
  BUCKET_INDEX: number | null;
  BUCKET_GRANULARITY: string | null;
  BUCKET_START: Date | string | null;
  BUCKET_END: Date | string | null;
}

/** A card-sparkline source bundle: the per-card value index, its axis keys, and (all-time only) axis labels. */
interface SparklineData {
  index: SparklineIndex;
  /** Axis keys the dense series map over — trailing year-months (1y/2y) or bucket-index strings (`all`). */
  axis: string[];
  /** Variable adaptive-bucket axis labels, one per point; present only for `all` (absent for 1y/2y). */
  periods?: string[];
}

interface PlatformsRow {
  CONTRIBUTOR_PLATFORMS: string | null;
  COMMIT_PLATFORMS: string | null;
  PR_PLATFORMS: string | null;
  MAINTAINER_PLATFORMS: string | null;
}

/** A per-card drawer roster provider (DN9): the wrapper table to page + how to project and map rows. */
interface RosterProvider {
  /** Fully-qualified LFX One wrapper table (already schema-resolved). */
  table: string;
  /** Column projection for the page query. */
  select: string;
  /** Optional extra predicate ANDed after the (account, slug) filter — a constant, never user input. */
  where?: string;
  /** Stable ORDER BY for deterministic pagination. */
  orderBy: string;
  /** Map one fetched row to its drawer cells. */
  map: (row: Record<string, unknown>) => OrgLensCardDetailRow;
}

/**
 * Static per-card drawer definition metadata (copy carried over from the shipped card detail
 * drawer). `totalField` names the project-wide total column on the cards row for the active range
 * (read straight through — org-dashboard parity, no monthly re-derivation); 'average' totals are
 * seconds and rendered as a duration.
 */
/** Keys of CardsRow whose value is numeric — the only columns valid as a drawer total field. */
type NumericCardsField = {
  [K in keyof CardsRow]-?: NonNullable<CardsRow[K]> extends number ? K : never;
}[keyof CardsRow];

interface CardDefMeta {
  text: string;
  totalType: 'count' | 'average';
  columns: string[];
  /** Project-wide total column on the cards row (active-range value) for the drawer total line. */
  totalField: NumericCardsField;
  /** Static source label for the 9 ecosystem cards; technical cards derive it from the platforms model. */
  ecoDataSource?: string;
  /** Platforms-row column for the 5 technical cards' data-source line. */
  platformField?: keyof PlatformsRow;
}

/** Per-card monthly lookups (year-month → value) for the viewing org and the whole project. */
interface SparkEntry {
  // org holds null for avg-merge-time months with no merged PRs (a gap, not an instant merge).
  org: Map<string, number | null>;
  project: Map<string, number>;
}
type SparklineIndex = Map<string, SparkEntry>;

/** One org's monthly combined series, oldest → newest, plus display identity. */
interface TrendSeries {
  accountId: string;
  orgName: string;
  orgLogoUrl: string;
  combined: number[];
}

interface ActivityBoardRow {
  BOARD_TYPE: string;
  ORG_ORGANIZATION_ID: string | null;
  ORG_ACCOUNT_ID: string | null;
  ORG_NAME: string | null;
  ORG_LOGO_URL: string | null;
  ACTIVITY_TOTAL: number | null;
  ACTIVITY_PCT: number | null;
  RANK: number | null;
}

/**
 * One warehouse column set behind a single drawer category. Only `points` is mandatory: membership
 * tier has no count or denominator at all, because it maps from the tier rather than being scored on
 * participation. The binary awards (maintainers, board members) do carry both — the warehouse omits
 * only their share, so the drawer can still say "3 of 41 maintainers".
 */
interface CategorySource {
  key: string;
  points: string;
  count?: string;
  projectTotal?: string;
  /**
   * Lifetime project-wide total, which distinguishes "the project never runs this" from "nobody from
   * this organization took part". Set only where the warehouse total really is project-scoped: a
   * foundation-wide total cannot tell those two apart on a child project's page.
   */
  allTimeTotal?: string;
}

/**
 * A breakdown row. The identity and dimension-total columns are named; the category columns are read
 * through the per-dimension `CategorySource` map rather than restated here, so adding a category is a
 * one-line change in one place instead of an interface and a query and a mapper.
 */
interface BreakdownRow {
  ACCOUNT_ID: string | null;
  ORGANIZATION_NAME: string | null;
  TECHNICAL_INFLUENCE_SCORE: number | null;
  TECHNICAL_INFLUENCE_LEVEL: string | null;
  ECOSYSTEM_INFLUENCE_SCORE: number | null;
  ECOSYSTEM_INFLUENCE_LEVEL: string | null;
  [column: string]: number | string | null | undefined;
}

interface LeaderboardRow {
  ORG_ORGANIZATION_ID: string | null;
  ORG_ACCOUNT_ID: string | null;
  ORG_NAME: string | null;
  ORG_LOGO_URL: string | null;
  SCORE_COMBINED: number | null;
  SCORE_TECHNICAL: number | null;
  SCORE_ECOSYSTEM: number | null;
  LEVEL_COMBINED: string | null;
  LEVEL_TECHNICAL: string | null;
  LEVEL_ECOSYSTEM: string | null;
  RANK: number | null;
}

/**
 * Server-side data seam for the Org Lens · Project Detail sub-page (LFXV2-1885).
 *
 * Reads the LFX One-owned platinum tables and assembles the wire response. Card sparklines,
 * the influence-trend series, and card-detail drawer definitions are served from dedicated
 * warehouse models; roster tables remain Phase 2/3 and degrade gracefully when empty.
 *
 * The `?range=` toggle selects the warehouse time_range_type, so the card
 * headlines, leaderboard scores, and activity totals all re-scope with it.
 */
export class OrgLensProjectDetailService {
  // Number of individually-named orgs in the stacked trend; every remaining org is folded into a
  // single "All others" band in SQL so the chart still reflects the FULL project-wide influence
  // distribution (a raw top-N truncation would drop the tail and inflate the leaders' normalized
  // shares on projects with many orgs).
  private static readonly trendNamedOrgCap = 10;
  private static readonly trendOthersLabel = 'All others';

  // Score-breakdown drawer categories, in the drawer's display order, mapped to the warehouse columns
  // behind them. Keys match the drawer's category lists; the two must stay the same size as the
  // warehouse's scored-component counts, which a shared-package test asserts.
  private static readonly technicalCategorySources: readonly CategorySource[] = [
    { key: 'maintainer', points: 'MAINTAINERS_POINTS', count: 'MAINTAINERS_COUNT', projectTotal: 'MAINTAINERS_PROJECT_TOTAL' },
    {
      key: 'contributors',
      points: 'CONTRIBUTORS_POINTS',
      count: 'CONTRIBUTORS_COUNT',
      projectTotal: 'CONTRIBUTORS_PROJECT_TOTAL',
    },
    { key: 'commits', points: 'COMMITS_POINTS', count: 'COMMITS_COUNT', projectTotal: 'COMMITS_PROJECT_TOTAL' },
    { key: 'prs', points: 'PRS_OPENED_POINTS', count: 'PRS_OPENED_COUNT', projectTotal: 'PRS_OPENED_PROJECT_TOTAL' },
  ];

  private static readonly ecosystemCategorySources: readonly CategorySource[] = [
    {
      key: 'collab',
      points: 'COLLABORATION_ACTIVITY_POINTS',
      count: 'COLLABORATION_ACTIVITY_COUNT',
      projectTotal: 'COLLABORATION_ACTIVITY_PROJECT_TOTAL',
      allTimeTotal: 'COLLABORATION_ACTIVITY_ALL_TIME_TOTAL',
    },
    {
      key: 'meeting',
      points: 'MEETING_ATTENDANCE_POINTS',
      count: 'MEETING_ATTENDANCE_COUNT',
      projectTotal: 'MEETING_ATTENDANCE_PROJECT_TOTAL',
      allTimeTotal: 'MEETING_ATTENDANCE_ALL_TIME_TOTAL',
    },
    // The seven categories below read *_FOUNDATION_TOTAL rather than *_PROJECT_TOTAL: the warehouse
    // rolls them up per foundation, so on a child project's page the denominator covers the whole
    // foundation and every sibling project shares it. The projectTotal slot is the generic
    // denominator slot for all thirteen categories, not a claim that this one is project-scoped.
    //
    // They deliberately carry no allTimeTotal. That column feeds one client decision — "this project
    // does not run this activity at all" — and a foundation-wide lifetime total cannot support it in
    // either direction: one committee roster of 1,917 is shared by 265 project slugs, so a project
    // with no committees of its own still reads as tracked, while a foundation with an empty roster
    // reads as untracked for every project under it. Committee and board totals are also identical
    // across all three ranges (current-roster snapshots, not histories), so their "lifetime" figure
    // says nothing their range figure does not.
    {
      key: 'event',
      points: 'EVENT_ATTENDANCE_POINTS',
      count: 'EVENT_ATTENDANCE_COUNT',
      projectTotal: 'EVENT_ATTENDANCE_FOUNDATION_TOTAL',
    },
    {
      key: 'committee',
      points: 'COMMITTEE_MEMBERS_POINTS',
      count: 'COMMITTEE_MEMBERS_COUNT',
      projectTotal: 'COMMITTEE_MEMBERS_FOUNDATION_TOTAL',
    },
    {
      key: 'board',
      points: 'BOARD_MEMBERS_POINTS',
      count: 'BOARD_MEMBERS_COUNT',
      projectTotal: 'BOARD_MEMBERS_FOUNDATION_TOTAL',
    },
    {
      key: 'speakers',
      points: 'EVENT_SPEAKERS_POINTS',
      count: 'EVENT_SPEAKERS_COUNT',
      projectTotal: 'EVENT_SPEAKERS_FOUNDATION_TOTAL',
    },
    {
      key: 'meetup',
      points: 'MEETUP_ATTENDANCE_POINTS',
      count: 'MEETUP_ATTENDANCE_COUNT',
      projectTotal: 'MEETUP_ATTENDANCE_FOUNDATION_TOTAL',
    },
    {
      key: 'sponsor',
      points: 'SPONSORSHIP_EVENTS_POINTS',
      count: 'SPONSORSHIP_EVENTS_COUNT',
      projectTotal: 'SPONSORSHIP_EVENTS_FOUNDATION_TOTAL',
    },
    {
      key: 'certified',
      points: 'CERTIFIED_INDIVIDUALS_POINTS',
      count: 'CERTIFIED_INDIVIDUALS_COUNT',
      projectTotal: 'CERTIFIED_INDIVIDUALS_FOUNDATION_TOTAL',
    },
    { key: 'tier', points: 'MEMBERSHIP_TIER_POINTS' },
  ];

  // Sparklines are emitted as a dense, contiguous, current-month-anchored monthly array; the
  // shipped component maps points to a fixed 36-month label axis by position and slices per range.
  private static readonly sparklineMonths = 36;

  // Upper bound on the requested page. Guards against a huge/precision-lost query value overflowing
  // page*size into an unsafe integer OFFSET (which Snowflake rejects → 500); leaderboards never approach it.
  private static readonly maxBoardPage = 100_000;

  // Static drawer definition metadata for the 14 cards (LFXV2-1885 DN9 Phase 1): definition copy,
  // total-column semantics, table headers, project-total aggregation, and the ecosystem cards'
  // static source label. Technical cards' data source is derived from the platforms model per project.
  private static readonly cardDefs: Record<string, CardDefMeta> = {
    // Technical (5) — dataSource derived from the platforms model; total from the gold _tr.
    maintainers: {
      text: 'Individuals granted maintainer status with merge rights and code ownership for this project.',
      totalType: 'count',
      columns: ['Our Contributors', 'Username', 'Maintainer Since'],
      totalField: 'TECH_MAINTAINERS_TOTAL',
      platformField: 'MAINTAINER_PLATFORMS',
    },
    contributors: {
      text: 'Individuals who made at least one contribution (commit, PR, review, or comment) in the selected time range.',
      totalType: 'count',
      columns: ['Our Contributors', 'Username', 'First activity', 'Most recent', '# Contributions'],
      totalField: 'TECH_CONTRIBUTORS_TOTAL',
      platformField: 'CONTRIBUTOR_PLATFORMS',
    },
    commits: {
      text: "Code contributions committed directly to this project's repositories.",
      totalType: 'count',
      columns: ['Repository Group', 'Committer', 'Date', 'Commit'],
      totalField: 'TECH_COMMITS_TOTAL',
      platformField: 'COMMIT_PLATFORMS',
    },
    'pull-requests': {
      text: "Pull requests opened against this project's repositories in the selected time range.",
      totalType: 'count',
      columns: ['Repository Group', 'Committer', 'Date', 'PR Opened'],
      totalField: 'TECH_PR_OPENED_TOTAL',
      platformField: 'PR_PLATFORMS',
    },
    'avg-merge-time': {
      text: "Average time from when a pull request is opened to when it is merged, for your organization's contributors.",
      totalType: 'average',
      columns: ['Repo', 'Our Contributors', 'PR Name', 'Date', 'Merge Time'],
      totalField: 'TECH_AVG_MERGE_TIME_SECONDS',
      platformField: 'PR_PLATFORMS',
    },
    // Ecosystem (9) — static source labels; total from the ecosystem _tr.
    collaboration: {
      text: 'Interactions across collaboration platforms including Slack, mailing lists, GitHub Issues, Jira, and community forums.',
      totalType: 'count',
      columns: ['Source', 'Our Collaborators', 'Location', 'Count', 'Most recent'],
      totalField: 'ECO_COLLABORATION_TOTAL',
      ecoDataSource: 'Confluence, Jira, GitHub, GitLab, Groups.io, Slack, Discord, Discourse',
    },
    'meeting-attendance': {
      text: 'Attendance at project committee, working group, and community meetings.',
      totalType: 'count',
      columns: ['Our meeting attendees', 'Meeting type', 'Meeting date'],
      totalField: 'ECO_MEETING_ATTENDANCE_TOTAL',
      ecoDataSource: 'LFX',
    },
    'board-members': {
      text: "Seat on the governing board of the project's foundation.",
      totalType: 'count',
      columns: ['Our board members', 'Added to board', 'Granted seat by'],
      totalField: 'ECO_BOARD_MEMBERS_TOTAL',
      ecoDataSource: 'LFX',
    },
    'committee-members': {
      text: 'Individual who is on a foundation committee, such as advisory groups, steering committees, and marketing committees.',
      totalType: 'count',
      columns: ['Our committee members', 'Committee', 'Date joined'],
      totalField: 'ECO_COMMITTEE_MEMBERS_TOTAL',
      ecoDataSource: 'LFX',
    },
    'event-attendance': {
      text: "Registration and attendance at events hosted or co-located with this project's foundation.",
      totalType: 'count',
      columns: ['Our attendees', 'Event name', 'Date', 'Location'],
      totalField: 'ECO_EVENT_ATTENDANCE_TOTAL',
      ecoDataSource: 'LFX',
    },
    'event-speakers': {
      text: 'Employees who presented talks, workshops, or keynotes at foundation-hosted events.',
      totalType: 'count',
      columns: ['Our speakers', 'Event name', 'Talk title', 'Date'],
      totalField: 'ECO_EVENT_SPEAKERS_TOTAL',
      ecoDataSource: 'LFX',
    },
    'event-sponsorships': {
      text: 'Events where your organization sponsored, co-sponsored, or provided in-kind support.',
      totalType: 'count',
      columns: ['Event name', 'Date', 'Sponsorship level', 'Reach'],
      totalField: 'ECO_EVENT_SPONSORSHIPS_TOTAL',
      ecoDataSource: 'LFX',
    },
    'meetup-attendance': {
      text: "Attendance at community meetups organized under this project's foundation.",
      totalType: 'count',
      columns: ['Our attendees', 'Meetup name', 'Date', 'Location'],
      totalField: 'ECO_MEETUP_ATTENDANCE_TOTAL',
      ecoDataSource: 'Bevy, Regfox',
    },
    'certified-individuals': {
      text: "Employees who hold active certifications issued or recognized by this project's foundation.",
      totalType: 'count',
      columns: ['Our individuals', 'Certification name', 'Date issued'],
      totalField: 'ECO_CERTIFIED_INDIVIDUALS_TOTAL',
      ecoDataSource: 'LF Education',
    },
  };

  // Short month names for adaptive-bucket axis labels (e.g. monthly bucket → "Jan 2016").
  private static readonly shortMonths: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Re-capitalize lowercase warehouse platform tokens for display.
  private static readonly platformLabels: Record<string, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    gerrit: 'Gerrit',
    git: 'Git',
    bitbucket: 'Bitbucket',
    confluence: 'Confluence',
    jira: 'Jira',
    slack: 'Slack',
    discord: 'Discord',
    discourse: 'Discourse',
    groupsio: 'Groups.io',
    'groups.io': 'Groups.io',
  };

  private readonly snowflakeService = SnowflakeService.getInstance();

  /** One server-paginated page of a card's drawer roster (DN9); rows page in on demand, never in the main payload. */
  public async getCardRoster(
    orgUid: string,
    orgName: string,
    projectSlug: string,
    cardKey: string,
    range: OrgLensLeaderboardTimeRange,
    page: number,
    pageSize: number
  ): Promise<OrgLensCardRosterPage> {
    const provider = this.rosterProvider(cardKey);
    if (provider === null) return { rows: [], total: 0 };

    const slug = projectSlug.trim().toLowerCase();
    const safeSize = Math.min(Math.max(Math.trunc(pageSize) || 0, 1), 100);
    const safePage = Math.max(Math.trunc(page) || 0, 0);
    const offset = safePage * safeSize;

    const cacheKey = `project-detail-roster:${this.paramSignature([slug, cardKey, range, safePage, safeSize])}`;
    const key = buildOrgCacheKey(orgUid, cacheKey);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensCardRosterPage>(key, OrgLensProjectDetailService.isRosterPage);
      if (cached !== null) return cached;
    }

    const whereExtra = provider.where ? ` AND ${provider.where}` : '';
    let result: OrgLensCardRosterPage;
    let degradedMissingObject = false;
    try {
      const [pageResult, countResult] = await Promise.all([
        this.snowflakeService.execute<Record<string, unknown>>(
          `SELECT ${provider.select} FROM ${provider.table} WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ?${whereExtra} ORDER BY ${provider.orderBy} LIMIT ${safeSize} OFFSET ${offset}`,
          [orgUid, slug],
          { expectMissingObject: true }
        ),
        this.snowflakeService.execute<{ N: number }>(
          `SELECT COUNT(*) AS N FROM ${provider.table} WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ?${whereExtra}`,
          [orgUid, slug],
          { expectMissingObject: true }
        ),
      ]);
      result = {
        rows: pageResult.rows.map((row) => provider.map(row)),
        total: this.num(countResult.rows[0]?.N ?? 0),
      };
    } catch (error) {
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      degradedMissingObject = true;
      result = { rows: [], total: 0 };
    }
    if (key !== null && !degradedMissingObject) {
      await valkeyService.setJson(key, result, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return result;
  }

  public async getHeroBlock(orgUid: string, projectSlug: string): Promise<OrgLensHeroBlock | null> {
    const slug = projectSlug.trim().toLowerCase();
    const key = buildOrgCacheKey(orgUid, `project-detail-hero:${this.paramSignature([slug])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensHeroBlock>(key, OrgLensProjectDetailService.isHeroBlock);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;

    const block: OrgLensHeroBlock = {
      hero: this.mapHero(heroRow, slug, heroRow.FOUNDATION_NAME ?? 'Outside LF'),
      isNonLfProject: heroRow.IS_LF_PROJECT !== true,
    };
    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  public async getInfluenceBlock(orgUid: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Promise<OrgLensInfluenceBlock | null> {
    const slug = projectSlug.trim().toLowerCase();
    const timeRangeType = PD_TIME_RANGE_TYPE[range];
    const key = buildOrgCacheKey(orgUid, `project-detail-influence:${this.paramSignature([slug, range])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensInfluenceBlock>(
        key,
        (value) => OrgLensProjectDetailService.isInfluenceBlock(value) && (range !== 'all' || OrgLensProjectDetailService.hasAdaptivePeriods(value))
      );
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;
    const isNonLf = heroRow.IS_LF_PROJECT !== true;
    const foundationLabel = heroRow.FOUNDATION_NAME ?? 'Outside LF';

    // 1y/2y read the trailing monthly sparkline model and slice client-side over a fixed month axis;
    // `all` reads the adaptive lifetime-bucketed model and carries its own variable `periods[]` axis
    // (LFXV2-2867 D9) — the same shared bucket axis the trend chart uses (D7).
    const [cardRows, viewing, sparkData] = await Promise.all([
      this.fetchCards(orgUid, slug, timeRangeType),
      // Only the viewing org's own row is needed here (for the section-title band chips), so fetch
      // that single row rather than the whole board — the board itself is now paged separately.
      this.fetchViewingLeaderboardRow(orgUid, slug, timeRangeType).catch(() => null),
      range === 'all' ? this.fetchLifetimeSparklineData(orgUid, slug) : this.fetchMonthlySparklineData(orgUid, slug),
    ]);

    const cards = cardRows[0] ?? null;

    const block: OrgLensInfluenceBlock = {
      technical: this.buildTechnicalCards(cards, sparkData.index, sparkData.axis),
      ecosystem: this.buildEcosystemCards(cards, heroRow.PROJECT_NAME, foundationLabel, isNonLf, sparkData.index, sparkData.axis),
      isNonLfProject: isNonLf,
      levels: {
        technical: viewing ? (this.mapBand(viewing.LEVEL_TECHNICAL) ?? 'silent') : null,
        ecosystem: isNonLf || !viewing ? null : (this.mapBand(viewing.LEVEL_ECOSYSTEM) ?? 'silent'),
      },
      // Only the all-time axis is variable/bucketed; 1y/2y omit `periods` and derive labels client-side.
      // An empty axis must still be emitted as `[]`, or `hasAdaptivePeriods` rejects the block just written.
      ...(sparkData.periods === undefined ? {} : { periods: sparkData.periods }),
    };
    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  public async getTrendBlock(orgUid: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Promise<OrgLensTrendBlock | null> {
    const slug = projectSlug.trim().toLowerCase();
    // The trend is now range-scoped (`all` reads the bucketed lifetime source), so the cache key
    // carries the range — otherwise a 1y/2y series would be served for an all-time request.
    const key = buildOrgCacheKey(orgUid, `project-detail-trend:${this.paramSignature([slug, range])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensTrendBlock>(
        key,
        (value) => OrgLensProjectDetailService.isTrendBlock(value) && (range !== 'all' || OrgLensProjectDetailService.hasAdaptivePeriods(value))
      );
      if (cached !== null) return cached;
    }

    // Gate on the (org, slug) catalog row like every other block, so project-wide trend is not
    // served for a project the org has no activity on (and the 404 stays consistent across blocks).
    // `all`: read the adaptive lifetime-bucketed trend + its shared bucket axis (periods[], D7/D9).
    // 1y/2y: read the trailing recent-monthly trend already range-filtered and top-N folded in SQL.
    let block: OrgLensTrendBlock;
    if (range === 'all') {
      const [heroRow, trendRows, axis] = await Promise.all([this.fetchHeroRow(orgUid, slug), this.fetchTrendLifetime(slug), this.fetchLifetimeAxis(slug)]);
      if (!heroRow) return null;
      block = {
        trend: this.buildTrendSeries(
          this.buildTrendLifetimeByAccount(
            trendRows,
            axis.map((bucket) => bucket.index)
          )
        ),
        periods: axis.map((bucket) => bucket.label),
      };
    } else {
      const [heroRow, trendRows] = await Promise.all([this.fetchHeroRow(orgUid, slug), this.fetchTrend(slug, PD_TIME_RANGE_MONTHS[range])]);
      if (!heroRow) return null;
      block = { trend: this.buildTrendSeries(this.buildTrendByAccount(trendRows)) };
    }

    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  public async getTechnicalBoard(
    orgUid: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange,
    metric: OrgLensLeaderboardMetric,
    page: number,
    pageSize: number,
    search: string
  ): Promise<OrgLensLeaderboardPage | null> {
    return this.fetchBoardPage(orgUid, projectSlug, range, 'technical', metric, page, pageSize, search);
  }

  public async getEcosystemBoard(
    orgUid: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange,
    metric: OrgLensLeaderboardMetric,
    page: number,
    pageSize: number,
    search: string
  ): Promise<OrgLensLeaderboardPage | null> {
    return this.fetchBoardPage(orgUid, projectSlug, range, 'ecosystem', metric, page, pageSize, search);
  }

  public async getCardDrawer(
    orgUid: string,
    projectSlug: string,
    cardKey: string,
    range: OrgLensLeaderboardTimeRange
  ): Promise<OrgLensCardDetailSection | null> {
    const slug = projectSlug.trim().toLowerCase();
    const timeRangeType = PD_TIME_RANGE_TYPE[range];
    const key = buildOrgCacheKey(orgUid, `project-detail-drawer:${this.paramSignature([slug, cardKey, range])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensCardDetailSection>(key, OrgLensProjectDetailService.isCardDetailSection);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;

    const [cardRows, platformRows] = await Promise.all([this.fetchCards(orgUid, slug, timeRangeType), this.fetchPlatforms(slug, timeRangeType)]);
    const section = this.buildCardDetails(cardRows[0] ?? null, platformRows[0] ?? null, heroRow.IS_LF_PROJECT !== true)[cardKey] ?? null;
    if (section !== null && key !== null) {
      await valkeyService.setJson(key, section, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return section;
  }

  /**
   * The clicked leaderboard row's score breakdown for one dimension: every scoring category with the
   * points it contributed, the org's count, and the total that count is measured against — project-wide
   * for some categories and foundation-wide for others, as the category map below records per category.
   *
   * The categories reconcile to `totalScore` because both come from the same warehouse row — the
   * total is read, never summed here, so the drawer cannot disagree with the board that opened it.
   *
   * Categories backed by participation records LFX holds privately are omitted entirely for callers
   * outside the subject organization, and named in `withheldCategories`. They are never zeroed,
   * banded, or rounded: a zero is a claim about the data, absence is not. Belonging is the same
   * account comparison the board uses for its own-row highlight, so the two cannot drift.
   *
   * The route middleware authorizes `:orgUid` only, so the (org, slug) catalog row is checked here
   * for the same reason every other block on this page checks it: a grant on one organization must
   * not read a project that organization has no association with. The ecosystem dimension is 404 for
   * a non-LF project, matching the board it is opened from, which is empty in that case.
   */
  public async getLeaderboardBreakdown(
    orgUid: string,
    projectSlug: string,
    dimension: 'technical' | 'ecosystem',
    organizationId: string,
    range: OrgLensLeaderboardTimeRange
  ): Promise<OrgLeaderboardDetailBreakdown | null> {
    const slug = projectSlug.trim().toLowerCase();
    const timeRangeType = PD_TIME_RANGE_TYPE[range];

    // Read before the warehouse work, as the board does. The key is namespaced by the viewing
    // organization, so an entry can only exist for a caller that already passed the catalog gate
    // below, and own-organization status needs no partition of its own: it is decided by the subject
    // account this key already identifies, so every caller sharing the key shares the visibility.
    const cacheKey = `project-detail-breakdown-${dimension}:${this.paramSignature([slug, range, organizationId])}`;
    const key = buildOrgCacheKey(orgUid, cacheKey);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLeaderboardDetailBreakdown>(key, OrgLensProjectDetailService.isLeaderboardBreakdown);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;
    if (dimension === 'ecosystem' && heroRow.IS_LF_PROJECT !== true) return null;

    const row = await this.fetchBreakdownRow(slug, timeRangeType, organizationId);
    if (row === null) return null;
    const isOwnOrganization = row.ACCOUNT_ID === orgUid;

    const [position, activitySharePercent] = await Promise.all([
      this.fetchBoardPosition(slug, timeRangeType, dimension, organizationId),
      this.fetchActivitySharePercent(slug, timeRangeType, dimension, organizationId),
    ]);

    const withheldCategories = isOwnOrganization ? [] : this.withheldKeysFor(dimension);
    const withheld = new Set(withheldCategories);
    const breakdown: OrgLeaderboardDetailBreakdown = {
      organizationId,
      organizationName: row.ORGANIZATION_NAME ?? '',
      dimension,
      range,
      // Two decimals so the drawer's category points sum to the total it prints. The board rounds the
      // same score to one decimal; the drawer is the surface that has to reconcile, so it carries the
      // finer precision.
      totalScore: this.round2(this.num(dimension === 'technical' ? row.TECHNICAL_INFLUENCE_SCORE : row.ECOSYSTEM_INFLUENCE_SCORE)),
      level: this.mapDetailLevel(dimension === 'technical' ? row.TECHNICAL_INFLUENCE_LEVEL : row.ECOSYSTEM_INFLUENCE_LEVEL),
      rank: position.rank,
      totalOrganizations: position.total,
      ...(activitySharePercent === null ? {} : { activitySharePercent }),
      categories: this.categorySources(dimension)
        .filter((source) => !withheld.has(source.key))
        .map((source) => this.mapCategoryFigure(source, row)),
      withheldCategories,
    };

    if (key !== null) {
      await valkeyService.setJson(key, breakdown, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return breakdown;
  }

  /**
   * One server-paginated, server-searched page of a leaderboard board for one dimension
   * (technical / ecosystem) and metric (Calculated Influence / Activity Count). Ranking and paging
   * happen in SQL over the FULL org set (no top-N cap); the viewing org is flagged per row and lands
   * at its true rank on whatever page it falls (no top-pinning). A missing (org, slug) catalog row is
   * the page-level 404 gate, consistent with every other block.
   */
  private async fetchBoardPage(
    orgUid: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange,
    dimension: 'technical' | 'ecosystem',
    metric: OrgLensLeaderboardMetric,
    page: number,
    pageSize: number,
    search: string
  ): Promise<OrgLensLeaderboardPage | null> {
    const slug = projectSlug.trim().toLowerCase();
    const timeRangeType = PD_TIME_RANGE_TYPE[range];
    const safeSize = Math.min(Math.max(Math.trunc(pageSize) || 0, 1), 100);
    const safePage = Math.min(Math.max(Math.trunc(page) || 0, 0), OrgLensProjectDetailService.maxBoardPage);
    const offset = safePage * safeSize;
    const term = search.trim();

    const cacheKey = `project-detail-board-${dimension}-${metric}:${this.paramSignature([slug, range, safePage, safeSize, term.toLowerCase()])}`;
    const key = buildOrgCacheKey(orgUid, cacheKey);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensLeaderboardPage>(key, OrgLensProjectDetailService.isLeaderboardPage);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;
    const isNonLf = heroRow.IS_LF_PROJECT !== true;

    let block: OrgLensLeaderboardPage;
    // Non-LF projects have no ecosystem influence, so this board is empty. The server is authoritative:
    // the client renders the "Non-LF" marker only and no longer guards this itself.
    if (dimension === 'ecosystem' && metric === 'influence' && isNonLf) {
      block = { rows: [], total: 0, isNonLfProject: isNonLf };
    } else {
      const { rows, total } =
        metric === 'activity'
          ? await this.fetchActivityBoardPage(slug, timeRangeType, dimension, orgUid, safeSize, offset, term)
          : await this.fetchInfluenceBoardPage(slug, timeRangeType, dimension, orgUid, isNonLf, safeSize, offset, term);
      block = { rows, total, isNonLfProject: isNonLf };
    }

    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  /**
   * A page of the Calculated Influence board for one dimension. There is no stored per-dimension
   * rank (the warehouse combined RANK is the combined-influence order), so rank is derived here via
   * ROW_NUMBER() over the FULL set ordered by that dimension's score. Search filters rows AFTER
   * ranking, so a matched org keeps its true board rank (e.g. an org ranked #250 stays "#250").
   */
  private async fetchInfluenceBoardPage(
    slug: string,
    timeRangeType: string,
    dimension: 'technical' | 'ecosystem',
    orgUid: string,
    isNonLf: boolean,
    limit: number,
    offset: number,
    search: string
  ): Promise<{ rows: OrgLensProjectLeaderboardRow[]; total: number }> {
    const scoreColumn = dimension === 'technical' ? 'SCORE_TECHNICAL' : 'SCORE_ECOSYSTEM';
    const hasSearch = search.length > 0;
    // Rank + count run over the full ranked org set for this project/time range. The platinum model
    // emits one row per organization (no per-viewer cohort column), so no cohort scoping is applied.
    // ORG_NAME ILIKE is a bound param. Snowflake rejects binds in LIMIT/OFFSET, so the already-clamped
    // integers are interpolated as literals. ESCAPE '!' + escaped term so a user-typed % or _ matches
    // literally (never a wildcard), keeping the page and count predicates consistent with the old
    // client-side literal-substring search.
    const searchClause = hasSearch ? "WHERE ORG_NAME ILIKE ? ESCAPE '!'" : '';
    const baseParams = [slug, timeRangeType];
    const pageParams = hasSearch ? [...baseParams, `%${escapeSqlLikePattern(search)}%`] : baseParams;
    const countParams = pageParams;

    const pageSql = `
      SELECT ORG_ORGANIZATION_ID, ORG_ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, SCORE_COMBINED, SCORE_TECHNICAL, SCORE_ECOSYSTEM,
             LEVEL_COMBINED, LEVEL_TECHNICAL, LEVEL_ECOSYSTEM, DIM_RANK AS RANK
      FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ${scoreColumn} DESC NULLS LAST, ORG_NAME ASC, ORG_ORGANIZATION_ID ASC) AS DIM_RANK
        FROM ${this.leaderboardTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ?
      )
      ${searchClause}
      ORDER BY DIM_RANK
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS N
      FROM ${this.leaderboardTable()}
      WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ?${hasSearch ? " AND ORG_NAME ILIKE ? ESCAPE '!'" : ''}
    `;

    const [pageResult, countResult] = await Promise.all([
      this.snowflakeService.execute<LeaderboardRow>(pageSql, pageParams),
      this.snowflakeService.execute<{ N: number }>(countSql, countParams),
    ]);
    return {
      rows: pageResult.rows.map((row) => this.mapInfluenceRow(row, orgUid, isNonLf)),
      total: this.num(countResult.rows[0]?.N ?? 0),
    };
  }

  /**
   * A page of an Activity Count board for one dimension. The gold-sourced activity model already
   * carries rank / total / percentage over the FULL org set, so this just filters, orders by that
   * precomputed RANK, and pages — no ranking is re-implemented. Search preserves rank as above.
   */
  private async fetchActivityBoardPage(
    slug: string,
    timeRangeType: string,
    dimension: 'technical' | 'ecosystem',
    orgUid: string,
    limit: number,
    offset: number,
    search: string
  ): Promise<{ rows: OrgLensProjectLeaderboardRow[]; total: number }> {
    const boardType = dimension === 'technical' ? 'contributions' : 'collaborations';
    const hasSearch = search.length > 0;
    // Runs over the full ranked org set — the activity model emits one row per organization (no
    // per-viewer cohort column), so no cohort scoping is applied. ORG_NAME ILIKE is bound. Snowflake
    // rejects binds in LIMIT/OFFSET, so the clamped integers are interpolated as literals (see
    // fetchInfluenceBoardPage). ESCAPE '!' + escaped term so a user-typed % or _ matches literally;
    // shared by the page and count predicates so the paginated total can't be inflated by wildcard
    // interpretation.
    const searchClause = hasSearch ? " AND ORG_NAME ILIKE ? ESCAPE '!'" : '';
    const params = hasSearch ? [slug, timeRangeType, boardType, `%${escapeSqlLikePattern(search)}%`] : [slug, timeRangeType, boardType];
    const pageParams = params;

    const pageSql = `
      SELECT BOARD_TYPE, ORG_ORGANIZATION_ID, ORG_ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, ACTIVITY_TOTAL, ACTIVITY_PCT, RANK
      FROM ${this.activityLeaderboardsTable()}
      WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND BOARD_TYPE = ?${searchClause}
      -- RANK and ORG_ACCOUNT_ID are both nullable, so they are not a total order for OFFSET paging.
      -- ORG_ORGANIZATION_ID is the activity model's unique per-row grain key (its own rank tie-break),
      -- so it guarantees a stable order — page boundaries can't skip or duplicate rows.
      ORDER BY RANK ASC NULLS LAST, ORG_ORGANIZATION_ID ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) AS N
      FROM ${this.activityLeaderboardsTable()}
      WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND BOARD_TYPE = ?${searchClause}
    `;

    const [pageResult, countResult] = await Promise.all([
      this.snowflakeService.execute<ActivityBoardRow>(pageSql, pageParams),
      this.snowflakeService.execute<{ N: number }>(countSql, params),
    ]);
    return {
      rows: pageResult.rows.map((row) => this.mapActivityRow(row, dimension, orgUid)),
      total: this.num(countResult.rows[0]?.N ?? 0),
    };
  }

  /**
   * The single breakdown row behind a clicked leaderboard row. Only the identity columns, the two
   * dimension totals, and the requested dimension's category columns are selected — the column list
   * comes from the same per-dimension map the mapping reads, so a column can't be selected without
   * being mapped or mapped without being selected.
   *
   * The table is absent until the warehouse model is deployed, which is treated as "no breakdown"
   * rather than a 500 so the drawer degrades to its empty state during the deploy window.
   */
  private async fetchBreakdownRow(slug: string, timeRangeType: string, organizationId: string): Promise<BreakdownRow | null> {
    const columns = [
      'ACCOUNT_ID',
      'ORGANIZATION_NAME',
      'TECHNICAL_INFLUENCE_SCORE',
      'TECHNICAL_INFLUENCE_LEVEL',
      'ECOSYSTEM_INFLUENCE_SCORE',
      'ECOSYSTEM_INFLUENCE_LEVEL',
      ...this.categorySources('technical').flatMap((source) => this.categoryColumns(source)),
      ...this.categorySources('ecosystem').flatMap((source) => this.categoryColumns(source)),
    ];
    try {
      const result = await this.snowflakeService.execute<BreakdownRow>(
        `
          SELECT ${columns.join(', ')}
          FROM ${this.leaderboardBreakdownTable()}
          WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ORGANIZATION_ID = ?
          LIMIT 1
        `,
        [slug, timeRangeType, organizationId],
        { expectMissingObject: true }
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      return null;
    }
  }

  /**
   * The organization's position on this dimension's board, and how many organizations it is ranked
   * among. Both are read from the leaderboard model with the same ordering the board itself uses, so
   * the drawer's "#3 out of 41" always matches the rank on the row that opened it. The count is
   * deliberately unfiltered by the board's search term — the phrasing is about the project, not
   * about whatever the user happens to have typed.
   */
  private async fetchBoardPosition(
    slug: string,
    timeRangeType: string,
    dimension: 'technical' | 'ecosystem',
    organizationId: string
  ): Promise<{ rank: number | null; total: number }> {
    const scoreColumn = dimension === 'technical' ? 'SCORE_TECHNICAL' : 'SCORE_ECOSYSTEM';
    const result = await this.snowflakeService.execute<{ DIM_RANK: number | null; TOTAL: number | null }>(
      `
        SELECT MAX(CASE WHEN ORG_ORGANIZATION_ID = ? THEN DIM_RANK END) AS DIM_RANK, COUNT(*) AS TOTAL
        FROM (
          SELECT ORG_ORGANIZATION_ID,
                 ROW_NUMBER() OVER (ORDER BY ${scoreColumn} DESC NULLS LAST, ORG_NAME ASC, ORG_ORGANIZATION_ID ASC) AS DIM_RANK
          FROM ${this.leaderboardTable()}
          WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ?
        )
      `,
      [organizationId, slug, timeRangeType]
    );
    const row = result.rows[0];
    const rank = this.numOrNull(row?.DIM_RANK);
    return { rank: rank === null ? null : Math.round(rank), total: Math.round(this.num(row?.TOTAL)) };
  }

  /**
   * The organization's share of all project activity for this dimension — contributions for
   * technical, collaborations for ecosystem — read from the same activity model the Activity Count
   * board reads. Null when the organization has no activity row, so the drawer's summary drops the
   * clause rather than claiming a 0% share.
   */
  private async fetchActivitySharePercent(
    slug: string,
    timeRangeType: string,
    dimension: 'technical' | 'ecosystem',
    organizationId: string
  ): Promise<number | null> {
    const boardType = dimension === 'technical' ? 'contributions' : 'collaborations';
    const result = await this.snowflakeService.execute<{ ACTIVITY_PCT: number | null }>(
      `
        SELECT ACTIVITY_PCT
        FROM ${this.activityLeaderboardsTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND BOARD_TYPE = ? AND ORG_ORGANIZATION_ID = ?
        LIMIT 1
      `,
      [slug, timeRangeType, boardType, organizationId]
    );
    const pct = this.numOrNull(result.rows[0]?.ACTIVITY_PCT);
    return pct === null ? null : this.round1(pct);
  }

  /** Warehouse columns backing one drawer category, per dimension, in the drawer's display order. */
  private categorySources(dimension: 'technical' | 'ecosystem'): readonly CategorySource[] {
    return dimension === 'technical' ? OrgLensProjectDetailService.technicalCategorySources : OrgLensProjectDetailService.ecosystemCategorySources;
  }

  private categoryColumns(source: CategorySource): string[] {
    return [source.points, source.count, source.projectTotal, source.allTimeTotal].filter((column): column is string => !!column);
  }

  private mapCategoryFigure(source: CategorySource, row: BreakdownRow): OrgLeaderboardDetailCategoryFigure {
    const count = source.count ? this.numOrNull(this.column(row, source.count)) : null;
    const projectTotal = source.projectTotal ? this.numOrNull(this.column(row, source.projectTotal)) : null;
    const allTimeTotal = source.allTimeTotal ? this.numOrNull(this.column(row, source.allTimeTotal)) : null;
    return {
      key: source.key,
      // Two decimals, matching `totalScore`: the ecosystem methodology awards 0.33 and 0.66, so
      // rounding each category to one decimal leaves the drawer's "Total score" row visibly short of
      // its own column of points.
      points: this.round2(this.num(this.column(row, source.points))),
      ...(count === null ? {} : { count: Math.round(count) }),
      ...(projectTotal === null ? {} : { projectTotal: Math.round(projectTotal) }),
      ...(allTimeTotal === null ? {} : { projectAllTimeTotal: Math.round(allTimeTotal) }),
    };
  }

  private column(row: BreakdownRow, name: string): number | null {
    const value = row[name];
    return typeof value === 'number' ? value : null;
  }

  /** Category keys the caller outside the subject organization must not receive; technical has none. */
  private withheldKeysFor(dimension: 'technical' | 'ecosystem'): string[] {
    const scored = new Set(this.categorySources(dimension).map((source) => source.key));
    return ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS.filter((key) => scored.has(key));
  }

  private mapDetailLevel(level: string | null | undefined): OrgLeaderboardDetailLevel {
    switch ((level ?? '').toLowerCase()) {
      case 'leading':
        return 'Leading';
      case 'contributing':
        return 'Contributing';
      case 'participating':
        return 'Participating';
      default:
        return 'Silent';
    }
  }

  private async fetchHeroRow(orgUid: string, slug: string): Promise<HeroRow | null> {
    const result = await this.snowflakeService.execute<HeroRow>(
      `
        SELECT PROJECT_NAME, PROJECT_SLUG, PROJECT_LOGO_URL, FOUNDATION_NAME, IS_LF_PROJECT,
               DESCRIPTION, HEALTH_OVERALL_SCORE_V2, HEALTH_SCORE_CATEGORY_V2,
               COVERED_CATEGORY_COUNT_V2, HEALTH_MAX_SCORE_V2,
               SOFTWARE_VALUE, FIRST_COMMIT_TS
        FROM ${this.projectsTable()}
        WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ?
        LIMIT 1
      `,
      [orgUid, slug]
    );
    return result.rows[0] ?? null;
  }

  private async fetchCards(orgUid: string, slug: string, timeRangeType: string): Promise<CardsRow[]> {
    const result = await this.snowflakeService.execute<CardsRow>(
      `
        SELECT TECH_MAINTAINERS_COUNT, TECH_CONTRIBUTORS_PCT, TECH_COMMITS_PCT, TECH_PR_OPENED_PCT,
               TECH_AVG_MERGE_TIME_SPEED_PCT, TECH_AVG_MERGE_TIME_SPEED_CATEGORY,
               ECO_COLLABORATION_PCT, ECO_MEETING_ATTENDANCE_COUNT, ECO_BOARD_MEMBERS_COUNT,
               ECO_COMMITTEE_MEMBERS_PCT, ECO_EVENT_ATTENDANCE_PCT, ECO_EVENT_SPEAKERS_PCT,
               ECO_EVENT_SPONSORSHIPS_PCT, ECO_MEETUP_ATTENDANCE_PCT, ECO_CERTIFIED_INDIVIDUALS_PCT,
               TECH_MAINTAINERS_TOTAL, TECH_CONTRIBUTORS_TOTAL, TECH_COMMITS_TOTAL, TECH_PR_OPENED_TOTAL,
               TECH_AVG_MERGE_TIME_SECONDS,
               ECO_COLLABORATION_TOTAL, ECO_MEETING_ATTENDANCE_TOTAL, ECO_BOARD_MEMBERS_TOTAL,
               ECO_COMMITTEE_MEMBERS_TOTAL, ECO_EVENT_ATTENDANCE_TOTAL, ECO_EVENT_SPEAKERS_TOTAL,
               ECO_EVENT_SPONSORSHIPS_TOTAL, ECO_MEETUP_ATTENDANCE_TOTAL, ECO_CERTIFIED_INDIVIDUALS_TOTAL
        FROM ${this.cardsTable()}
        WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ?
        LIMIT 1
      `,
      [orgUid, slug, timeRangeType]
    );
    return result.rows;
  }

  private async fetchSparklines(orgUid: string, slug: string): Promise<SparkRow[]> {
    const result = await this.snowflakeService.execute<SparkRow>(
      `
        SELECT METRIC_KEY, SPAN_MONTH, ORG_VALUE, PROJECT_VALUE
        FROM ${this.sparklinesTable()}
        WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ?
      `,
      [orgUid, slug]
    );
    return result.rows;
  }

  /** 1y/2y card sparklines: trailing monthly values on the fixed month axis (client slices to range). */
  private async fetchMonthlySparklineData(orgUid: string, slug: string): Promise<SparklineData> {
    const rows = await this.fetchSparklines(orgUid, slug);
    return { index: this.buildSparklineIndex(rows), axis: this.monthAxis() };
  }

  /**
   * All-time card sparklines: per-(metric, bucket) values re-binned to the project's shared lifetime
   * axis. The axis (and therefore `periods[]`) comes from the bucket spine so every card lines up
   * with the trend and with each other even when a metric has no data in some buckets.
   */
  private async fetchLifetimeSparklineData(orgUid: string, slug: string): Promise<SparklineData> {
    const [rows, axis] = await Promise.all([this.fetchSparklinesLifetime(orgUid, slug), this.fetchLifetimeAxis(slug)]);
    return {
      index: this.buildSparklineLifetimeIndex(rows),
      axis: axis.map((bucket) => String(bucket.index)),
      periods: axis.map((bucket) => bucket.label),
    };
  }

  private async fetchSparklinesLifetime(orgUid: string, slug: string): Promise<SparkLifetimeRow[]> {
    const result = await this.snowflakeService.execute<SparkLifetimeRow>(
      `
        SELECT METRIC_KEY, BUCKET_INDEX, ORG_VALUE, PROJECT_VALUE
        FROM ${this.sparklinesLifetimeTable()}
        WHERE ACCOUNT_ID = ? AND PROJECT_SLUG = ?
      `,
      [orgUid, slug]
    );
    return result.rows;
  }

  private async fetchPlatforms(slug: string, timeRangeType: string): Promise<PlatformsRow[]> {
    const result = await this.snowflakeService.execute<PlatformsRow>(
      `
        SELECT CONTRIBUTOR_PLATFORMS, COMMIT_PLATFORMS, PR_PLATFORMS, MAINTAINER_PLATFORMS
        FROM ${this.platformsTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ?
        LIMIT 1
      `,
      [slug, timeRangeType]
    );
    return result.rows;
  }

  private async fetchTrend(slug: string, windowMonths: number): Promise<TrendRow[]> {
    return this.fetchFoldedTrend<TrendRow>(slug, this.trendTable(), 'SPAN_MONTH', windowMonths);
  }

  /** All-time trend: per-(account, bucket) combined scores over the project's shared lifetime bucket axis. */
  private async fetchTrendLifetime(slug: string): Promise<TrendLifetimeRow[]> {
    return this.fetchFoldedTrend<TrendLifetimeRow>(slug, this.trendLifetimeTable(), 'BUCKET_INDEX');
  }

  private async fetchFoldedTrend<T>(slug: string, table: string, periodColumn: 'SPAN_MONTH' | 'BUCKET_INDEX', windowMonths?: number): Promise<T[]> {
    const cap = OrgLensProjectDetailService.trendNamedOrgCap;
    const others = OrgLensProjectDetailService.trendOthersLabel;
    const windowClause = windowMonths === undefined ? '' : `QUALIFY ${periodColumn} >= DATEADD('month', 1 - ?, MAX(${periodColumn}) OVER ())`;
    const binds: (string | number)[] = [slug];
    if (windowMonths !== undefined) binds.push(windowMonths);
    binds.push(cap, others, cap);

    const result = await this.snowflakeService.execute<T>(
      `
        WITH windowed AS (
          SELECT ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, ${periodColumn}, COMBINED_INFLUENCE_SCORE
          FROM ${table}
          WHERE PROJECT_SLUG = ?
            AND ACCOUNT_ID IS NOT NULL
            AND ACCOUNT_ID <> ''
          ${windowClause}
        ),
        ranked_orgs AS (
          SELECT
            ACCOUNT_ID,
            ROW_NUMBER() OVER (
              ORDER BY MAX_BY(COMBINED_INFLUENCE_SCORE, ${periodColumn}) DESC NULLS LAST,
                       COALESCE(MAX(ORG_NAME), '') ASC,
                       ACCOUNT_ID ASC
            ) AS org_rank
          FROM windowed
          GROUP BY ACCOUNT_ID
        ),
        ranked AS (
          SELECT w.ACCOUNT_ID, w.ORG_NAME, w.ORG_LOGO_URL, w.${periodColumn}, w.COMBINED_INFLUENCE_SCORE, r.org_rank
          FROM windowed w
          JOIN ranked_orgs r ON r.ACCOUNT_ID = w.ACCOUNT_ID
        )
        SELECT ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, ${periodColumn}, COMBINED_INFLUENCE_SCORE
        FROM ranked
        WHERE org_rank <= ?
        UNION ALL
        SELECT
          '' AS ACCOUNT_ID,
          ? AS ORG_NAME,
          '' AS ORG_LOGO_URL,
          ${periodColumn},
          SUM(COMBINED_INFLUENCE_SCORE) AS COMBINED_INFLUENCE_SCORE
        FROM ranked
        WHERE org_rank > ?
        GROUP BY ${periodColumn}
        ORDER BY ACCOUNT_ID, ${periodColumn} ASC
      `,
      binds
    );
    return result.rows;
  }

  /**
   * The project's shared adaptive lifetime axis (oldest → newest), read from the bucket spine so it
   * is complete even for metrics/orgs the bucketed models have sparse rows for. Both the trend and
   * the sparklines render against this one axis under "All time" (D7); each bucket also carries a
   * formatted label for the wire `periods[]`.
   */
  private async fetchLifetimeAxis(slug: string): Promise<{ index: number; label: string }[]> {
    const result = await this.snowflakeService.execute<BucketAxisRow>(
      `
        SELECT DISTINCT BUCKET_INDEX, BUCKET_GRANULARITY, BUCKET_START, BUCKET_END
        FROM ${this.bucketSpineTable()}
        WHERE PROJECT_SLUG = ?
        ORDER BY BUCKET_INDEX ASC
      `,
      [slug]
    );
    return result.rows
      .filter((row) => row.BUCKET_INDEX !== null && row.BUCKET_INDEX !== undefined)
      .map((row) => ({ index: this.num(row.BUCKET_INDEX), label: this.bucketLabel(row.BUCKET_GRANULARITY, row.BUCKET_START, row.BUCKET_END) }));
  }

  /** Index the tall sparkline rows into per-card (year-month → value) maps for org + project. */
  private buildSparklineIndex(rows: SparkRow[]): SparklineIndex {
    const index: SparklineIndex = new Map();
    for (const row of rows) {
      const key = row.METRIC_KEY;
      const ym = this.toYearMonth(row.SPAN_MONTH);
      if (!key || !ym) continue;
      let entry = index.get(key);
      if (!entry) {
        entry = { org: new Map(), project: new Map() };
        index.set(key, entry);
      }
      entry.org.set(ym, row.ORG_VALUE == null ? null : this.num(row.ORG_VALUE));
      entry.project.set(ym, this.num(row.PROJECT_VALUE));
    }
    return index;
  }

  /**
   * Index the lifetime-bucketed sparkline rows into per-card (bucket-index → value) maps. Keyed by the
   * stringified bucket index so it shares the same dense-series machinery as the monthly index (whose
   * keys are year-months) — the axis for `all` is the list of bucket-index strings.
   */
  private buildSparklineLifetimeIndex(rows: SparkLifetimeRow[]): SparklineIndex {
    const index: SparklineIndex = new Map();
    for (const row of rows) {
      const key = row.METRIC_KEY;
      if (!key || row.BUCKET_INDEX === null || row.BUCKET_INDEX === undefined) continue;
      const bucketKey = String(this.num(row.BUCKET_INDEX));
      let entry = index.get(key);
      if (!entry) {
        entry = { org: new Map(), project: new Map() };
        index.set(key, entry);
      }
      entry.org.set(bucketKey, row.ORG_VALUE == null ? null : this.num(row.ORG_VALUE));
      entry.project.set(bucketKey, this.num(row.PROJECT_VALUE));
    }
    return index;
  }

  /**
   * Adaptive-bucket axis label for the wire `periods[]` (D9): monthly `MMM YYYY`, quarterly `Q# YYYY`,
   * yearly `YYYY`, multi-year `YYYY–YYYY`, and `YYYY–?` for a multi-year bucket whose end date is
   * missing or unparseable. Derived from the bucket's start (and end for multi-year).
   */
  private bucketLabel(granularity: string | null, start: Date | string | null, end: Date | string | null): string {
    const startDate = this.parseUtcDate(start);
    if (startDate === null) return '';
    const year = startDate.getUTCFullYear();
    switch (granularity) {
      case 'monthly':
        return `${OrgLensProjectDetailService.shortMonths[startDate.getUTCMonth()]} ${year}`;
      case 'quarterly':
        return `Q${Math.floor(startDate.getUTCMonth() / 3) + 1} ${year}`;
      case 'yearly':
        return `${year}`;
      case 'multi_year': {
        const endDate = this.parseUtcDate(end);
        // A missing end date must not collapse to a bare `YYYY`: that is indistinguishable from a
        // yearly bucket and understates the span. Mark the end as unknown so the gap is visible.
        if (endDate === null) return `${year}\u2013?`;
        const endYear = endDate.getUTCFullYear();
        return endYear > year ? `${year}\u2013${endYear}` : `${year}`;
      }
      default:
        return `${year}`;
    }
  }

  /** Coerce a Snowflake DATE cell to a UTC-anchored Date (first-of-day), or null if unparseable. */
  private parseUtcDate(value: Date | string | null): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  /** Trailing 36 year-month keys (YYYY-MM), oldest → newest, ending at the current month. */
  private monthAxis(): string[] {
    const now = new Date();
    const axis: string[] = [];
    for (let i = OrgLensProjectDetailService.sparklineMonths - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      axis.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return axis;
  }

  /**
   * Dense, contiguous, zero-filled series for a card over the month axis. A card with no rows at
   * all returns empty arrays so the component renders "No data" (the genuinely-empty case).
   */
  private denseSeries(index: SparklineIndex, key: string, axis: string[]): { sparkline: (number | null)[]; projectSparkline: number[] } {
    const entry = index.get(key);
    if (!entry) return { sparkline: [], projectSparkline: [] };
    // avg-merge-time leaves a gap (null) in months with no merged PRs; counts zero-fill.
    const orgFill = key === 'avg-merge-time' ? null : 0;
    return {
      sparkline: axis.map((ym) => entry.org.get(ym) ?? orgFill),
      projectSparkline: axis.map((ym) => entry.project.get(ym) ?? 0),
    };
  }

  private toYearMonth(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
    const match = String(value).match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : null;
  }

  /**
   * DN9 Phase 1: per-card drawer sections — real definition copy, the project-wide total for the
   * active range (read straight from the cards row's TOTAL_* columns, which mirror org-dashboard's
   * per-card summary totals — no monthly re-derivation), data source (static for the 9 ecosystem
   * cards; project-wide distinct source platforms for the 5 technical cards), and the table column
   * headers. The card-specific roster rows land in a follow-up, so `rows` is empty for now.
   */
  private buildCardDetails(cards: CardsRow | null, platforms: PlatformsRow | null, isNonLf: boolean): Record<string, OrgLensCardDetailSection> {
    const details: Record<string, OrgLensCardDetailSection> = {};

    for (const [key, meta] of Object.entries(OrgLensProjectDetailService.cardDefs)) {
      const isTechnical = meta.ecoDataSource === undefined;
      // Non-LF projects have no ecosystem group (DN4), so their ecosystem drawers carry no total.
      const total = isNonLf && !isTechnical ? '—' : this.projectTotal(meta, cards);
      const dataSource = isTechnical ? this.technicalDataSource(meta, platforms) : (meta.ecoDataSource ?? '');

      details[key] = {
        definition: { text: meta.text, totalType: meta.totalType, total, dataSource },
        columns: meta.columns,
        // Rows are fetched lazily and server-paginated via getCardRoster; the main response ships none.
        rows: [],
      };
    }

    return details;
  }

  /** Per-card roster provider (wrapper table + projection + optional predicate + order + row mapping); null when a card has no roster. */
  private rosterProvider(cardKey: string): RosterProvider | null {
    switch (cardKey) {
      case 'board-members':
        return {
          table: this.committeeMembersTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, JOINED_DATE, APPOINTED_BY',
          where: 'IS_BOARD_MEMBER = TRUE',
          orderBy: 'JOINED_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.formatDrawerDate(this.dateVal(r['JOINED_DATE'])) },
              { text: this.str(r['APPOINTED_BY']) ?? '—' },
            ],
          }),
        };
      case 'committee-members':
        return {
          table: this.committeeMembersTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, COMMITTEE_NAME, JOINED_DATE',
          where: 'IS_BOARD_MEMBER = FALSE',
          orderBy: 'JOINED_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['COMMITTEE_NAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['JOINED_DATE'])) },
            ],
          }),
        };
      case 'certified-individuals':
        return {
          table: this.certifiedIndividualsTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, CERTIFICATION_NAME, ISSUED_DATE',
          orderBy: 'ISSUED_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['CERTIFICATION_NAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['ISSUED_DATE'])) },
            ],
          }),
        };
      case 'event-attendance':
        return {
          table: this.eventAttendanceTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, EVENT_NAME, EVENT_DATE, LOCATION',
          orderBy: 'EVENT_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['EVENT_NAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['EVENT_DATE'])) },
              { text: this.str(r['LOCATION']) ?? '—' },
            ],
          }),
        };
      case 'event-speakers':
        return {
          table: this.eventSpeakersTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, EVENT_NAME, EVENT_DATE',
          orderBy: 'EVENT_DATE DESC NULLS LAST',
          // 'Talk title' has no upstream source — rendered as a placeholder.
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['EVENT_NAME']) ?? '—' },
              { text: '—' },
              { text: this.formatDrawerDate(this.dateVal(r['EVENT_DATE'])) },
            ],
          }),
        };
      case 'meeting-attendance':
        return {
          table: this.meetingAttendanceTable(),
          select: 'PERSON_NAME, MEETING_TYPE, MEETING_DATE',
          orderBy: 'MEETING_DATE DESC NULLS LAST',
          // No attendee photo in the source, so the person cell renders initials.
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), null),
              { text: this.str(r['MEETING_TYPE']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['MEETING_DATE'])) },
            ],
          }),
        };
      case 'event-sponsorships':
        return {
          table: this.eventSponsorshipsTable(),
          select: 'EVENT_NAME, EVENT_DATE, SPONSORSHIP_TIER, REACH',
          orderBy: 'EVENT_DATE DESC NULLS LAST',
          // Org-level roster — no person cell.
          map: (r) => ({
            cells: [
              { text: this.str(r['EVENT_NAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['EVENT_DATE'])) },
              { text: this.str(r['SPONSORSHIP_TIER']) ?? '—' },
              { text: this.formatCount(this.numVal(r['REACH'])) },
            ],
          }),
        };
      case 'contributors':
        return {
          table: this.contributorsTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, USERNAME, FIRST_ACTIVITY_TS, MOST_RECENT_ACTIVITY_TS, CONTRIBUTIONS_COUNT',
          orderBy: 'CONTRIBUTIONS_COUNT DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['USERNAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['FIRST_ACTIVITY_TS'])) },
              { text: this.formatDrawerDate(this.dateVal(r['MOST_RECENT_ACTIVITY_TS'])) },
              { text: this.formatCount(this.numVal(r['CONTRIBUTIONS_COUNT'])) },
            ],
          }),
        };
      case 'maintainers':
        return {
          table: this.maintainersTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, USERNAME, GRANTED_DATE',
          orderBy: 'GRANTED_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['USERNAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['GRANTED_DATE'])) },
            ],
          }),
        };
      case 'collaboration':
        return {
          table: this.collaborationTable(),
          select: 'SOURCE_PLATFORM, PERSON_NAME, PERSON_AVATAR_URL, LOCATION, COLLABORATION_COUNT, MOST_RECENT_TS',
          orderBy: 'COLLABORATION_COUNT DESC NULLS LAST',
          map: (r) => ({
            cells: [
              { text: this.formatPlatform(this.str(r['SOURCE_PLATFORM'])) },
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['LOCATION']) ?? '—' },
              { text: this.formatCount(this.numVal(r['COLLABORATION_COUNT'])) },
              { text: this.formatDrawerDate(this.dateVal(r['MOST_RECENT_TS'])) },
            ],
          }),
        };
      case 'meetup-attendance':
        return {
          table: this.meetupAttendanceTable(),
          select: 'PERSON_NAME, PERSON_AVATAR_URL, MEETUP_NAME, EVENT_DATE, LOCATION',
          orderBy: 'EVENT_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.str(r['MEETUP_NAME']) ?? '—' },
              { text: this.formatDrawerDate(this.dateVal(r['EVENT_DATE'])) },
              { text: this.str(r['LOCATION']) ?? '—' },
            ],
          }),
        };
      case 'commits':
        return {
          table: this.commitsTable(),
          select: 'REPOSITORY_GROUP, PERSON_NAME, PERSON_AVATAR_URL, COMMIT_DATE, COMMIT_MESSAGE',
          orderBy: 'COMMIT_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              { text: this.str(r['REPOSITORY_GROUP']) ?? '—' },
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.formatDrawerDate(this.dateVal(r['COMMIT_DATE'])) },
              { text: this.str(r['COMMIT_MESSAGE']) ?? '—' },
            ],
          }),
        };
      case 'pull-requests':
        return {
          table: this.pullRequestsTable(),
          select: 'REPOSITORY_GROUP, PERSON_NAME, PERSON_AVATAR_URL, OPENED_DATE, PR_TITLE',
          orderBy: 'OPENED_DATE DESC NULLS LAST',
          map: (r) => ({
            cells: [
              { text: this.str(r['REPOSITORY_GROUP']) ?? '—' },
              this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
              { text: this.formatDrawerDate(this.dateVal(r['OPENED_DATE'])) },
              { text: this.str(r['PR_TITLE']) ?? '—' },
            ],
          }),
        };
      case 'avg-merge-time':
        return {
          table: this.avgMergeTimeTable(),
          select: 'REPOSITORY_GROUP, PERSON_NAME, PERSON_AVATAR_URL, PR_TITLE, MERGED_DATE, MERGE_SECONDS',
          orderBy: 'MERGED_DATE DESC NULLS LAST',
          map: (r) => {
            const seconds = this.numVal(r['MERGE_SECONDS']);
            return {
              cells: [
                { text: this.str(r['REPOSITORY_GROUP']) ?? '—' },
                this.personCell(this.str(r['PERSON_NAME']), this.str(r['PERSON_AVATAR_URL'])),
                { text: this.str(r['PR_TITLE']) ?? '—' },
                { text: this.formatDrawerDate(this.dateVal(r['MERGED_DATE'])) },
                { text: seconds === null ? '—' : this.formatDuration(seconds) },
              ],
            };
          },
        };
      default:
        return null;
    }
  }

  /** Coerce a Snowflake cell to a display string (null preserved). */
  private str(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? value : String(value);
  }

  /** Coerce a Snowflake cell to a Date/ISO string the date formatter accepts (else null). */
  private dateVal(value: unknown): Date | string | null {
    if (value instanceof Date || typeof value === 'string') return value;
    return null;
  }

  /** Coerce a Snowflake cell to a finite number (null for missing or non-numeric values). */
  private numVal(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** A person cell for a roster row: display name, optional avatar, and derived initials fallback. */
  private personCell(name: string | null, avatarUrl: string | null): OrgLensCardDetailCell {
    const display = name?.trim() || 'Unknown';
    const person: { name: string; avatarUrl?: string; initials: string } = { name: display, initials: this.deriveInitials(display) };
    const url = avatarUrl?.trim();
    if (url) person.avatarUrl = url;
    return { person };
  }

  /** Up-to-2-letter initials from a display name (first + last word), for the avatar fallback. */
  private deriveInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** Human-readable platform label for the collaboration "Source" column (e.g. github → GitHub). */
  private formatPlatform(value: string | null): string {
    const raw = value?.trim();
    if (!raw) return '—';
    return OrgLensProjectDetailService.platformLabels[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  /** Format an integer roster count column (e.g. "1,764"); "—" when absent. */
  private formatCount(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return Math.round(this.num(value)).toLocaleString('en-US');
  }

  /** Format a roster date column (e.g. "May 7, 2026"); "—" when absent. UTC-anchored to avoid off-by-one. */
  private formatDrawerDate(value: Date | string | null): string {
    const iso = toIsoDate(value);
    if (iso === null) return '—';
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /**
   * Project-wide total string for a card's drawer, read from the active-range cards row. Counts are
   * whole numbers; the average-merge-time total is seconds rendered as a duration.
   */
  private projectTotal(meta: CardDefMeta, cards: CardsRow | null): string {
    const raw = cards?.[meta.totalField] ?? null;
    if (raw === null || raw === undefined) return '—';
    const value = this.num(raw);
    if (meta.totalType === 'average') {
      return value > 0 ? this.formatDuration(value) : '—';
    }
    return Math.round(value).toLocaleString('en-US');
  }

  /** Average PR merge time in seconds → human string (days ≥ 1 day, else hours). */
  private formatDuration(seconds: number): string {
    const days = seconds / 86400;
    if (days >= 1) return `${days.toFixed(1)} days`;
    return `${(seconds / 3600).toFixed(1)} hours`;
  }

  /** Project-wide distinct source platforms for a technical card → display string (e.g. "Git, GitHub"). */
  private technicalDataSource(meta: CardDefMeta, platforms: PlatformsRow | null): string {
    const raw = meta.platformField ? platforms?.[meta.platformField] : null;
    if (!raw) return 'LFX Insights';
    const labels = raw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => OrgLensProjectDetailService.platformLabels[token.toLowerCase()] ?? token.charAt(0).toUpperCase() + token.slice(1));
    return labels.length > 0 ? [...new Set(labels)].join(', ') : 'LFX Insights';
  }

  /** Group flat trend rows into per-org series over the shared month axis (oldest → newest). */
  private buildTrendByAccount(rows: TrendRow[]): Map<string, TrendSeries> {
    const scoresByAccount = new Map<string, { orgName: string; orgLogoUrl: string; byMonth: Map<string, number> }>();
    const months = new Set<string>();
    for (const row of rows) {
      const ym = this.toYearMonth(row.SPAN_MONTH);
      if (!ym) continue;
      months.add(ym);
      const key = this.trendSeriesKey(row.ACCOUNT_ID);
      let entry = scoresByAccount.get(key);
      if (!entry) {
        entry = {
          orgName: key === '' ? OrgLensProjectDetailService.trendOthersLabel : (row.ORG_NAME ?? ''),
          orgLogoUrl: row.ORG_LOGO_URL ?? '',
          byMonth: new Map(),
        };
        scoresByAccount.set(key, entry);
      }
      entry.byMonth.set(ym, this.round1(this.num(row.COMBINED_INFLUENCE_SCORE)));
    }

    const axis = [...months].sort();
    const byAccount = new Map<string, TrendSeries>();
    for (const [accountId, entry] of scoresByAccount) {
      byAccount.set(accountId, {
        accountId,
        orgName: entry.orgName,
        orgLogoUrl: entry.orgLogoUrl,
        combined: axis.map((ym) => entry.byMonth.get(ym) ?? 0),
      });
    }
    return byAccount;
  }

  /**
   * Group the lifetime-bucketed trend rows into per-org series over the project's shared bucket axis.
   * Values are placed BY bucket index and the axis is zero-filled, rather than pushed in row order,
   * so every series is exactly `axis.length` long and stays positionally aligned with the emitted
   * `periods[]` labels even if the read model ever returns a sparse row set (a backfill gap would
   * otherwise shift a series against the axis and silently mislabel every one of its points). This
   * mirrors how the card sparklines densify over their axis in `denseSeries`.
   */
  private buildTrendLifetimeByAccount(rows: TrendLifetimeRow[], axis: number[]): Map<string, TrendSeries> {
    const scoresByAccount = new Map<string, { orgName: string; orgLogoUrl: string; byBucket: Map<number, number> }>();
    for (const row of rows) {
      if (row.BUCKET_INDEX === null || row.BUCKET_INDEX === undefined) continue;
      const key = this.trendSeriesKey(row.ACCOUNT_ID);
      let entry = scoresByAccount.get(key);
      if (!entry) {
        entry = {
          orgName: key === '' ? OrgLensProjectDetailService.trendOthersLabel : (row.ORG_NAME ?? ''),
          orgLogoUrl: row.ORG_LOGO_URL ?? '',
          byBucket: new Map(),
        };
        scoresByAccount.set(key, entry);
      }
      entry.byBucket.set(this.num(row.BUCKET_INDEX), this.round1(this.num(row.COMBINED_INFLUENCE_SCORE)));
    }

    const byAccount = new Map<string, TrendSeries>();
    for (const [accountId, entry] of scoresByAccount) {
      byAccount.set(accountId, {
        accountId,
        orgName: entry.orgName,
        orgLogoUrl: entry.orgLogoUrl,
        combined: axis.map((bucketIndex) => entry.byBucket.get(bucketIndex) ?? 0),
      });
    }
    return byAccount;
  }

  private buildTrendSeries(byAccount: Map<string, TrendSeries>): OrgLensProjectTrendSeries[] {
    const latest = (series: TrendSeries): number => series.combined[series.combined.length - 1] ?? 0;
    const named: TrendSeries[] = [];
    let others: TrendSeries | undefined;
    for (const series of byAccount.values()) {
      if (series.accountId === '') {
        others = series;
      } else {
        named.push(series);
      }
    }
    named.sort((a, b) => latest(b) - latest(a) || a.orgName.localeCompare(b.orgName) || a.accountId.localeCompare(b.accountId));
    const toWire = (series: TrendSeries): OrgLensProjectTrendSeries => ({
      accountId: series.accountId,
      orgName: series.orgName,
      orgLogoUrl: series.orgLogoUrl,
      combined: series.combined,
    });
    const series = named.map(toWire);
    if (others !== undefined) series.push(toWire(others));
    return series;
  }

  /** The viewing org's own leaderboard row (for the Our-Influence tab's band chips); null if absent. */
  private async fetchViewingLeaderboardRow(orgUid: string, slug: string, timeRangeType: string): Promise<LeaderboardRow | null> {
    const result = await this.snowflakeService.execute<LeaderboardRow>(
      `
        SELECT ORG_ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, SCORE_COMBINED, SCORE_TECHNICAL, SCORE_ECOSYSTEM,
               LEVEL_COMBINED, LEVEL_TECHNICAL, LEVEL_ECOSYSTEM, RANK
        FROM ${this.leaderboardTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ORG_ACCOUNT_ID = ?
        -- One Salesforce account can span multiple leaderboard rows (one per crowd.dev org); pick its
        -- best-ranked row deterministically so the Our-Influence band chips never flip between requests.
        -- ORG_ORGANIZATION_ID is the model's unique per-row grain key and breaks any
        -- rank/score/name tie that would otherwise let the LIMIT 1 pick flip.
        ORDER BY RANK ASC NULLS LAST, SCORE_COMBINED DESC, ORG_NAME ASC, ORG_ORGANIZATION_ID ASC
        LIMIT 1
      `,
      [slug, timeRangeType, orgUid]
    );
    return result.rows[0] ?? null;
  }

  /** Map a combined-leaderboard row to a Calculated Influence board row (scores + bands + rank). */
  private mapInfluenceRow(row: LeaderboardRow, orgUid: string, isNonLf: boolean): OrgLensProjectLeaderboardRow {
    return {
      organizationId: row.ORG_ORGANIZATION_ID ?? '',
      orgName: row.ORG_NAME ?? '',
      orgLogoUrl: row.ORG_LOGO_URL ?? '',
      scores: {
        combined: this.round1(this.num(row.SCORE_COMBINED)),
        technical: this.round1(this.num(row.SCORE_TECHNICAL)),
        ecosystem: this.round1(this.num(row.SCORE_ECOSYSTEM)),
      },
      levels: {
        combined: this.mapBand(row.LEVEL_COMBINED) ?? 'silent',
        technical: this.mapBand(row.LEVEL_TECHNICAL) ?? 'silent',
        ecosystem: isNonLf ? null : (this.mapBand(row.LEVEL_ECOSYSTEM) ?? 'silent'),
      },
      // Calculated Influence rows carry no activity totals — Activity Count mode reads the
      // separate activity-leaderboards model — so this is a zero placeholder the board never renders.
      activityCount: { contributions: 0, collaborations: 0, contributionsPct: 0, collaborationsPct: 0 },
      // Rank is the DIM_RANK computed in fetchInfluenceBoardPage; leave undefined only if RANK is
      // somehow absent so the client never renders "#0" for a real row.
      warehouseRank: this.numOrNull(row.RANK) === null ? undefined : Math.round(this.num(row.RANK)),
      isViewingOrg: row.ORG_ACCOUNT_ID === orgUid,
    };
  }

  /** Map a gold-sourced activity board row to an Activity Count board row (total/pct + warehouse rank). */
  private mapActivityRow(row: ActivityBoardRow, dimension: 'technical' | 'ecosystem', orgUid: string): OrgLensProjectLeaderboardRow {
    const isContributions = dimension === 'technical';
    const total = Math.round(this.num(row.ACTIVITY_TOTAL));
    const pct = this.round1(this.num(row.ACTIVITY_PCT));
    return {
      organizationId: row.ORG_ORGANIZATION_ID ?? '',
      orgName: row.ORG_NAME ?? '',
      orgLogoUrl: row.ORG_LOGO_URL ?? '',
      scores: { combined: 0, technical: 0, ecosystem: 0 },
      levels: { combined: 'silent', technical: 'silent', ecosystem: 'silent' },
      activityCount: {
        contributions: isContributions ? total : 0,
        collaborations: isContributions ? 0 : total,
        contributionsPct: isContributions ? pct : 0,
        collaborationsPct: isContributions ? 0 : pct,
      },
      warehouseRank: this.numOrNull(row.RANK) === null ? undefined : Math.round(this.num(row.RANK)),
      isViewingOrg: row.ORG_ACCOUNT_ID === orgUid,
    };
  }

  private mapHero(row: HeroRow, slug: string, foundationLabel: string): OrgLensProjectHero {
    return {
      projectName: row.PROJECT_NAME,
      description: row.DESCRIPTION ?? `${row.PROJECT_NAME} is an open source project in the ${foundationLabel} ecosystem.`,
      logoUrl: row.PROJECT_LOGO_URL ?? '',
      lfxInsightsUrl: buildInsightsUrl(`/project/${slug}`),
      firstCommit: toIsoDate(row.FIRST_COMMIT_TS),
      softwareValueUsd: row.SOFTWARE_VALUE ?? null,
      health: this.mapHealth(row),
      // Sourced straight from the warehouse — never recomputed, per health.mapHealth's v2-category/score precedence.
      healthMaxScore: row.HEALTH_MAX_SCORE_V2 ?? null,
      healthCoveredCategoryCount: row.COVERED_CATEGORY_COUNT_V2 ?? null,
      foundationLabel,
    };
  }

  private mapHealth(row: Pick<HeroRow, 'HEALTH_OVERALL_SCORE_V2' | 'HEALTH_SCORE_CATEGORY_V2'>): OrgLensProjectHealth | null {
    const v2 = normalizeHealthScoreCategoryV2(row.HEALTH_SCORE_CATEGORY_V2);
    if (v2) return v2;
    const score = row.HEALTH_OVERALL_SCORE_V2;
    if (score === null || score === undefined) return null;
    return classifyHealthScore(score);
  }

  private buildTechnicalCards(cards: CardsRow | null, index: SparklineIndex, axis: string[]): OrgLensProjectInfluenceCard[] {
    const maintainers = this.numOrNull(cards?.TECH_MAINTAINERS_COUNT);
    const mergePct = cards?.TECH_AVG_MERGE_TIME_SPEED_PCT;
    const mergeCategory = cards?.TECH_AVG_MERGE_TIME_SPEED_CATEGORY;
    // The warehouse returns NULL speed % + category when there is no merged-PR data for the project
    // (no eligible PRs, or a segment whose PR slug diverges from its Insights slug). Show a no-data
    // caption instead of a misleading "0.0% slower than average".
    const hasMergeData = typeof mergePct === 'number' && Number.isFinite(mergePct) && !!mergeCategory;
    return [
      this.card(
        'maintainers',
        'Maintainers',
        null,
        this.countCaption(maintainers, { prefix: 'Our company employs ', emphasis: 'no', suffix: ' maintainers for this project.' }, (n) => ({
          prefix: 'Our company employs ',
          emphasis: `${n}`,
          suffix: ` ${this.plural(n, 'maintainer', 'maintainers')} for this project.`,
        })),
        index,
        axis
      ),
      this.card(
        'contributors',
        'Contributors',
        null,
        this.pctCaption(cards?.TECH_CONTRIBUTORS_PCT, 'Our company employs ', ' of contributors to this project.'),
        index,
        axis
      ),
      this.card('commits', 'Commit Activities', null, this.pctCaption(cards?.TECH_COMMITS_PCT, 'Employees made ', ' of all commit activities.'), index, axis),
      this.card(
        'pull-requests',
        'Pull Requests Opened',
        null,
        this.pctCaption(cards?.TECH_PR_OPENED_PCT, 'Employees opened ', ' of all pull requests.'),
        index,
        axis
      ),
      this.card(
        'avg-merge-time',
        'Avg Time to Merge PRs',
        null,
        hasMergeData
          ? { prefix: 'PRs merged ', emphasis: `${this.num(mergePct).toFixed(1)}% ${mergeCategory}`, suffix: ' than average.' }
          : { prefix: 'No merge-time data for this project yet.', emphasis: '', suffix: '' },
        index,
        axis
      ),
    ];
  }

  private buildEcosystemCards(
    cards: CardsRow | null,
    projectName: string,
    foundation: string,
    isNonLf: boolean,
    index: SparklineIndex,
    axis: string[]
  ): OrgLensProjectInfluenceCard[] {
    // Ecosystem metrics are LF-foundation constructs; non-LF projects have no ecosystem group.
    if (isNonLf) {
      return [];
    }
    const meetings = this.numOrNull(cards?.ECO_MEETING_ATTENDANCE_COUNT);
    const board = this.numOrNull(cards?.ECO_BOARD_MEMBERS_COUNT);
    return [
      this.card(
        'collaboration',
        'Collaboration Activity',
        projectName,
        this.pctCaption(cards?.ECO_COLLABORATION_PCT, 'Employees contributed ', ' of all collaboration activities.'),
        index,
        axis
      ),
      this.card(
        'meeting-attendance',
        'Meeting Attendance',
        projectName,
        this.countCaption(meetings, { prefix: 'Our company has no meeting attendance for this project.', emphasis: '', suffix: '' }, (n) => ({
          prefix: 'Org reps attended ',
          emphasis: `${n}`,
          suffix: ` project ${this.plural(n, 'meeting', 'meetings')}.`,
        })),
        index,
        axis
      ),
      this.card(
        'board-members',
        'Board Members',
        foundation,
        this.countCaption(board, { prefix: `Your organization holds no board seats in ${foundation}.`, emphasis: '', suffix: '' }, (n) => ({
          prefix: 'Our company employs ',
          emphasis: `${n} board ${this.plural(n, 'member', 'members')}`,
          suffix: ` for ${foundation}.`,
        })),
        index,
        axis
      ),
      this.card(
        'committee-members',
        'Committee Members',
        foundation,
        this.pctCaption(cards?.ECO_COMMITTEE_MEMBERS_PCT, 'Employees make up ', ' of all committee members.'),
        index,
        axis
      ),
      this.card(
        'event-attendance',
        'Event Attendance',
        foundation,
        this.pctCaption(cards?.ECO_EVENT_ATTENDANCE_PCT, 'Employees attended ', ` of all ${foundation} events.`),
        index,
        axis
      ),
      this.card(
        'event-speakers',
        'Event Speakers',
        foundation,
        this.pctCaption(cards?.ECO_EVENT_SPEAKERS_PCT, 'Employees represented ', ` of all speakers at ${foundation} events.`),
        index,
        axis
      ),
      this.card(
        'event-sponsorships',
        'Event Sponsorships',
        foundation,
        this.pctCaption(cards?.ECO_EVENT_SPONSORSHIPS_PCT, 'Our company reached ', ' of attendees through sponsorship.'),
        index,
        axis
      ),
      this.card(
        'meetup-attendance',
        'Meetup Attendance',
        foundation,
        this.pctCaption(cards?.ECO_MEETUP_ATTENDANCE_PCT, 'Employees attended ', ` of all ${foundation} meetups.`),
        index,
        axis
      ),
      this.card(
        'certified-individuals',
        'Certified Individuals',
        foundation,
        this.pctCaption(cards?.ECO_CERTIFIED_INDIVIDUALS_PCT, 'Employees make up ', ' of all certified individuals.'),
        index,
        axis
      ),
    ];
  }

  /**
   * Assemble a card: the headline caption plus the org (`sparkline`) and project-wide
   * (`projectSparkline`) monthly series, densified to the 36-month axis. A card whose metric has
   * no rows at all gets empty arrays → the component renders "No data".
   */
  private card(
    key: string,
    label: string,
    scopeLabel: string | null,
    caption: { prefix: string; emphasis: string; suffix: string },
    index: SparklineIndex,
    axis: string[]
  ): OrgLensProjectInfluenceCard {
    let { sparkline, projectSparkline } = this.denseSeries(index, key, axis);
    // Warehouse stores merge-time sparklines in seconds; the influence card chart labels them in days.
    // Preserve null gaps (no merged PRs that month) rather than coercing them to 0 days.
    if (key === 'avg-merge-time') {
      sparkline = sparkline.map((value) => (value === null ? null : value / 86400));
      projectSparkline = projectSparkline.map((value) => value / 86400);
    }
    return { key, label, scopeLabel, sparkline, projectSparkline, caption };
  }

  /** Precomputed warehouse level string → wire band tier. */
  private mapBand(level: string | null): OrgLensProjectBand | null {
    switch ((level ?? '').toLowerCase()) {
      case 'leading':
        return 'leading';
      case 'contributing':
        return 'contributing';
      case 'participating':
        return 'participating';
      case 'silent':
        return 'silent';
      default:
        return null;
    }
  }

  /**
   * Caption for a percentage card. A finite value (including a genuine 0) renders the normal
   * "X% …" caption; a null/undefined value — i.e. no cards row for this (account, project, range) —
   * renders an honest no-data caption rather than a misleading "0.0%".
   */
  private pctCaption(value: number | null | undefined, prefix: string, suffix: string): { prefix: string; emphasis: string; suffix: string } {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { prefix, emphasis: `${value.toFixed(1)}%`, suffix };
    }
    return { prefix: 'No data for this metric yet.', emphasis: '', suffix: '' };
  }

  /**
   * Caption for a count card: a null value (no cards row) renders an honest no-data caption, an
   * explicit 0 renders the card's zero-state copy, and any positive count renders the count copy.
   */
  private countCaption(
    value: number | null,
    zero: { prefix: string; emphasis: string; suffix: string },
    positive: (n: number) => { prefix: string; emphasis: string; suffix: string }
  ): { prefix: string; emphasis: string; suffix: string } {
    if (value === null) return { prefix: 'No data for this metric yet.', emphasis: '', suffix: '' };
    if (value === 0) return zero;
    return positive(value);
  }

  private num(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /** Finite number, or null when the column is absent / SQL NULL — lets callers show no-data instead of a fabricated 0. */
  private numOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private trendSeriesKey(accountId: string | null): string {
    return accountId || '';
  }

  private plural(n: number, singular: string, pluralForm: string): string {
    return n === 1 ? singular : pluralForm;
  }

  private paramSignature(parts: readonly (string | number | boolean | null)[]): string {
    return parts.map((part) => encodeURIComponent(String(part))).join('|');
  }

  private snowflakeQualifier(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed && /^[A-Z0-9_]+(\.[A-Z0-9_]+){1,2}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  private lfxOnePlatinumSchema(): string {
    return this.snowflakeQualifier(process.env['LFX_ONE_PLATINUM_SCHEMA']) ?? DEFAULT_LFX_ONE_PLATINUM_SCHEMA;
  }

  private projectsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECTS`;
  }

  private cardsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_CARDS`;
  }

  private leaderboardTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_LEADERBOARD`;
  }

  private leaderboardBreakdownTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_LEADERBOARD_BREAKDOWN`;
  }

  private activityLeaderboardsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_ACTIVITY_LEADERBOARDS`;
  }

  private trendTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_TREND`;
  }

  private sparklinesTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_SPARKLINES`;
  }

  private trendLifetimeTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_TREND_LIFETIME`;
  }

  private sparklinesLifetimeTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_SPARKLINES_LIFETIME`;
  }

  private bucketSpineTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_INFLUENCE_LIFETIME_BUCKET_SPINE`;
  }

  private platformsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_PLATFORMS`;
  }

  private committeeMembersTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_COMMITTEE_MEMBERS`;
  }

  private certifiedIndividualsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_CERTIFIED_INDIVIDUALS`;
  }

  private eventAttendanceTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_EVENT_ATTENDANCE`;
  }

  private eventSpeakersTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_EVENT_SPEAKERS`;
  }

  private meetingAttendanceTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_MEETING_ATTENDANCE`;
  }

  private eventSponsorshipsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_EVENT_SPONSORSHIPS`;
  }

  private contributorsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_CONTRIBUTORS`;
  }

  private maintainersTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_MAINTAINERS`;
  }

  private collaborationTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_COLLABORATION`;
  }

  private meetupAttendanceTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_MEETUP_ATTENDANCE`;
  }

  private commitsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_COMMITS`;
  }

  private pullRequestsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_PULL_REQUESTS`;
  }

  private avgMergeTimeTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_AVG_MERGE_TIME`;
  }

  private static isLeaderboardBreakdown(value: unknown): value is OrgLeaderboardDetailBreakdown {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLeaderboardDetailBreakdown;
    return (
      typeof candidate.organizationId === 'string' &&
      typeof candidate.totalScore === 'number' &&
      Array.isArray(candidate.categories) &&
      Array.isArray(candidate.withheldCategories)
    );
  }

  private static isRosterPage(value: unknown): value is OrgLensCardRosterPage {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensCardRosterPage;
    return Array.isArray(candidate.rows) && typeof candidate.total === 'number';
  }

  private static isHeroBlock(value: unknown): value is OrgLensHeroBlock {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensHeroBlock;
    if (!candidate.hero || typeof candidate.hero !== 'object' || typeof candidate.isNonLfProject !== 'boolean') return false;
    const { health } = candidate.hero as OrgLensProjectHero;
    return health === null || Object.prototype.hasOwnProperty.call(PD_HEALTH_TAG, health);
  }

  private static isInfluenceBlock(value: unknown): value is OrgLensInfluenceBlock {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensInfluenceBlock;
    return (
      Array.isArray(candidate.technical) &&
      Array.isArray(candidate.ecosystem) &&
      typeof candidate.isNonLfProject === 'boolean' &&
      !!candidate.levels &&
      typeof candidate.levels === 'object'
    );
  }

  private static isTrendBlock(value: unknown): value is OrgLensTrendBlock {
    if (value === null || typeof value !== 'object') return false;
    return Array.isArray((value as OrgLensTrendBlock).trend);
  }

  /**
   * Whether a cached `all` block carries the adaptive-bucket axis, i.e. was written by this version.
   * Pre-deploy entries have no `periods` at all, so the presence of the array is what rejects them.
   * An EMPTY array is accepted on purpose: a project with no rows in the bucket spine legitimately
   * caches `periods: []`, and requiring a non-empty axis would reject that entry on every read and
   * re-query Snowflake for the life of the TTL.
   *
   * Deliberately not gated any tighter. An entry written before the series builder placed values by
   * bucket index still passes, so a misaligned series could be served until the 1h TTL rotates. A
   * cache-key bump would close that window at deploy time, but it would force a cold read for every
   * project, and the largest ones exceed the query timeout on a cold read (LFXV2-3231) — a certain
   * outage traded against a misalignment that requires a sparse row set no project currently has.
   */
  private static hasAdaptivePeriods(value: unknown): boolean {
    const periods = (value as { periods?: unknown }).periods;
    return Array.isArray(periods) && periods.every((label) => typeof label === 'string');
  }

  /**
   * Rows must carry an organization id, not just be an array. Entries cached before the board
   * started serving that id deserialize into a structurally valid page whose rows the drawer cannot
   * be opened from — the row stays focusable and clickable while the click does nothing. Rejecting
   * them here re-fetches from the warehouse and overwrites the entry, so the board self-heals on
   * first read instead of staying inert for the rest of the cache lifetime.
   */
  private static isLeaderboardPage(value: unknown): value is OrgLensLeaderboardPage {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensLeaderboardPage;
    if (!Array.isArray(candidate.rows) || typeof candidate.total !== 'number' || typeof candidate.isNonLfProject !== 'boolean') return false;
    return candidate.rows.every((row) => typeof row?.organizationId === 'string' && row.organizationId.length > 0);
  }

  private static isCardDetailSection(value: unknown): value is OrgLensCardDetailSection {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensCardDetailSection;
    return !!candidate.definition && typeof candidate.definition === 'object' && Array.isArray(candidate.columns) && Array.isArray(candidate.rows);
  }
}
