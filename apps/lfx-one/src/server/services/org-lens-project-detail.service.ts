// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_LFX_ONE_PLATINUM_SCHEMA, PD_HEALTH_TAG, PD_TIME_RANGE_TYPE, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgLensCardDetailCell,
  OrgLensCardDetailRow,
  OrgLensCardDetailSection,
  OrgLensCardRosterPage,
  OrgLensHeroBlock,
  OrgLensInfluenceBlock,
  OrgLensLeaderboardBlock,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
  OrgLensProjectHealth,
  OrgLensProjectHero,
  OrgLensProjectInfluenceCard,
  OrgLensProjectLeaderboardRow,
  OrgLensProjectTrendSeries,
  OrgLensTrendBlock,
} from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, classifyHealthScore } from '@lfx-one/shared/utils';

import { toIsoDate } from '../helpers/date-format.helper';
import { buildOrgCacheKey, valkeyService } from './valkey.service';
import { SnowflakeService } from './snowflake.service';

interface HeroRow {
  PROJECT_NAME: string;
  PROJECT_SLUG: string;
  PROJECT_LOGO_URL: string | null;
  FOUNDATION_NAME: string | null;
  IS_LF_PROJECT: boolean | null;
  DESCRIPTION: string | null;
  HEALTH_OVERALL_SCORE: number | null;
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
  ORG_ACCOUNT_ID: string | null;
  ORG_NAME: string | null;
  ORG_LOGO_URL: string | null;
  ACTIVITY_TOTAL: number | null;
  ACTIVITY_PCT: number | null;
  RANK: number | null;
}

interface LeaderboardRow {
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
  ACTIVITY_CONTRIBUTIONS: number | null;
  ACTIVITY_CONTRIBUTIONS_PCT: number | null;
  ACTIVITY_COLLABORATIONS: number | null;
  ACTIVITY_COLLABORATIONS_PCT: number | null;
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
  // single "All others" band server-side so the chart still reflects the FULL project-wide
  // influence distribution (a raw top-N truncation would drop the tail and inflate the leaders'
  // normalized shares on projects with many orgs).
  private static readonly trendNamedOrgCap = 10;

  // Sparklines are emitted as a dense, contiguous, current-month-anchored monthly array; the
  // shipped component maps points to a fixed 36-month label axis by position and slices per range.
  private static readonly sparklineMonths = 36;

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
      const cached = await valkeyService.getJson<OrgLensInfluenceBlock>(key, OrgLensProjectDetailService.isInfluenceBlock);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;
    const isNonLf = heroRow.IS_LF_PROJECT !== true;
    const foundationLabel = heroRow.FOUNDATION_NAME ?? 'Outside LF';

    const [cardRows, sparkRows, leaderboardRows] = await Promise.all([
      this.fetchCards(orgUid, slug, timeRangeType),
      this.fetchSparklines(orgUid, slug),
      this.fetchLeaderboard(orgUid, slug, timeRangeType).catch(() => [] as LeaderboardRow[]),
    ]);

    const cards = cardRows[0] ?? null;
    const sparklineIndex = this.buildSparklineIndex(sparkRows);
    const monthAxis = this.monthAxis();
    const viewing = leaderboardRows.find((row) => row.ORG_ACCOUNT_ID === orgUid) ?? null;

    const block: OrgLensInfluenceBlock = {
      technical: this.buildTechnicalCards(cards, sparklineIndex, monthAxis),
      ecosystem: this.buildEcosystemCards(cards, heroRow.PROJECT_NAME, foundationLabel, isNonLf, sparklineIndex, monthAxis),
      isNonLfProject: isNonLf,
      levels: {
        technical: viewing ? (this.mapBand(viewing.LEVEL_TECHNICAL) ?? 'silent') : null,
        ecosystem: isNonLf || !viewing ? null : (this.mapBand(viewing.LEVEL_ECOSYSTEM) ?? 'silent'),
      },
    };
    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  public async getTrendBlock(orgUid: string, projectSlug: string): Promise<OrgLensTrendBlock | null> {
    const slug = projectSlug.trim().toLowerCase();
    const key = buildOrgCacheKey(orgUid, `project-detail-trend:${this.paramSignature([slug])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensTrendBlock>(key, OrgLensProjectDetailService.isTrendBlock);
      if (cached !== null) return cached;
    }

    // Gate on the (org, slug) catalog row like every other block, so project-wide trend is not
    // served for a project the org has no activity on (and the 404 stays consistent across blocks).
    const [heroRow, trendRows] = await Promise.all([this.fetchHeroRow(orgUid, slug), this.fetchTrend(slug)]);
    if (!heroRow) return null;

    const block: OrgLensTrendBlock = { trend: this.buildTrendSeries(this.buildTrendByAccount(trendRows)) };
    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  public async getTechnicalBoard(orgUid: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Promise<OrgLensLeaderboardBlock | null> {
    return this.fetchLeaderboardBlock(orgUid, projectSlug, range, 'technical');
  }

  public async getEcosystemBoard(orgUid: string, projectSlug: string, range: OrgLensLeaderboardTimeRange): Promise<OrgLensLeaderboardBlock | null> {
    return this.fetchLeaderboardBlock(orgUid, projectSlug, range, 'ecosystem');
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

  private async fetchLeaderboardBlock(
    orgUid: string,
    projectSlug: string,
    range: OrgLensLeaderboardTimeRange,
    dimension: 'technical' | 'ecosystem'
  ): Promise<OrgLensLeaderboardBlock | null> {
    const slug = projectSlug.trim().toLowerCase();
    const timeRangeType = PD_TIME_RANGE_TYPE[range];
    const key = buildOrgCacheKey(orgUid, `project-detail-board-${dimension}:${this.paramSignature([slug, range])}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensLeaderboardBlock>(key, OrgLensProjectDetailService.isLeaderboardBlock);
      if (cached !== null) return cached;
    }

    const heroRow = await this.fetchHeroRow(orgUid, slug);
    if (!heroRow) return null;
    const isNonLf = heroRow.IS_LF_PROJECT !== true;

    const [leaderboardRows, activityBoardRows] = await Promise.all([
      this.fetchLeaderboard(orgUid, slug, timeRangeType),
      this.fetchActivityLeaderboards(orgUid, slug, timeRangeType),
    ]);

    const trendByAccount = new Map<string, TrendSeries>();
    const activityLeaderboards = this.mapActivityLeaderboards(activityBoardRows, orgUid, trendByAccount);
    const block: OrgLensLeaderboardBlock = {
      influence: leaderboardRows.map((row) => this.mapLeaderboardRow(row, orgUid, isNonLf, trendByAccount)),
      activity: dimension === 'technical' ? activityLeaderboards.contributions : activityLeaderboards.collaborations,
      isNonLfProject: isNonLf,
    };
    if (key !== null) {
      await valkeyService.setJson(key, block, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return block;
  }

  private async fetchHeroRow(orgUid: string, slug: string): Promise<HeroRow | null> {
    const result = await this.snowflakeService.execute<HeroRow>(
      `
        SELECT PROJECT_NAME, PROJECT_SLUG, PROJECT_LOGO_URL, FOUNDATION_NAME, IS_LF_PROJECT,
               DESCRIPTION, HEALTH_OVERALL_SCORE, SOFTWARE_VALUE, FIRST_COMMIT_TS
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

  private async fetchTrend(slug: string): Promise<TrendRow[]> {
    const result = await this.snowflakeService.execute<TrendRow>(
      `
        SELECT ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, SPAN_MONTH, COMBINED_INFLUENCE_SCORE
        FROM ${this.trendTable()}
        WHERE PROJECT_SLUG = ?
        ORDER BY ACCOUNT_ID, SPAN_MONTH ASC
      `,
      [slug]
    );
    return result.rows;
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

  /** Group flat trend rows into per-org series (combined oldest → newest). */
  private buildTrendByAccount(rows: TrendRow[]): Map<string, TrendSeries> {
    const byAccount = new Map<string, TrendSeries>();
    for (const row of rows) {
      const accountId = row.ACCOUNT_ID;
      if (!accountId) continue;
      let series = byAccount.get(accountId);
      if (!series) {
        series = { accountId, orgName: row.ORG_NAME ?? '', orgLogoUrl: row.ORG_LOGO_URL ?? '', combined: [] };
        byAccount.set(accountId, series);
      }
      series.combined.push(this.round1(this.num(row.COMBINED_INFLUENCE_SCORE)));
    }
    return byAccount;
  }

  /**
   * Wire trend payload: the top-N orgs by most-recent-month combined score as individual series,
   * plus a single "All others" series that sums EVERY remaining org month-by-month. Folding the
   * complete tail (rather than truncating it) keeps the payload bounded while preserving the true
   * project-wide distribution the client normalizes to 100%.
   */
  private buildTrendSeries(byAccount: Map<string, TrendSeries>): OrgLensProjectTrendSeries[] {
    const latest = (series: TrendSeries): number => series.combined[series.combined.length - 1] ?? 0;
    const sorted = [...byAccount.values()].sort((a, b) => latest(b) - latest(a));
    const named = sorted.slice(0, OrgLensProjectDetailService.trendNamedOrgCap);
    const rest = sorted.slice(OrgLensProjectDetailService.trendNamedOrgCap);

    const series: OrgLensProjectTrendSeries[] = named.map((s) => ({
      accountId: s.accountId,
      orgName: s.orgName,
      orgLogoUrl: s.orgLogoUrl,
      combined: s.combined,
    }));

    if (rest.length > 0) {
      const len = rest.reduce((max, s) => Math.max(max, s.combined.length), 0);
      const combined = Array.from({ length: len }, (_, i) => this.round1(rest.reduce((sum, s) => sum + (s.combined[i] ?? 0), 0)));
      series.push({ accountId: '', orgName: 'All others', orgLogoUrl: '', combined });
    }

    return series;
  }

  private async fetchActivityLeaderboards(orgUid: string, slug: string, timeRangeType: string): Promise<ActivityBoardRow[]> {
    const sql = (viewerClause: string): string => `
      SELECT BOARD_TYPE, ORG_ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, ACTIVITY_TOTAL, ACTIVITY_PCT, RANK
      FROM ${this.activityLeaderboardsTable()}
      WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ${viewerClause}
      ORDER BY BOARD_TYPE ASC, RANK ASC
    `;
    const orgIdResult = await this.snowflakeService.execute<{ ORG_ORGANIZATION_ID: string }>(
      `
        SELECT ORG_ORGANIZATION_ID
        FROM ${this.leaderboardTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ORG_ACCOUNT_ID = ?
        LIMIT 1
      `,
      [slug, timeRangeType, orgUid]
    );
    const viewerOrgId = orgIdResult.rows[0]?.ORG_ORGANIZATION_ID;
    if (viewerOrgId) {
      const viewer = await this.snowflakeService.execute<ActivityBoardRow>(sql('MY_ORGANIZATION_ID = ?'), [slug, timeRangeType, viewerOrgId]);
      if (viewer.rows.length > 0) {
        return viewer.rows;
      }
    }
    const fallback = await this.snowflakeService.execute<ActivityBoardRow>(sql('MY_ORGANIZATION_ID IS NULL'), [slug, timeRangeType]);
    return fallback.rows;
  }

  private mapActivityLeaderboards(
    rows: ActivityBoardRow[],
    orgUid: string,
    trendByAccount: Map<string, TrendSeries>
  ): {
    contributions: OrgLensProjectLeaderboardRow[];
    collaborations: OrgLensProjectLeaderboardRow[];
  } {
    const contributions: OrgLensProjectLeaderboardRow[] = [];
    const collaborations: OrgLensProjectLeaderboardRow[] = [];
    for (const row of rows) {
      const mapped = this.mapActivityBoardRow(row, orgUid, trendByAccount);
      if (row.BOARD_TYPE === 'contributions') {
        contributions.push(mapped);
      } else if (row.BOARD_TYPE === 'collaborations') {
        collaborations.push(mapped);
      }
    }
    return { contributions, collaborations };
  }

  private mapActivityBoardRow(row: ActivityBoardRow, orgUid: string, trendByAccount: Map<string, TrendSeries>): OrgLensProjectLeaderboardRow {
    const isContributions = row.BOARD_TYPE === 'contributions';
    const total = Math.round(this.num(row.ACTIVITY_TOTAL));
    const pct = this.round1(this.num(row.ACTIVITY_PCT));
    const series = row.ORG_ACCOUNT_ID ? (trendByAccount.get(row.ORG_ACCOUNT_ID)?.combined ?? []) : [];
    const trendSparkline = this.trendSparkline12(series);
    return {
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
      trendSparkline,
      trendDeltaPct: this.yoyDelta(series),
      // Leave undefined when the warehouse RANK is absent so the client falls back to positional
      // order instead of rendering "#0" (num() would coerce a NULL rank to 0).
      warehouseRank: this.numOrNull(row.RANK) === null ? undefined : Math.round(this.num(row.RANK)),
      isViewingOrg: row.ORG_ACCOUNT_ID === orgUid,
    };
  }

  private async fetchLeaderboard(orgUid: string, slug: string, timeRangeType: string): Promise<LeaderboardRow[]> {
    const sql = (viewerClause: string): string => `
      SELECT ORG_ACCOUNT_ID, ORG_NAME, ORG_LOGO_URL, SCORE_COMBINED, SCORE_TECHNICAL, SCORE_ECOSYSTEM,
             LEVEL_COMBINED, LEVEL_TECHNICAL, LEVEL_ECOSYSTEM, RANK,
             ACTIVITY_CONTRIBUTIONS, ACTIVITY_CONTRIBUTIONS_PCT,
             ACTIVITY_COLLABORATIONS, ACTIVITY_COLLABORATIONS_PCT
      FROM ${this.leaderboardTable()}
      WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ${viewerClause}
      ORDER BY RANK ASC
    `;
    const orgIdResult = await this.snowflakeService.execute<{ ORG_ORGANIZATION_ID: string }>(
      `
        SELECT ORG_ORGANIZATION_ID
        FROM ${this.leaderboardTable()}
        WHERE PROJECT_SLUG = ? AND TIME_RANGE_TYPE = ? AND ORG_ACCOUNT_ID = ?
        LIMIT 1
      `,
      [slug, timeRangeType, orgUid]
    );
    const viewerOrgId = orgIdResult.rows[0]?.ORG_ORGANIZATION_ID;
    if (viewerOrgId) {
      const viewer = await this.snowflakeService.execute<LeaderboardRow>(sql('MY_ORGANIZATION_ID = ?'), [slug, timeRangeType, viewerOrgId]);
      if (viewer.rows.length > 0) {
        return viewer.rows;
      }
    }
    const fallback = await this.snowflakeService.execute<LeaderboardRow>(sql('MY_ORGANIZATION_ID IS NULL'), [slug, timeRangeType]);
    return fallback.rows;
  }

  private mapHero(row: HeroRow, slug: string, foundationLabel: string): OrgLensProjectHero {
    return {
      projectName: row.PROJECT_NAME,
      description: row.DESCRIPTION ?? `${row.PROJECT_NAME} is an open source project in the ${foundationLabel} ecosystem.`,
      logoUrl: row.PROJECT_LOGO_URL ?? '',
      lfxInsightsUrl: buildInsightsUrl(`/project/${slug}`),
      firstCommit: toIsoDate(row.FIRST_COMMIT_TS),
      softwareValueUsd: row.SOFTWARE_VALUE ?? null,
      health: this.mapHealth(row.HEALTH_OVERALL_SCORE),
      foundationLabel,
    };
  }

  private mapHealth(score: number | null): OrgLensProjectHealth | null {
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

  private mapLeaderboardRow(row: LeaderboardRow, orgUid: string, isNonLf: boolean, trendByAccount: Map<string, TrendSeries>): OrgLensProjectLeaderboardRow {
    const series = row.ORG_ACCOUNT_ID ? (trendByAccount.get(row.ORG_ACCOUNT_ID)?.combined ?? []) : [];
    return {
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
      activityCount: {
        contributions: Math.round(this.num(row.ACTIVITY_CONTRIBUTIONS)),
        collaborations: Math.round(this.num(row.ACTIVITY_COLLABORATIONS)),
        contributionsPct: this.round1(this.num(row.ACTIVITY_CONTRIBUTIONS_PCT)),
        collaborationsPct: this.round1(this.num(row.ACTIVITY_COLLABORATIONS_PCT)),
      },
      trendSparkline: this.trendSparkline12(series),
      trendDeltaPct: this.yoyDelta(series),
      isViewingOrg: row.ORG_ACCOUNT_ID === orgUid,
    };
  }

  // Per §DN7 the leaderboard trend column is a fixed trailing-12-month series paired with a
  // 1-year delta — independent of the ?range= toggle (which scopes scores/activity counts, not
  // this sparkline). Always take the last 12 monthly points (oldest → newest).
  private trendSparkline12(series: number[]): number[] {
    return series.slice(-12);
  }

  /** Year-over-year delta as a signed fraction from a monthly combined series (last vs 12 months prior). */
  private yoyDelta(series: number[]): number {
    if (series.length < 13) return 0;
    const last = series[series.length - 1];
    const prior = series[series.length - 13];
    if (prior === 0) return 0;
    return Math.round(((last - prior) / prior) * 1000) / 1000;
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

  private activityLeaderboardsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_ACTIVITY_LEADERBOARDS`;
  }

  private trendTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_TREND`;
  }

  private sparklinesTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_DETAIL_SPARKLINES`;
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

  private static isLeaderboardBlock(value: unknown): value is OrgLensLeaderboardBlock {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensLeaderboardBlock;
    return Array.isArray(candidate.influence) && Array.isArray(candidate.activity) && typeof candidate.isNonLfProject === 'boolean';
  }

  private static isCardDetailSection(value: unknown): value is OrgLensCardDetailSection {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as OrgLensCardDetailSection;
    return !!candidate.definition && typeof candidate.definition === 'object' && Array.isArray(candidate.columns) && Array.isArray(candidate.rows);
  }
}
