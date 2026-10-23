// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_OVERVIEW_BOARD_COHORT,
  HEALTH_METRICS_OVERVIEW_BOARD_MEMBERS_ROW_CAP,
  HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP,
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

/** The view models the engagement split for these periods only. */
const ENGAGEMENT_SPLIT_RANGES: readonly HealthMetricsL2Range[] = ['YTD', 'COMPLETED_YEAR'];

/** Upper-cased Snowflake keys; period columns are aliased `<COLUMN>_<RANGE>`. */
type WideRow = Record<string, unknown>;

interface EventRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  EVENT_CITY: string | null;
  EVENT_IS_PAST: boolean | null;
  REGISTRATIONS: number | null;
  REGISTRATIONS_GOAL: number | null;
  COMP_SCORE: string | null;
  ACCEPTED_TALKS: number | null;
  TOTAL_PROPOSALS: number | null;
  CFP_STATUS: string | null;
  PAST_REGISTRATIONS: number | null;
  PAST_GOAL: number | null;
  PAST_HAS_GOAL: boolean | null;
  PAST_GOAL_MET: boolean | null;
  PAST_PACE_STATUS: string | null;
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
      ...ENGAGEMENT_SPLIT_RANGES.flatMap((range) =>
        ['member', 'non_member'].flatMap((cohort) => split.map((column) => periodSelect(`${cohort}_${column}`, range)))
      ),
    ];

    const sql = `
      SELECT ${columns.join(',\n        ')}
      FROM ${PARTICIPATING_ORGS_VIEW}
      WHERE foundation_slug = ?
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
        memberEngagement: row && ENGAGEMENT_SPLIT_RANGES.includes(range) ? mapEngagementSplit(row, 'MEMBER', range) : null,
        nonMemberEngagement: row && ENGAGEMENT_SPLIT_RANGES.includes(range) ? mapEngagementSplit(row, 'NON_MEMBER', range) : null,
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
   * Upcoming events plus every past event in a period, with the closed event's goal outcome joined from the
   * past-events view so its status matches the Events tab.
   */
  public async getEvents(req: Request, query: HealthMetricsOverviewQuery): Promise<HealthMetricsOverviewEvents> {
    const inPeriodColumns = HEALTH_METRICS_L2_RANGES.map((range) => `p.is_in_period_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} AS is_in_period_${range}`);
    const inAnyPeriod = HEALTH_METRICS_L2_RANGES.map((range) => `p.is_in_period_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} = TRUE`).join(' OR ');

    // The registrations view keys events by foundation id, so the slug resolves through the at-a-glance rollup.
    const sql = `
      WITH foundation AS (
        SELECT DISTINCT foundation_id
        FROM ${AT_A_GLANCE_VIEW}
        WHERE foundation_slug = ?
          AND is_all_projects = TRUE
      ),
      past AS (
        SELECT *
        FROM ${PAST_EVENTS_VIEW}
        WHERE foundation_slug = ?
          AND is_all_projects = TRUE
      )
      SELECT
        r.event_id,
        r.event_name,
        r.event_start_date,
        r.event_end_date,
        NULLIF(TRIM(r.event_city), '') AS event_city,
        r.event_is_past,
        r.count_registrations_all_time AS registrations,
        r.event_registrations_goal AS registrations_goal,
        NULLIF(TRIM(r.comp_score), '') AS comp_score,
        r.accepted_speaker_proposals_all_time AS accepted_talks,
        r.total_speaker_proposals_all_time AS total_proposals,
        NULLIF(TRIM(r.cfp_status), '') AS cfp_status,
        p.registrations_count AS past_registrations,
        p.event_registrations_goal AS past_goal,
        p.has_registrations_goal AS past_has_goal,
        p.is_registrations_goal_met AS past_goal_met,
        p.pace_status AS past_pace_status,
        ${inPeriodColumns.join(',\n        ')}
      FROM ${EVENT_REGISTRATIONS_VIEW} r
      INNER JOIN foundation f ON r.project_id = f.foundation_id
      LEFT JOIN past p ON p.event_id = r.event_id
      WHERE NULLIF(TRIM(r.event_id), '') IS NOT NULL
        AND (r.event_is_past = FALSE OR ${inAnyPeriod})
      ORDER BY r.event_start_date ASC NULLS LAST, r.event_name ASC NULLS LAST, r.event_id ASC
      LIMIT ${HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<EventRow>(this.snowflakeService, req, sql, [query.foundationSlug, query.foundationSlug], {
      view: EVENT_REGISTRATIONS_VIEW,
      operation: 'get_overview_events',
      clientMessage: 'Events are unavailable right now.',
    });

    const truncated = result.rows.length > HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP;
    if (truncated) {
      logger.warning(req, 'get_overview_events', 'Overview events hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP,
      });
    }

    const rows = result.rows.slice(0, HEALTH_METRICS_OVERVIEW_EVENTS_ROW_CAP);
    return {
      upcoming: rows.filter((row) => row.EVENT_IS_PAST === false).map(mapUpcomingEvent),
      // Read soonest first, so the past list reverses to newest first.
      past: rows
        .filter((row) => row.EVENT_IS_PAST !== false)
        .map(mapPastEvent)
        .reverse(),
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

/** The fields both lists share; a goal of zero or less is no goal. */
function mapEventBase(
  row: EventRow
): Omit<HealthMetricsOverviewEvent, 'registrations' | 'registrationsGoal' | 'compScore' | 'goalMet' | 'paceStatus' | 'ranges'> {
  const eventId = String(row.EVENT_ID);
  return {
    eventId,
    eventName: row.EVENT_NAME?.trim() || eventId,
    startDate: toIsoDate(row.EVENT_START_DATE),
    endDate: toIsoDate(row.EVENT_END_DATE),
    city: row.EVENT_CITY,
    acceptedTalks: toNullableNumber(row.ACCEPTED_TALKS),
    totalProposals: toNullableNumber(row.TOTAL_PROPOSALS),
    cfpStatus: row.CFP_STATUS,
  };
}

function mapUpcomingEvent(row: EventRow): HealthMetricsOverviewEvent {
  const goal = toNullableNumber(row.REGISTRATIONS_GOAL);
  return {
    ...mapEventBase(row),
    registrations: toNullableNumber(row.REGISTRATIONS),
    registrationsGoal: goal !== null && goal > 0 ? goal : null,
    compScore: row.COMP_SCORE?.toLowerCase() ?? null,
    goalMet: null,
    paceStatus: null,
    ranges: [],
  };
}

/** Past figures come from the past-events view, as the Events tab reads them; its own flag decides "no goal". */
function mapPastEvent(row: EventRow): HealthMetricsOverviewEvent {
  const hasGoal = row.PAST_HAS_GOAL === true;
  return {
    ...mapEventBase(row),
    registrations: toNullableNumber(row.PAST_REGISTRATIONS) ?? toNullableNumber(row.REGISTRATIONS),
    registrationsGoal: hasGoal ? toNullableNumber(row.PAST_GOAL) : null,
    compScore: null,
    goalMet: hasGoal && row.PAST_GOAL_MET !== null ? row.PAST_GOAL_MET === true : null,
    paceStatus: hasGoal ? row.PAST_PACE_STATUS : null,
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

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
