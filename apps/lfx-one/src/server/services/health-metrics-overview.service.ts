// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_NEWSLETTER_VIEWS,
  HEALTH_METRICS_OVERVIEW_BOARD_COHORT,
  HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP,
  HEALTH_METRICS_OVERVIEW_ENGAGEMENT_SPLIT_RANGES,
  HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP,
  HEALTH_METRICS_OVERVIEW_NEWSLETTERS_ROW_CAP,
  HEALTH_METRICS_OVERVIEW_NPS_AUDIENCE,
} from '@lfx-one/shared/constants';

import { toIsoDate } from '../helpers/date-format.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsOverviewBoard,
  HealthMetricsOverviewBoardAttendance,
  HealthMetricsOverviewBoardMember,
  HealthMetricsOverviewBoardPeriod,
  HealthMetricsOverviewChurn,
  HealthMetricsOverviewChurnPeriod,
  HealthMetricsOverviewChurnTier,
  HealthMetricsOverviewChurnTotals,
  HealthMetricsOverviewCode,
  HealthMetricsOverviewEngagementSplit,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEvents,
  HealthMetricsOverviewNewsletterPeriod,
  HealthMetricsOverviewNewsletters,
  HealthMetricsOverviewNewsletterSend,
  HealthMetricsOverviewNps,
  HealthMetricsOverviewNpsPeriod,
  HealthMetricsOverviewOutstandingBalance,
  HealthMetricsOverviewParticipatingOrgs,
  HealthMetricsOverviewQuery,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const PARTICIPATING_ORGS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_PARTICIPATING_ORGS';
const NPS_BY_AUDIENCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_NPS_BY_AUDIENCE';
const CHURN_OVERVIEW_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_CHURN_OVERVIEW';
const OUTSTANDING_BALANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_OUTSTANDING_BALANCE';
const EVENT_REGISTRATIONS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATIONS';
const PAST_EVENTS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_PAST_EVENTS';
const AT_A_GLANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_AT_A_GLANCE';
const BOARD_ATTENDANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_BOARD_ATTENDANCE';
const BOARD_MEMBERS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_BOARD_ATTENDANCE_MEMBERS';
const OVERVIEW_KPIS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.HEALTH_OVERVIEW_KPIS';

/** Upper-cased Snowflake keys; period columns are aliased `<COLUMN>_<RANGE>`. */
type WideRow = Record<string, unknown>;

/** The fields both event reads select, under the same aliases. */
interface EventRowBase {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  EVENT_CITY: string | null;
  REGISTRATIONS: number | null;
  REGISTRATIONS_GOAL: number | null;
  ACCEPTED_TALKS: number | null;
  TOTAL_PROPOSALS: number | null;
  CFP_STATUS: string | null;
}

interface UpcomingEventRow extends EventRowBase {
  COMP_SCORE: string | null;
}

interface PastEventRow extends EventRowBase {
  HAS_GOAL: boolean | null;
  [periodColumn: string]: unknown;
}

/** Snowflake reads behind the Health Metrics Overview cards; every read is foundation-wide and covers every period. */
export class HealthMetricsOverviewService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Members and non-members in each period, with the engagement split where the view models it. */
  public async getParticipatingOrgs(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewParticipatingOrgs> {
    const counts = ['active_members_count', 'new_members_count', 'non_renewals_count', 'non_members_count'];
    const split = [
      'high_engagement_count',
      'medium_engagement_count',
      'low_engagement_count',
      'high_engagement_pct',
      'medium_engagement_pct',
      'low_engagement_pct',
    ];
    const columns = [
      ...HEALTH_METRICS_L2_RANGES.flatMap((range) => counts.map((column) => periodSelect(column, range))),
      ...HEALTH_METRICS_OVERVIEW_ENGAGEMENT_SPLIT_RANGES.flatMap((range) =>
        ['member', 'non_member'].flatMap((cohort) => split.map((column) => periodSelect(`${cohort}_${column}`, range)))
      ),
    ];

    const sql = `
      SELECT ${columns.join(',\n        ')}
      FROM ${PARTICIPATING_ORGS_VIEW}
      WHERE foundation_slug = ?
      -- One row per foundation_slug, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: PARTICIPATING_ORGS_VIEW,
      operation: 'get_overview_participating_orgs',
      clientMessage: 'Participating organizations are unavailable right now.',
    });

    const row = result.rows[0];
    return {
      measured: !!row,
      periods: byRange((range) => ({
        activeMembers: periodNumber(row, 'ACTIVE_MEMBERS_COUNT', range),
        newMembers: periodNumber(row, 'NEW_MEMBERS_COUNT', range),
        nonRenewals: periodNumber(row, 'NON_RENEWALS_COUNT', range),
        nonMembers: periodNumber(row, 'NON_MEMBERS_COUNT', range),
        memberEngagement: row && HEALTH_METRICS_OVERVIEW_ENGAGEMENT_SPLIT_RANGES.includes(range) ? mapEngagementSplit(row, 'MEMBER', range) : null,
        nonMemberEngagement: row && HEALTH_METRICS_OVERVIEW_ENGAGEMENT_SPLIT_RANGES.includes(range) ? mapEngagementSplit(row, 'NON_MEMBER', range) : null,
      })),
    };
  }

  /** The Board audience's survey as of each period; a period without a survey sent is `null`. */
  public async getNps(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewNps> {
    const columns = HEALTH_METRICS_L2_RANGES.flatMap((range) =>
      [
        'nps_score',
        'nps_score_change_pp',
        'previous_survey_quarter',
        'last_updated_quarter',
        'recipients_count',
        'responses_count',
        'response_rate_pct',
        'promoters_count',
        'passives_count',
        'detractors_count',
        'no_response_count',
      ].map((column) => periodSelect(column, range))
    );

    const sql = `
      SELECT ${columns.join(',\n        ')}
      FROM ${NPS_BY_AUDIENCE_VIEW}
      WHERE foundation_slug = ?
        AND TRIM(audience_type) = ?
      -- One row per foundation_slug and audience, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, sql, [query.foundationSlug, HEALTH_METRICS_OVERVIEW_NPS_AUDIENCE], {
      view: NPS_BY_AUDIENCE_VIEW,
      operation: 'get_overview_nps',
      clientMessage: 'Satisfaction is unavailable right now.',
    });

    const row = result.rows[0];
    return { periods: byRange((range) => mapNpsPeriod(row, range)) };
  }

  /** The foundation's churn and each tier's, in every period; tiers follow the view's rank. */
  public async getChurn(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewChurn> {
    const columns = HEALTH_METRICS_L2_RANGES.flatMap((range) =>
      [
        'churn_rate_pct',
        'churn_rate_pct_prior_year',
        'churn_rate_change_pp',
        'memberships_lost_count',
        'memberships_lost_count_prior_year',
        'memberships_lost_change_pct',
        'value_lost_usd',
        'value_lost_usd_prior_year',
        'value_lost_change_pct',
      ].map((column) => periodSelect(column, range))
    );

    const sql = `
      SELECT
        is_all_tiers,
        membership_tier,
        NULLIF(TRIM(membership_tier_label), '') AS membership_tier_label,
        ${columns.join(',\n        ')}
      FROM ${CHURN_OVERVIEW_VIEW}
      WHERE foundation_slug = ?
        AND (is_all_tiers = TRUE OR NULLIF(TRIM(membership_tier), '') IS NOT NULL)
      ORDER BY is_all_tiers DESC, tier_sort_rank ASC NULLS LAST, membership_tier_label ASC NULLS LAST, membership_tier ASC
    `;

    const result = await executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: CHURN_OVERVIEW_VIEW,
      operation: 'get_overview_churn',
      clientMessage: 'Membership churn is unavailable right now.',
    });

    const all = result.rows.find((row) => row['IS_ALL_TIERS'] === true);
    const tiers = result.rows.filter((row) => row['IS_ALL_TIERS'] !== true);
    return {
      periods: byRange(
        (range): HealthMetricsOverviewChurnPeriod => ({
          totals: all ? mapChurnTotals(all, range) : null,
          tiers: tiers.map((row) => mapChurnTier(row, range)),
        })
      ),
    };
  }

  /** Overdue membership invoices today, split by risk; the view has no period columns. */
  public async getOutstandingBalance(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewOutstandingBalance> {
    const sql = `
      SELECT
        outstanding_balance_usd,
        overdue_members_count,
        high_risk_balance_usd,
        high_risk_members_count,
        high_risk_balance_share_pct,
        medium_risk_balance_usd,
        medium_risk_members_count,
        medium_risk_balance_share_pct
      FROM ${OUTSTANDING_BALANCE_VIEW}
      WHERE foundation_slug = ?
      -- One row per foundation_slug, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: OUTSTANDING_BALANCE_VIEW,
      operation: 'get_overview_outstanding_balance',
      clientMessage: 'Outstanding balance is unavailable right now.',
    });

    const row = result.rows[0];
    return {
      measured: !!row,
      outstandingUsd: toNullableNumber(row?.['OUTSTANDING_BALANCE_USD']),
      overdueMembers: toNullableNumber(row?.['OVERDUE_MEMBERS_COUNT']),
      highRiskUsd: toNullableNumber(row?.['HIGH_RISK_BALANCE_USD']),
      highRiskMembers: toNullableNumber(row?.['HIGH_RISK_MEMBERS_COUNT']),
      highRiskSharePct: toNullableNumber(row?.['HIGH_RISK_BALANCE_SHARE_PCT']),
      mediumRiskUsd: toNullableNumber(row?.['MEDIUM_RISK_BALANCE_USD']),
      mediumRiskMembers: toNullableNumber(row?.['MEDIUM_RISK_MEMBERS_COUNT']),
      mediumRiskSharePct: toNullableNumber(row?.['MEDIUM_RISK_BALANCE_SHARE_PCT']),
    };
  }

  /**
   * Upcoming events soonest first, and every past event in a period newest first. Each list is its own read, so
   * a cap drops the furthest-out upcoming and the oldest past events, never the other list.
   */
  public async getEvents(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewEvents> {
    const [upcoming, past] = await Promise.all([this.getUpcomingEvents(req, query), this.getPastEvents(req, query)]);
    const truncated = upcoming.length > HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP || past.length > HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP;
    if (truncated) {
      logger.warning(req, 'get_overview_events', 'Overview events hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP,
      });
    }

    return {
      upcoming: upcoming.slice(0, HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP).map(mapUpcomingEvent),
      past: past.slice(0, HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP).map(mapPastEvent),
      truncated,
    };
  }

  /** The board's meetings and average attendance in each period, plus every member invited in any period. */
  public async getBoard(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewBoard> {
    const summaryColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) =>
      ['meetings_in_range_count', 'meetings_in_range_count_change_pct', 'avg_org_attendance_pct', 'avg_org_attendance_change_pct'].map((column) =>
        periodSelect(column, range)
      )
    );
    const memberColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) =>
      ['meetings_invited_count', 'meetings_attended_count', 'attendance_pct'].map((column) => periodSelect(column, range))
    );
    const invitedInAnyPeriod = HEALTH_METRICS_L2_RANGES.map((range) => `meetings_invited_count_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} > 0`).join(
      ' OR '
    );

    const summarySql = `
      SELECT ${summaryColumns.join(',\n        ')}
      FROM ${BOARD_ATTENDANCE_VIEW}
      WHERE foundation_slug = ?
        AND attendance_cohort = ?
      -- One row per foundation_slug and cohort, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;
    const membersSql = `
      SELECT
        _key AS member_key,
        NULLIF(TRIM(person_display_name), '') AS person_display_name,
        NULLIF(TRIM(person_job_title), '') AS person_job_title,
        NULLIF(TRIM(account_name), '') AS account_name,
        NULLIF(TRIM(logo_url), '') AS logo_url,
        last_attended_date,
        ${memberColumns.join(',\n        ')}
      FROM ${BOARD_MEMBERS_VIEW}
      WHERE foundation_slug = ?
        AND NULLIF(TRIM(person_display_name), '') IS NOT NULL
        AND (${invitedInAnyPeriod})
      ORDER BY person_display_name ASC, _key ASC
      LIMIT ${HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP + 1}
    `;
    const options = { operation: 'get_overview_board', clientMessage: 'Board meeting participation is unavailable right now.' };

    const [summary, members] = await Promise.all([
      executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, summarySql, [query.foundationSlug, HEALTH_METRICS_OVERVIEW_BOARD_COHORT], {
        ...options,
        view: BOARD_ATTENDANCE_VIEW,
      }),
      executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, membersSql, [query.foundationSlug], { ...options, view: BOARD_MEMBERS_VIEW }),
    ]);

    if (members.rows.length > HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP) {
      logger.warning(req, 'get_overview_board', 'Overview board members hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP,
      });
    }

    const row = summary.rows[0];
    return {
      periods: byRange((range) => (row ? mapBoardPeriod(row, range) : null)),
      members: members.rows.slice(0, HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP).map(mapBoardMember),
    };
  }

  /** Contributors in each period, and the all-time role counts. */
  public async getCode(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewCode> {
    const columns = HEALTH_METRICS_L2_RANGES.flatMap((range) => ['contributors_count', 'new_contributors_count'].map((column) => periodSelect(column, range)));

    const sql = `
      SELECT
        ${columns.join(',\n        ')},
        committers_count_all_time,
        maintainers_count_all_time,
        reviewers_count_all_time
      FROM ${OVERVIEW_KPIS_VIEW}
      WHERE foundation_slug = ?
      -- One row per foundation_slug, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: OVERVIEW_KPIS_VIEW,
      operation: 'get_overview_code',
      clientMessage: 'Code contribution is unavailable right now.',
    });

    const row = result.rows[0];
    return {
      measured: !!row,
      periods: byRange((range) => ({
        contributors: periodNumber(row, 'CONTRIBUTORS_COUNT', range),
        newContributors: periodNumber(row, 'NEW_CONTRIBUTORS_COUNT', range),
      })),
      committers: toNullableNumber(row?.['COMMITTERS_COUNT_ALL_TIME']),
      maintainers: toNullableNumber(row?.['MAINTAINERS_COUNT_ALL_TIME']),
      reviewers: toNullableNumber(row?.['REVIEWERS_COUNT_ALL_TIME']),
    };
  }

  /** The newsletter summary for each period, and every newsletter with engagement data, latest first. */
  public async getNewsletters(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewNewsletters> {
    const columns = HEALTH_METRICS_L2_RANGES.flatMap((range) =>
      [
        'subscribers_count',
        'subscribers_growth_pct',
        'subscribers_growth_baseline_date',
        'newsletters_sent_count',
        'avg_open_rate',
        'avg_click_to_open_rate',
        'high_engagement_subscribers_count',
        'medium_engagement_subscribers_count',
        'low_engagement_subscribers_count',
        'high_engagement_subscribers_pct',
        'medium_engagement_subscribers_pct',
        'low_engagement_subscribers_pct',
        'engagement_newsletters_considered_count',
        'most_engaging_newsletter_name',
        'most_engaging_newsletter_click_to_open_rate',
      ].map((column) => periodSelect(column, range))
    );

    const summarySql = `
      SELECT
        ${columns.join(',\n        ')}
      FROM ${HEALTH_METRICS_NEWSLETTER_VIEWS.summary}
      WHERE foundation_slug = ?
      -- One row per foundation_slug, so LIMIT 1 has nothing to pick between.
      LIMIT 1
    `;
    const newslettersSql = `
      SELECT
        newsletter_key,
        newsletter_name,
        sent_date,
        open_rate,
        click_rate
      FROM ${HEALTH_METRICS_NEWSLETTER_VIEWS.byNewsletter}
      WHERE foundation_slug = ?
        AND has_engagement_data = TRUE
      -- Latest first, so a capped read keeps the newest; the card puts them back in date order.
      ORDER BY sent_date DESC NULLS LAST, newsletter_key ASC
      LIMIT ${HEALTH_METRICS_OVERVIEW_NEWSLETTERS_ROW_CAP + 1}
    `;

    const [summary, sends] = await Promise.all([
      executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, summarySql, [query.foundationSlug], {
        view: HEALTH_METRICS_NEWSLETTER_VIEWS.summary,
        operation: 'get_overview_newsletters',
        clientMessage: 'Newsletter engagement is unavailable right now.',
      }),
      executeSnowflakeViewRead<WideRow>(this.snowflakeService, req, newslettersSql, [query.foundationSlug], {
        view: HEALTH_METRICS_NEWSLETTER_VIEWS.byNewsletter,
        operation: 'get_overview_newsletters',
        clientMessage: 'Newsletter engagement is unavailable right now.',
      }),
    ]);

    if (sends.rows.length > HEALTH_METRICS_OVERVIEW_NEWSLETTERS_ROW_CAP) {
      logger.warning(req, 'get_overview_newsletters', 'Overview newsletters hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_OVERVIEW_NEWSLETTERS_ROW_CAP,
      });
    }

    const row = summary.rows[0];
    return {
      measured: !!row,
      periods: byRange((range) => (row ? mapNewsletterPeriod(row, range) : null)),
      newsletters: sends.rows
        .slice(0, HEALTH_METRICS_OVERVIEW_NEWSLETTERS_ROW_CAP)
        .map(mapNewsletterSend)
        .filter((send): send is HealthMetricsOverviewNewsletterSend => send !== null),
    };
  }

  /** The registrations view keys events by foundation id, so the slug resolves through the at-a-glance rollup. */
  private async getUpcomingEvents(req: Request, query: HealthMetricsOverviewQuery): Promise<UpcomingEventRow[]> {
    const sql = `
      WITH foundation AS (
        SELECT DISTINCT foundation_id
        FROM ${AT_A_GLANCE_VIEW}
        WHERE foundation_slug = ?
          AND is_all_projects = TRUE
      )
      SELECT
        r.event_id,
        r.event_name,
        r.event_start_date,
        r.event_end_date,
        NULLIF(TRIM(r.event_city), '') AS event_city,
        r.count_registrations_all_time AS registrations,
        r.event_registrations_goal AS registrations_goal,
        NULLIF(TRIM(r.comp_score), '') AS comp_score,
        r.accepted_speaker_proposals_all_time AS accepted_talks,
        r.total_speaker_proposals_all_time AS total_proposals,
        NULLIF(TRIM(r.cfp_status), '') AS cfp_status
      FROM ${EVENT_REGISTRATIONS_VIEW} r
      INNER JOIN foundation f ON r.project_id = f.foundation_id
      WHERE NULLIF(TRIM(r.event_id), '') IS NOT NULL
        AND r.event_is_past = FALSE
      ORDER BY r.event_start_date ASC NULLS LAST, r.event_name ASC NULLS LAST, r.event_id ASC
      LIMIT ${HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<UpcomingEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: EVENT_REGISTRATIONS_VIEW,
      operation: 'get_overview_events',
      clientMessage: 'Events are unavailable right now.',
    });
    return result.rows;
  }

  /** Driven by the past-events view, as the Events tab reads it; the registrations view only adds city, dates and talks. */
  private async getPastEvents(req: Request, query: HealthMetricsOverviewQuery): Promise<PastEventRow[]> {
    const inPeriodColumns = HEALTH_METRICS_L2_RANGES.map((range) => `p.is_in_period_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} AS is_in_period_${range}`);
    const inAnyPeriod = HEALTH_METRICS_L2_RANGES.map((range) => `p.is_in_period_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} = TRUE`).join(' OR ');

    const sql = `
      SELECT
        p.event_id,
        p.event_name,
        p.event_start_date,
        r.event_end_date,
        NULLIF(TRIM(r.event_city), '') AS event_city,
        p.registrations_count AS registrations,
        p.event_registrations_goal AS registrations_goal,
        p.has_registrations_goal AS has_goal,
        r.accepted_speaker_proposals_all_time AS accepted_talks,
        r.total_speaker_proposals_all_time AS total_proposals,
        NULLIF(TRIM(r.cfp_status), '') AS cfp_status,
        ${inPeriodColumns.join(',\n        ')}
      FROM ${PAST_EVENTS_VIEW} p
      LEFT JOIN ${EVENT_REGISTRATIONS_VIEW} r
        ON r.event_id = p.event_id
        AND r.project_id = p.foundation_id
      WHERE p.foundation_slug = ?
        AND p.is_all_projects = TRUE
        AND NULLIF(TRIM(p.event_id), '') IS NOT NULL
        AND (${inAnyPeriod})
      ORDER BY p.event_start_date DESC NULLS LAST, p.event_name ASC NULLS LAST, p.event_id ASC
      LIMIT ${HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<PastEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: PAST_EVENTS_VIEW,
      operation: 'get_overview_events',
      clientMessage: 'Events are unavailable right now.',
    });
    return result.rows;
  }
}

/** `<column>_<suffix> AS <column>_<RANGE>`; both halves come from fixed maps, never from the request. */
function periodSelect(column: string, range: HealthMetricsL2Range): string {
  return `${column}_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} AS ${column}_${range}`;
}

function periodNumber(row: WideRow | undefined, column: string, range: HealthMetricsL2Range): number | null {
  return toNullableNumber(row?.[`${column}_${range}`]);
}

function periodText(row: WideRow | undefined, column: string, range: HealthMetricsL2Range): string | null {
  const value = row?.[`${column}_${range}`];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function byRange<T>(build: (range: HealthMetricsL2Range) => T): Record<HealthMetricsL2Range, T> {
  return Object.fromEntries(HEALTH_METRICS_L2_RANGES.map((range) => [range, build(range)])) as Record<HealthMetricsL2Range, T>;
}

function mapEngagementSplit(row: WideRow, cohort: 'MEMBER' | 'NON_MEMBER', range: HealthMetricsL2Range): HealthMetricsOverviewEngagementSplit {
  return {
    highCount: periodNumber(row, `${cohort}_HIGH_ENGAGEMENT_COUNT`, range),
    mediumCount: periodNumber(row, `${cohort}_MEDIUM_ENGAGEMENT_COUNT`, range),
    lowCount: periodNumber(row, `${cohort}_LOW_ENGAGEMENT_COUNT`, range),
    highPct: periodNumber(row, `${cohort}_HIGH_ENGAGEMENT_PCT`, range),
    mediumPct: periodNumber(row, `${cohort}_MEDIUM_ENGAGEMENT_PCT`, range),
    lowPct: periodNumber(row, `${cohort}_LOW_ENGAGEMENT_PCT`, range),
  };
}

/** Matches the Members tab: an audience with no recipients in the period was not surveyed. */
function mapNpsPeriod(row: WideRow | undefined, range: HealthMetricsL2Range): HealthMetricsOverviewNpsPeriod | null {
  const recipientsCount = periodNumber(row, 'RECIPIENTS_COUNT', range);
  if (!row || !recipientsCount || recipientsCount <= 0) return null;

  return {
    npsScore: periodNumber(row, 'NPS_SCORE', range),
    scoreChangePp: periodNumber(row, 'NPS_SCORE_CHANGE_PP', range),
    previousSurveyQuarter: periodText(row, 'PREVIOUS_SURVEY_QUARTER', range),
    lastUpdatedQuarter: periodText(row, 'LAST_UPDATED_QUARTER', range),
    recipientsCount,
    responsesCount: periodNumber(row, 'RESPONSES_COUNT', range),
    responseRatePct: periodNumber(row, 'RESPONSE_RATE_PCT', range),
    promotersCount: periodNumber(row, 'PROMOTERS_COUNT', range),
    passivesCount: periodNumber(row, 'PASSIVES_COUNT', range),
    detractorsCount: periodNumber(row, 'DETRACTORS_COUNT', range),
    noResponseCount: periodNumber(row, 'NO_RESPONSE_COUNT', range),
  };
}

function mapChurnTotals(row: WideRow, range: HealthMetricsL2Range): HealthMetricsOverviewChurnTotals {
  return {
    churnRatePct: periodNumber(row, 'CHURN_RATE_PCT', range),
    churnRatePctPriorYear: periodNumber(row, 'CHURN_RATE_PCT_PRIOR_YEAR', range),
    churnRateChangePp: periodNumber(row, 'CHURN_RATE_CHANGE_PP', range),
    membershipsLost: periodNumber(row, 'MEMBERSHIPS_LOST_COUNT', range),
    membershipsLostPriorYear: periodNumber(row, 'MEMBERSHIPS_LOST_COUNT_PRIOR_YEAR', range),
    membershipsLostChangePct: periodNumber(row, 'MEMBERSHIPS_LOST_CHANGE_PCT', range),
    valueLostUsd: periodNumber(row, 'VALUE_LOST_USD', range),
    valueLostUsdPriorYear: periodNumber(row, 'VALUE_LOST_USD_PRIOR_YEAR', range),
    valueLostChangePct: periodNumber(row, 'VALUE_LOST_CHANGE_PCT', range),
  };
}

function mapChurnTier(row: WideRow, range: HealthMetricsL2Range): HealthMetricsOverviewChurnTier {
  const tier = String(row['MEMBERSHIP_TIER']);
  return {
    tier,
    label: typeof row['MEMBERSHIP_TIER_LABEL'] === 'string' ? row['MEMBERSHIP_TIER_LABEL'] : tier,
    churnRatePct: periodNumber(row, 'CHURN_RATE_PCT', range),
    membershipsLost: periodNumber(row, 'MEMBERSHIPS_LOST_COUNT', range),
    valueLostUsd: periodNumber(row, 'VALUE_LOST_USD', range),
  };
}

/** The fields both lists share. */
function mapEventBase(row: EventRowBase): Omit<HealthMetricsOverviewEvent, 'registrationsGoal' | 'compScore' | 'ranges'> {
  const eventId = String(row.EVENT_ID);
  return {
    eventId,
    eventName: row.EVENT_NAME?.trim() || eventId,
    startDate: toIsoDate(row.EVENT_START_DATE),
    endDate: toIsoDate(row.EVENT_END_DATE),
    city: row.EVENT_CITY,
    registrations: toNullableNumber(row.REGISTRATIONS),
    acceptedTalks: toNullableNumber(row.ACCEPTED_TALKS),
    totalProposals: toNullableNumber(row.TOTAL_PROPOSALS),
    cfpStatus: row.CFP_STATUS,
  };
}

/** A goal of zero or less is no goal. */
function mapUpcomingEvent(row: UpcomingEventRow): HealthMetricsOverviewEvent {
  return {
    ...mapEventBase(row),
    registrationsGoal: positiveOrNull(toNullableNumber(row.REGISTRATIONS_GOAL)),
    compScore: row.COMP_SCORE?.toLowerCase() ?? null,
    ranges: [],
  };
}

/** The past-events view's own flag decides "no goal", as on the Events tab. */
function mapPastEvent(row: PastEventRow): HealthMetricsOverviewEvent {
  return {
    ...mapEventBase(row),
    registrationsGoal: row.HAS_GOAL === true ? toNullableNumber(row.REGISTRATIONS_GOAL) : null,
    compScore: null,
    ranges: HEALTH_METRICS_L2_RANGES.filter((range) => row[`IS_IN_PERIOD_${range}`] === true),
  };
}

function mapBoardPeriod(row: WideRow, range: HealthMetricsL2Range): HealthMetricsOverviewBoardPeriod {
  return {
    meetings: periodNumber(row, 'MEETINGS_IN_RANGE_COUNT', range),
    meetingsChangePct: periodNumber(row, 'MEETINGS_IN_RANGE_COUNT_CHANGE_PCT', range),
    avgAttendancePct: periodNumber(row, 'AVG_ORG_ATTENDANCE_PCT', range),
    avgAttendanceChangePct: periodNumber(row, 'AVG_ORG_ATTENDANCE_CHANGE_PCT', range),
  };
}

/** The view writes `Unavailable` for a missing job title, which is no title at all. */
function mapBoardMember(row: WideRow): HealthMetricsOverviewBoardMember {
  const attendance: Partial<Record<HealthMetricsL2Range, HealthMetricsOverviewBoardAttendance>> = {};
  for (const range of HEALTH_METRICS_L2_RANGES) {
    const invited = periodNumber(row, 'MEETINGS_INVITED_COUNT', range);
    if (invited !== null && invited > 0) {
      attendance[range] = { invited, attended: periodNumber(row, 'MEETINGS_ATTENDED_COUNT', range), attendancePct: periodNumber(row, 'ATTENDANCE_PCT', range) };
    }
  }

  const jobTitle = typeof row['PERSON_JOB_TITLE'] === 'string' ? row['PERSON_JOB_TITLE'] : null;
  return {
    key: String(row['MEMBER_KEY']),
    name: String(row['PERSON_DISPLAY_NAME']),
    jobTitle: jobTitle && jobTitle.toLowerCase() !== 'unavailable' ? jobTitle : null,
    organization: typeof row['ACCOUNT_NAME'] === 'string' ? row['ACCOUNT_NAME'] : null,
    logoUrl: typeof row['LOGO_URL'] === 'string' ? row['LOGO_URL'] : null,
    lastAttendedDate: toIsoDate(row['LAST_ATTENDED_DATE'] as Date | string | null),
    attendance,
  };
}

function mapNewsletterPeriod(row: WideRow, range: HealthMetricsL2Range): HealthMetricsOverviewNewsletterPeriod {
  return {
    subscribers: periodNumber(row, 'SUBSCRIBERS_COUNT', range),
    subscribersGrowth: periodNumber(row, 'SUBSCRIBERS_GROWTH_PCT', range),
    growthBaselineDate: toIsoDate(row[`SUBSCRIBERS_GROWTH_BASELINE_DATE_${range}`] as Date | string | null),
    newslettersSent: periodNumber(row, 'NEWSLETTERS_SENT_COUNT', range),
    avgOpenRate: periodNumber(row, 'AVG_OPEN_RATE', range),
    avgClickToOpenRate: periodNumber(row, 'AVG_CLICK_TO_OPEN_RATE', range),
    highEngagement: periodNumber(row, 'HIGH_ENGAGEMENT_SUBSCRIBERS_COUNT', range),
    mediumEngagement: periodNumber(row, 'MEDIUM_ENGAGEMENT_SUBSCRIBERS_COUNT', range),
    lowEngagement: periodNumber(row, 'LOW_ENGAGEMENT_SUBSCRIBERS_COUNT', range),
    highEngagementShare: periodNumber(row, 'HIGH_ENGAGEMENT_SUBSCRIBERS_PCT', range),
    mediumEngagementShare: periodNumber(row, 'MEDIUM_ENGAGEMENT_SUBSCRIBERS_PCT', range),
    lowEngagementShare: periodNumber(row, 'LOW_ENGAGEMENT_SUBSCRIBERS_PCT', range),
    newslettersConsidered: periodNumber(row, 'ENGAGEMENT_NEWSLETTERS_CONSIDERED_COUNT', range),
    mostEngagingName: periodText(row, 'MOST_ENGAGING_NEWSLETTER_NAME', range),
    mostEngagingClickToOpenRate: periodNumber(row, 'MOST_ENGAGING_NEWSLETTER_CLICK_TO_OPEN_RATE', range),
  };
}

/** A newsletter without a key cannot be told apart from another, so it is dropped. */
function mapNewsletterSend(row: WideRow): HealthMetricsOverviewNewsletterSend | null {
  const key = typeof row['NEWSLETTER_KEY'] === 'string' ? row['NEWSLETTER_KEY'].trim() : '';
  if (!key) return null;
  const name = typeof row['NEWSLETTER_NAME'] === 'string' ? row['NEWSLETTER_NAME'].trim() : '';

  return {
    key,
    name: name || 'Untitled newsletter',
    sentDate: toIsoDate(row['SENT_DATE'] as Date | string | null),
    openRate: toNullableNumber(row['OPEN_RATE']),
    clickRate: toNullableNumber(row['CLICK_RATE']),
  };
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
