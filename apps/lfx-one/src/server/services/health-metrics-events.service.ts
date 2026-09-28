// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPARED_RANGES,
  HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED,
  HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_PAGE_SIZE,
  HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP,
  HEALTH_METRICS_EVENTS_REVENUE_COMPARED_RANGES,
  HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP,
  HEALTH_METRICS_EVENTS_SPEAKERS_COMPARED_RANGES,
  HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
  HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS,
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_L2_RANGES,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsAtAGlanceQuery,
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurveQuery,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastQuery,
  HealthMetricsEventsOrganization,
  HealthMetricsEventsOrganizations,
  HealthMetricsEventsOrganizationsQuery,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsPastPeriod,
  HealthMetricsEventsPastQuery,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthQuery,
  HealthMetricsEventsRegistrationsGrowthYear,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsRevenueEvent,
  HealthMetricsEventsRevenuePeriod,
  HealthMetricsEventsRevenueQuery,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersOrganization,
  HealthMetricsEventsSpeakersPeriod,
  HealthMetricsEventsSpeakersPeriodCount,
  HealthMetricsEventsSpeakersProposal,
  HealthMetricsEventsSpeakersQuery,
  HealthMetricsEventsSpeakersStatusGroup,
  HealthMetricsL2Range,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const REGISTRATION_FORECAST_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATION_FORECAST';
const PAST_EVENTS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_PAST_EVENTS';
const AT_A_GLANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_AT_A_GLANCE';
const REGISTRATIONS_GROWTH_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATIONS_GROWTH';
const REVENUE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REVENUE';
const OVERVIEW_REVENUE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.HEALTH_OVERVIEW_REVENUE';
const SPEAKERS_DRILLDOWN_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_SPEAKER_PROPOSALS_ORG_DRILLDOWN';
const SPEAKERS_LIST_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_SPEAKER_PROPOSALS_LIST';
const ORGANIZATIONS_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MARKETING_EVENT_REGISTRATIONS_ORG_OVERVIEW';

/**
 * Mirrors dbt's `health_metrics_period_filter`, which the headline totals use. The view has no
 * per-event period flags yet; once it does, read those columns and delete this.
 */
const REVENUE_PERIOD_PREDICATES: Record<HealthMetricsL2Range, string> = {
  YTD: "event_start_date >= DATE_TRUNC('YEAR', CURRENT_DATE()) AND event_start_date < CURRENT_DATE()",
  COMPLETED_YEAR: completedYearPredicate(1),
  COMPLETED_YEAR_2: completedYearPredicate(2),
  COMPLETED_YEAR_3: completedYearPredicate(3),
};

/** Revenue headline metrics, each suffixed per period; the change columns reuse them. */
const REVENUE_METRICS = ['total', 'registration', 'sponsorship'] as const;

/** At-a-glance count prefixes, each suffixed per period; the change columns reuse them. */
const AT_A_GLANCE_COUNT_PREFIXES = ['registrations', 'attendees', 'organizations', 'speakers', 'countries', 'events', 'past_events'] as const;

/** Speakers count prefixes, each suffixed per period. */
const SPEAKERS_COUNT_PREFIXES = ['proposals_submitted', 'proposals_accepted', 'proposals_in_review', 'proposals_declined', 'speakers'] as const;

/** Organization counts, each suffixed per period; any one above zero makes the organization active. */
const ORGANIZATIONS_ACTIVITY_COLUMNS = ['registrations_count', 'sponsorship_revenue', 'proposals_count', 'speakers_count', 'events_count'] as const;

/** Label for a curve row the view left without a registration type. */
const UNTYPED_FORMAT_LABEL = 'All formats';

/** True when the Events views carry columns for the range; for a controller to check before binding. */
export function isSupportedEventsRange(range: string): range is HealthMetricsL2Range {
  return Object.prototype.hasOwnProperty.call(HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, range);
}

interface ForecastEventRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  FORECAST_AVG: number | null;
  FORECAST_LOW: number | null;
  FORECAST_HIGH: number | null;
  REGISTRATIONS_NOW: number | null;
  PRIOR_YEAR_SAME_POINT: number | null;
  GOAL: number | null;
  DAYS_LEFT: number | null;
  IS_NEW_EVENT: boolean | null;
}

interface ForecastCurveRow {
  DAYS_TO_EVENT: number | null;
  EVENT_REGISTRATION_TYPE: string | null;
  PRED_TYPE: string | null;
  FORECAST_AVG: number | null;
  FORECAST_LOW: number | null;
  FORECAST_HIGH: number | null;
  PRIOR_YEAR: number | null;
}

/** Per-period columns (`IS_IN_PERIOD_<SUFFIX>`, `SCOPE_*_<SUFFIX>`) are read by name off the suffix map. */
interface PastEventRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  REGISTRATIONS: number | null;
  GOAL: number | null;
  HAS_GOAL: boolean | null;
  GOAL_MET: boolean | null;
  REVENUE_USD: number | null;
  PACE_STATUS: string | null;
  [periodColumn: string]: unknown;
}

/** One foundation's rollup row; every column is period-suffixed except the upcoming count. */
interface AtAGlanceRow {
  UPCOMING_EVENTS_COUNT_CURRENT_YEAR: number | null;
  [periodColumn: string]: unknown;
}

interface RegistrationsGrowthRow {
  YEAR: number | null;
  IS_PARTIAL_YEAR: boolean | null;
  TOTAL_REGISTRATIONS: number | null;
  IN_PERSON_REGISTRATIONS: number | null;
  VIRTUAL_REGISTRATIONS: number | null;
  TOTAL_ATTENDEES: number | null;
  IN_PERSON_ATTENDEES: number | null;
  VIRTUAL_ATTENDEES: number | null;
}

/** Per-event revenue plus the foundation headline, which repeats on every row; `IN_PERIOD_<SUFFIX>` is computed in the read. */
interface RevenueRow {
  EVENT_ID: string | null;
  EVENT_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  REGISTRATION_REVENUE_USD: number | null;
  SPONSORSHIP_REVENUE_USD: number | null;
  REGISTRATION_REVENUE_GOAL: number | null;
  SPONSORSHIP_REVENUE_GOAL: number | null;
  HAS_UNCONVERTED_REGISTRATION_REVENUE: boolean | null;
  HAS_UNCONVERTED_REVENUE_GOAL: boolean | null;
  [periodColumn: string]: unknown;
}

/** The foundation scope row, a ranked organization or the unaffiliated row; every count is period-suffixed. */
interface SpeakersDrilldownRow {
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  IS_ALL_ORGANIZATIONS: boolean | null;
  IS_UNAFFILIATED_ORGANIZATION: boolean | null;
  [periodColumn: string]: unknown;
}

/** One proposal; `PERIOD` is computed in the read. The job title is personal data, so it is never logged. */
interface SpeakerProposalRow {
  PROPOSAL_KEY: string | null;
  PERIOD: HealthMetricsL2Range | null;
  ACCOUNT_NAME: string | null;
  JOB_TITLE: string | null;
  EVENT_NAME: string | null;
  SESSION_TITLE: string | null;
  SUBMISSION_DATE: Date | string | null;
  SUBMISSION_STATUS_ORIGINAL: string | null;
  PROPOSAL_STATUS_GROUP: string | null;
  IS_UNAFFILIATED_PROPOSAL: boolean | null;
}

/** One page row joined onto the totals; the period columns are aliased unsuffixed in the read. */
interface OrganizationRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number | null;
  IS_PAGE_ROW: boolean | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  LOGO_URL: string | null;
  IS_MEMBER: boolean | null;
  REGISTRATIONS_COUNT: number | null;
  REGISTRATIONS_SHARE: number | null;
  SPONSORSHIP_REVENUE: number | null;
  PROPOSALS_COUNT: number | null;
  SPEAKERS_COUNT: number | null;
  EVENTS_COUNT: number | null;
  SORT_RANK: number | null;
}

/** The foundation's Events revenue from the overview view, which carries no split. */
type OverviewRevenueRow = Record<string, unknown>;

/** The Events tab's view reads, one method per section, each through `executeSnowflakeViewRead`. */
export class HealthMetricsEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Every upcoming event's event-wide headline. The headline columns repeat on every curve row, so
   * one modeled row per event is read; the model is a snapshot of now, so no period applies.
   */
  public async getRegistrationForecast(req: Request, query: HealthMetricsEventsForecastQuery): Promise<HealthMetricsEventsForecast> {
    // The start-date filter keeps an event whose day has passed out even before the model drops it.
    // First edition is flagged per format, so an event is new only when all of its formats are.
    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        event_forecast_registrations_avg AS forecast_avg,
        event_forecast_registrations_low AS forecast_low,
        event_forecast_registrations_high AS forecast_high,
        final_current_cumulative_registrations AS registrations_now,
        event_registrations_prior_year_same_point AS prior_year_same_point,
        event_registrations_goal AS goal,
        days_left,
        BOOLAND_AGG(is_new_event) OVER (PARTITION BY event_id) AS is_new_event
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_start_date >= CURRENT_DATE()
      QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY event_registration_type ASC NULLS LAST, pred_type ASC, days_to_event ASC) = 1
      ORDER BY event_start_date ASC, event_name ASC NULLS LAST, event_id ASC
      LIMIT ${HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<ForecastEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: REGISTRATION_FORECAST_VIEW,
      operation: 'get_events_registration_forecast',
      clientMessage: 'The registration forecast is unavailable right now.',
    });

    // Reading one past the cap is what separates a scope of exactly the cap from a truncated one.
    if (result.rows.length > HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP) {
      logger.warning(req, 'get_events_registration_forecast', 'Upcoming event rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP,
      });
    }

    const events = result.rows
      .slice(0, HEALTH_METRICS_EVENTS_FORECAST_EVENT_CAP)
      .map(mapForecastEvent)
      .filter((event): event is HealthMetricsEventsForecastEvent => event !== null);

    return { events };
  }

  /**
   * One event's pacing curve, one series per registration format — In Person and Virtual need not
   * cover the same days, so summing them per day would understate any day one side has no row.
   */
  public async getRegistrationForecastCurve(req: Request, query: HealthMetricsEventsForecastCurveQuery): Promise<HealthMetricsEventsForecastCurve> {
    // One event under the all-projects cut is one row per format, `pred_type` and day, so no roll-up.
    const sql = `
      SELECT
        days_to_event,
        event_registration_type,
        pred_type,
        cumulative_avg_predicted_registrations AS forecast_avg,
        cumulative_low_predicted_registrations AS forecast_low,
        cumulative_high_predicted_registrations AS forecast_high,
        prior_event_cumulative_registrations AS prior_year
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_id = ?
        AND event_start_date >= CURRENT_DATE()
      ORDER BY event_registration_type ASC NULLS LAST, days_to_event ASC
    `;

    const result = await executeSnowflakeViewRead<ForecastCurveRow>(this.snowflakeService, req, sql, [query.foundationSlug, query.eventId], {
      view: REGISTRATION_FORECAST_VIEW,
      operation: 'get_events_registration_forecast_curve',
      clientMessage: 'The registration forecast curve is unavailable right now.',
    });

    if (result.rows.length === 0) return HEALTH_METRICS_EVENTS_FORECAST_CURVE_UNMEASURED;

    return { eventId: query.eventId, formats: groupCurveRows(result.rows) };
  }

  /**
   * Every closed event in the four periods, with each period's header totals. The headers repeat on
   * every row, so they come off the first; the client picks the period, so one read serves all four.
   */
  public async getPastEvents(req: Request, query: HealthMetricsEventsPastQuery): Promise<HealthMetricsEventsPast> {
    // Suffixes come from a constant map, never from the request, so interpolating them is safe.
    const suffixes = HEALTH_METRICS_L2_RANGES.map((range) => HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]);
    const periodColumns = suffixes
      .map((suffix) => `is_in_period_${suffix}, scope_past_events_count_${suffix}, scope_registrations_count_${suffix}`)
      .join(',\n        ');
    const inAnyPeriod = suffixes.map((suffix) => `is_in_period_${suffix}`).join(' OR ');

    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        registrations_count AS registrations,
        event_registrations_goal AS goal,
        has_registrations_goal AS has_goal,
        is_registrations_goal_met AS goal_met,
        total_event_revenue_usd AS revenue_usd,
        pace_status,
        ${periodColumns}
      FROM ${PAST_EVENTS_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND (${inAnyPeriod})
      ORDER BY event_start_date DESC NULLS LAST, event_name ASC NULLS LAST, event_id ASC
      LIMIT ${HEALTH_METRICS_EVENTS_PAST_EVENT_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<PastEventRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: PAST_EVENTS_VIEW,
      operation: 'get_events_past',
      clientMessage: 'Past events are unavailable right now.',
    });

    // A read that succeeds with no rows is a measured zero in every period, not an unmeasured one.
    if (result.rows.length === 0) {
      return { periods: HEALTH_METRICS_L2_RANGES.map((range) => ({ range, eventCount: 0, registrations: 0 })), events: [] };
    }

    if (result.rows.length > HEALTH_METRICS_EVENTS_PAST_EVENT_CAP) {
      logger.warning(req, 'get_events_past', 'Past event rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_PAST_EVENT_CAP,
      });
    }

    const events = result.rows
      .slice(0, HEALTH_METRICS_EVENTS_PAST_EVENT_CAP)
      .map(mapPastEvent)
      .filter((event): event is HealthMetricsEventsPastEvent => event !== null);

    return { periods: HEALTH_METRICS_L2_RANGES.map((range) => mapPastPeriod(result.rows[0], range)), events };
  }

  /** The foundation's reach in each of the four periods, off its one precomputed rollup row; a rollup with no events falls back to `hasAnyEvent`. */
  public async getAtAGlance(req: Request, query: HealthMetricsEventsAtAGlanceQuery): Promise<HealthMetricsEventsAtAGlance> {
    // Prefixes and suffixes come from constants, never from the request, so interpolating them is safe.
    const periodColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) => {
      const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range];
      const columns = [...AT_A_GLANCE_COUNT_PREFIXES.map((prefix) => `${prefix}_count_${suffix}`), `show_up_rate_${suffix}`];
      if (!HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPARED_RANGES.includes(range)) return columns;

      const changes = AT_A_GLANCE_COUNT_PREFIXES.filter((prefix) => prefix !== 'past_events').map((prefix) => `${prefix}_change_pct_${suffix}`);
      return [...columns, ...changes, `show_up_rate_change_pts_${suffix}`];
    }).join(',\n        ');

    const sql = `
      SELECT
        upcoming_events_count_current_year,
        ${periodColumns}
      FROM ${AT_A_GLANCE_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<AtAGlanceRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: AT_A_GLANCE_VIEW,
      operation: 'get_events_at_a_glance',
      clientMessage: 'Events at a glance is unavailable right now.',
    });

    const row = result.rows[0];
    // No row is a slug the rollup does not seed, a measured zero; the event check still decides.
    if (!row) {
      logger.debug(req, 'get_events_at_a_glance', 'No at-a-glance row for the foundation', { foundation_slug: query.foundationSlug });
      const hasEvents = await this.hasAnyEvent(req, query);
      return { periods: HEALTH_METRICS_L2_RANGES.map(buildZeroAtAGlancePeriod), upcomingEvents: 0, hasEvents };
    }

    const periods = HEALTH_METRICS_L2_RANGES.map((range) => mapAtAGlancePeriod(row, range));
    const upcomingEvents = toNullableNumber(row.UPCOMING_EVENTS_COUNT_CURRENT_YEAR);
    // An unmeasured count could hide an event, so only measured zeros everywhere read as none held.
    const eventCounts = [upcomingEvents, ...periods.map((period) => period.events)];

    const hasEvents = eventCounts.some((value) => value !== 0) || (await this.hasAnyEvent(req, query));

    return { periods, upcomingEvents, hasEvents };
  }

  /**
   * Each period's revenue headline and every event in the four periods. Events outside every period sort
   * last so the headline still has a row to come off, and are dropped before the table sees them.
   */
  public async getRevenue(req: Request, query: HealthMetricsEventsRevenueQuery): Promise<HealthMetricsEventsRevenue> {
    // Metrics, suffixes and predicates come from constants, never from the request, so interpolating them is safe.
    const periodColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) => {
      const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range];
      const columns = [
        ...REVENUE_METRICS.map((metric) => `foundation_${metric}_revenue_usd_${suffix}`),
        `foundation_registration_revenue_share_pct_${suffix}`,
        `foundation_sponsorship_revenue_share_pct_${suffix}`,
        `foundation_has_unconverted_registration_revenue_${suffix}`,
        `(${REVENUE_PERIOD_PREDICATES[range]}) AS in_period_${suffix}`,
      ];
      if (!HEALTH_METRICS_EVENTS_REVENUE_COMPARED_RANGES.includes(range)) return columns;

      return [...columns, ...REVENUE_METRICS.map((metric) => `foundation_${metric}_revenue_change_pct_${suffix}`)];
    }).join(',\n        ');
    const inAnyPeriod = HEALTH_METRICS_L2_RANGES.map((range) => `(${REVENUE_PERIOD_PREDICATES[range]})`).join(' OR ');

    const sql = `
      SELECT
        event_id,
        event_name,
        event_start_date,
        registration_revenue_usd,
        sponsorship_revenue_usd,
        registration_revenue_goal,
        sponsorship_revenue_goal,
        has_unconverted_registration_revenue,
        has_unconverted_revenue_goal,
        ${periodColumns}
      FROM ${REVENUE_VIEW}
      WHERE foundation_slug = ?
      ORDER BY IFF(${inAnyPeriod}, 0, 1), event_start_date DESC NULLS LAST, event_name ASC NULLS LAST, event_id ASC
      LIMIT ${HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<RevenueRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: REVENUE_VIEW,
      operation: 'get_events_revenue',
      clientMessage: 'Event revenue is unavailable right now.',
    });

    const row = result.rows[0];
    if (!row) {
      logger.debug(req, 'get_events_revenue', 'No event revenue rows for the foundation', { foundation_slug: query.foundationSlug });
      return { periods: await this.getOverviewRevenuePeriods(req, query), events: [], eventsMeasured: false };
    }

    // In-period events sort first, so the list lost one only when the first row past the cap is in a period.
    const dropped = result.rows[HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP];
    if (dropped && HEALTH_METRICS_L2_RANGES.some((range) => dropped[periodColumn('IN_PERIOD', range)] === true)) {
      logger.warning(req, 'get_events_revenue', 'Event revenue rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP,
      });
    }

    const events = result.rows
      .slice(0, HEALTH_METRICS_EVENTS_REVENUE_EVENT_CAP)
      .map(mapRevenueEvent)
      .filter((event): event is HealthMetricsEventsRevenueEvent => event !== null && event.ranges.length > 0);

    return { periods: HEALTH_METRICS_L2_RANGES.map((range) => mapRevenuePeriod(row, range)), events, eventsMeasured: true };
  }

  /** Each period's proposal pipeline, the top organizations and the latest proposals per period and tab. */
  public async getSpeakers(req: Request, query: HealthMetricsEventsSpeakersQuery): Promise<HealthMetricsEventsSpeakers> {
    const [drilldown, proposals] = await Promise.all([this.getSpeakersDrilldown(req, query), this.getSpeakerProposals(req, query)]);
    const scope = drilldown.find((row) => row.IS_ALL_ORGANIZATIONS === true);
    if (!scope) {
      logger.debug(req, 'get_events_speakers', 'No speaker proposals scope row for the foundation', { foundation_slug: query.foundationSlug });
    }

    return {
      periods: scope ? HEALTH_METRICS_L2_RANGES.map((range) => mapSpeakersPeriod(scope, range)) : [],
      organizations: drilldown
        .filter((row) => row.IS_ALL_ORGANIZATIONS !== true && row.IS_UNAFFILIATED_ORGANIZATION !== true)
        .map(mapSpeakersOrganization)
        .filter((organization): organization is HealthMetricsEventsSpeakersOrganization => organization !== null),
      unaffiliated: mapSpeakersUnaffiliated(drilldown.find((row) => row.IS_UNAFFILIATED_ORGANIZATION === true)),
      proposals: proposals.map(mapSpeakerProposal).filter((proposal): proposal is HealthMetricsEventsSpeakersProposal => proposal !== null),
    };
  }

  /**
   * One page of the organizations active in the period, ranked by the view's `sort_rank_<period>`
   * (registrations first) so the ranking survives pagination.
   */
  public async getOrganizations(req: Request, query: HealthMetricsEventsOrganizationsQuery): Promise<HealthMetricsEventsOrganizations> {
    // The suffix and column names come from constants, never from the request, so interpolating them is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const active = ORGANIZATIONS_ACTIVITY_COLUMNS.map((column) => `${column}_${suffix} > 0`).join(' OR ');
    const binds: string[] = [query.foundationSlug];

    const predicates: string[] = [];
    if (query.segment === 'members') predicates.push('is_member = TRUE');
    if (query.segment === 'non-members') predicates.push('COALESCE(is_member, FALSE) = FALSE');
    if (query.search) {
      predicates.push("account_name ILIKE ? ESCAPE '!'");
      binds.push(`%${escapeSqlLikePattern(query.search)}%`);
    }
    const matchClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';

    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_EVENTS_ORGANIZATIONS_MAX_PAGE_SIZE, HEALTH_METRICS_EVENTS_ORGANIZATIONS_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    // Totals are joined onto the page rather than read as `COUNT(*) OVER()`, so a page past the end still reports them.
    const sql = `
      WITH scoped AS (
        SELECT
          account_id,
          account_name,
          logo_url,
          is_member_${suffix} AS is_member,
          registrations_count_${suffix} AS registrations_count,
          registrations_share_of_scope_max_${suffix} AS registrations_share,
          sponsorship_revenue_${suffix} AS sponsorship_revenue,
          proposals_count_${suffix} AS proposals_count,
          speakers_count_${suffix} AS speakers_count,
          events_count_${suffix} AS events_count,
          sort_rank_${suffix} AS sort_rank
        FROM ${ORGANIZATIONS_VIEW}
        WHERE foundation_slug = ?
          AND is_all_projects = TRUE
          AND account_id IS NOT NULL
          AND (${active})
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT (SELECT COUNT(*) FROM scoped) AS scope_total, (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        SELECT *, TRUE AS is_page_row
        FROM matched
        -- account_id breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY sort_rank ASC NULLS LAST, account_id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.account_id ASC
    `;

    const result = await executeSnowflakeViewRead<OrganizationRow>(this.snowflakeService, req, sql, binds, {
      view: ORGANIZATIONS_VIEW,
      operation: 'get_events_organizations',
      clientMessage: 'Organizations at events are unavailable right now.',
    });

    const first = result.rows[0];
    return {
      rows: result.rows
        .filter((row) => row.IS_PAGE_ROW === true)
        .map(mapOrganization)
        .filter((organization): organization is HealthMetricsEventsOrganization => organization !== null),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
    };
  }

  /** Every year the foundation held events, oldest first; the section always shows the full history, so no period applies. */
  public async getRegistrationsGrowth(req: Request, query: HealthMetricsEventsRegistrationsGrowthQuery): Promise<HealthMetricsEventsRegistrationsGrowth> {
    const sql = `
      SELECT
        year,
        is_partial_year,
        total_registrations,
        in_person_registrations,
        virtual_registrations,
        total_attendees,
        in_person_attendees,
        virtual_attendees
      FROM ${REGISTRATIONS_GROWTH_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
      ORDER BY year ASC
      LIMIT ${HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<RegistrationsGrowthRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: REGISTRATIONS_GROWTH_VIEW,
      operation: 'get_events_registrations_growth',
      clientMessage: 'Registrations and growth are unavailable right now.',
    });

    if (result.rows.length > HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP) {
      logger.warning(req, 'get_events_registrations_growth', 'Registrations growth rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP,
      });
    }

    const kept = result.rows.slice(0, HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_YEAR_CAP);
    const years = kept.map(mapRegistrationsGrowthYear).filter((year): year is HealthMetricsEventsRegistrationsGrowthYear => year !== null);

    // A dropped year would otherwise vanish from the chart without a trace of the bad row.
    if (years.length < kept.length) {
      logger.warning(req, 'get_events_registrations_growth', 'Registrations growth rows dropped for a missing or implausible year', {
        foundation_slug: query.foundationSlug,
        dropped_count: kept.length - years.length,
        min_year: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR,
        max_year: new Date().getUTCFullYear() + HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD,
      });
    }

    return { years };
  }

  /** The scope row, the unaffiliated row and every organization ranked in the top few for any period. */
  private async getSpeakersDrilldown(req: Request, query: HealthMetricsEventsSpeakersQuery): Promise<SpeakersDrilldownRow[]> {
    // Prefixes, suffixes and the cap come from constants, never from the request, so interpolating them is safe.
    const periodColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) => {
      const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range];
      const columns = [...SPEAKERS_COUNT_PREFIXES.map((prefix) => `${prefix}_count_${suffix}`), `acceptance_rate_${suffix}`, `sort_rank_${suffix}`];
      return HEALTH_METRICS_EVENTS_SPEAKERS_COMPARED_RANGES.includes(range) ? [...columns, `speakers_count_change_pct_${suffix}`] : columns;
    }).join(',\n        ');
    const ranked = HEALTH_METRICS_L2_RANGES.map(
      (range) => `sort_rank_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} <= ${HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS}`
    ).join(' OR ');

    const sql = `
      SELECT
        account_id,
        account_name,
        is_all_organizations,
        is_unaffiliated_organization,
        ${periodColumns}
      FROM ${SPEAKERS_DRILLDOWN_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND (is_all_organizations = TRUE OR is_unaffiliated_organization = TRUE OR ${ranked})
    `;

    const result = await executeSnowflakeViewRead<SpeakersDrilldownRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: SPEAKERS_DRILLDOWN_VIEW,
      operation: 'get_events_speakers',
      clientMessage: 'Speakers and proposals are unavailable right now.',
    });
    return result.rows;
  }

  /** The latest few proposals per period, overall and for each tab's status group, so every tab fills without another read. */
  private async getSpeakerProposals(req: Request, query: HealthMetricsEventsSpeakersQuery): Promise<SpeakerProposalRow[]> {
    // Flags, ranges, groups and the cap come from constants, never from the request, so interpolating them is safe.
    const periodCase = HEALTH_METRICS_L2_RANGES.map((range) => `WHEN is_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} THEN '${range}'`).join(' ');
    const inAnyPeriod = HEALTH_METRICS_L2_RANGES.map((range) => `is_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]}`).join(' OR ');
    const tabGroups = HEALTH_METRICS_EVENTS_SPEAKERS_TAB_OPTIONS.flatMap(({ id }) => (id === 'all' ? [] : [id]))
      .map((group) => `'${HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[group].viewValue}'`)
      .join(', ');
    const cap = HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS;
    // Day first, then key, as the client sorts; a raw timestamp would break same-day ties by time of day.
    const recency = 'TO_DATE(submission_date) DESC NULLS LAST, proposal_key';

    const sql = `
      SELECT
        proposal_key,
        CASE ${periodCase} END AS period,
        account_name,
        job_title,
        event_name,
        session_title,
        submission_date,
        submission_status_original,
        proposal_status_group,
        is_unaffiliated_proposal
      FROM ${SPEAKERS_LIST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND (${inAnyPeriod})
        -- A key-less row is dropped by the mapper, so it must not take a slot under the cap.
        AND proposal_key IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY period ORDER BY ${recency}) <= ${cap}
        OR (
          proposal_status_group IN (${tabGroups})
          AND ROW_NUMBER() OVER (PARTITION BY period, proposal_status_group ORDER BY ${recency}) <= ${cap}
        )
    `;

    const result = await executeSnowflakeViewRead<SpeakerProposalRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: SPEAKERS_LIST_VIEW,
      operation: 'get_events_speakers',
      clientMessage: 'Speakers and proposals are unavailable right now.',
    });
    return result.rows;
  }

  /** The headline totals alone, for a foundation the revenue view has no row for; no overview row either is unmeasured. */
  private async getOverviewRevenuePeriods(req: Request, query: HealthMetricsEventsRevenueQuery): Promise<HealthMetricsEventsRevenuePeriod[]> {
    const columns = HEALTH_METRICS_L2_RANGES.map((range) => `revenue_usd_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]}`).join(',\n        ');
    const sql = `
      SELECT
        ${columns}
      FROM ${OVERVIEW_REVENUE_VIEW}
      WHERE foundation_slug = ?
        AND LOWER(revenue_domain) = 'events'
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<OverviewRevenueRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: OVERVIEW_REVENUE_VIEW,
      operation: 'get_events_revenue',
      clientMessage: 'Event revenue is unavailable right now.',
    });

    const row = result.rows[0];
    // Matches the Overview tab, which reads a missing row as no data rather than zero revenue.
    if (!row) return [];

    // A null total is no data for that period, as on the Overview tab, so the period is left out.
    return HEALTH_METRICS_L2_RANGES.flatMap((range) => {
      const totalUsd = toNullableNumber(row[periodColumn('REVENUE_USD', range)]);
      if (totalUsd === null) return [];

      return [
        { range, totalUsd, registrationUsd: null, sponsorshipUsd: null, registrationShare: null, sponsorshipShare: null, hasUnconverted: false, changes: null },
      ];
    });
  }

  /** Whether the foundation has ever held an event, has one still to come in any year, or has event revenue recorded. */
  private async hasAnyEvent(req: Request, query: HealthMetricsEventsAtAGlanceQuery): Promise<boolean> {
    // The past view keeps every closed event whatever its age; the rollup only covers four periods.
    const pastSql = `
      SELECT 1 AS has_event
      FROM ${PAST_EVENTS_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
      LIMIT 1
    `;
    if (await this.hasRow(req, PAST_EVENTS_VIEW, pastSql, [query.foundationSlug])) return true;

    const upcomingSql = `
      SELECT 1 AS has_event
      FROM ${REGISTRATION_FORECAST_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND event_start_date >= CURRENT_DATE()
      LIMIT 1
    `;
    if (await this.hasRow(req, REGISTRATION_FORECAST_VIEW, upcomingSql, [query.foundationSlug])) return true;

    // Revenue can outlive the events views' rows; hiding the tab would hide the revenue section with it.
    const revenueSql = `
      SELECT 1 AS has_event
      FROM ${REVENUE_VIEW}
      WHERE foundation_slug = ?
      LIMIT 1
    `;
    if (await this.hasRow(req, REVENUE_VIEW, revenueSql, [query.foundationSlug])) return true;

    // The overview zero-fills every foundation, so only a non-zero total is revenue recorded.
    const recorded = HEALTH_METRICS_L2_RANGES.map((range) => `revenue_usd_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]} <> 0`).join(' OR ');
    const overviewSql = `
      SELECT 1 AS has_event
      FROM ${OVERVIEW_REVENUE_VIEW}
      WHERE foundation_slug = ?
        AND LOWER(revenue_domain) = 'events'
        AND (${recorded})
      LIMIT 1
    `;
    return this.hasRow(req, OVERVIEW_REVENUE_VIEW, overviewSql, [query.foundationSlug]);
  }

  /** One guarded existence read, so a missing object is logged under the one view it names. */
  private async hasRow(req: Request, view: string, sql: string, binds: string[]): Promise<boolean> {
    const result = await executeSnowflakeViewRead<{ HAS_EVENT: number }>(this.snowflakeService, req, sql, binds, {
      view,
      operation: 'get_events_at_a_glance',
      clientMessage: 'Events at a glance is unavailable right now.',
    });

    return result.rows.length > 0;
  }
}

function mapAtAGlancePeriod(row: AtAGlanceRow, range: HealthMetricsL2Range): HealthMetricsEventsAtAGlancePeriod {
  const count = (prefix: string): number | null => toNullableNumber(row[periodColumn(`${prefix}_count`, range)]);
  const change = (prefix: string): number | null => toNullableNumber(row[periodColumn(`${prefix}_change_pct`, range)]);

  return {
    range,
    registrations: count('registrations'),
    attendees: count('attendees'),
    organizations: count('organizations'),
    speakers: count('speakers'),
    countries: count('countries'),
    events: count('events'),
    pastEvents: count('past_events'),
    showUpRate: toNullableNumber(row[periodColumn('show_up_rate', range)]),
    changes: HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPARED_RANGES.includes(range)
      ? {
          registrations: change('registrations'),
          attendees: change('attendees'),
          organizations: change('organizations'),
          speakers: change('speakers'),
          countries: change('countries'),
          events: change('events'),
          showUpRatePts: toNullableNumber(row[periodColumn('show_up_rate_change_pts', range)]),
        }
      : null,
  };
}

function mapPastEvent(row: PastEventRow): HealthMetricsEventsPastEvent | null {
  if (!row.EVENT_ID) return null;

  // The view's own flag decides "no goal", so a zero or negative goal never reads as missed.
  const hasGoal = row.HAS_GOAL === true;

  return {
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME ?? row.EVENT_ID,
    eventStartDate: toIsoDate(row.EVENT_START_DATE),
    registrations: toNullableNumber(row.REGISTRATIONS),
    goal: hasGoal ? toNullableNumber(row.GOAL) : null,
    goalMet: hasGoal && row.GOAL_MET !== null ? row.GOAL_MET === true : null,
    revenueUsd: toNullableNumber(row.REVENUE_USD),
    paceStatus: hasGoal ? row.PACE_STATUS : null,
    ranges: HEALTH_METRICS_L2_RANGES.filter((range) => row[periodColumn('IS_IN_PERIOD', range)] === true),
  };
}

function mapPastPeriod(row: PastEventRow, range: HealthMetricsL2Range): HealthMetricsEventsPastPeriod {
  return {
    range,
    eventCount: toNullableNumber(row[periodColumn('SCOPE_PAST_EVENTS_COUNT', range)]),
    registrations: toNullableNumber(row[periodColumn('SCOPE_REGISTRATIONS_COUNT', range)]),
  };
}

/** A measured-zero period for a foundation the view has no row for; with nothing held, nothing changed. */
function buildZeroAtAGlancePeriod(range: HealthMetricsL2Range): HealthMetricsEventsAtAGlancePeriod {
  return {
    range,
    registrations: 0,
    attendees: 0,
    organizations: 0,
    speakers: 0,
    countries: 0,
    events: 0,
    pastEvents: 0,
    showUpRate: null,
    changes: null,
  };
}

function mapRevenuePeriod(row: RevenueRow, range: HealthMetricsL2Range): HealthMetricsEventsRevenuePeriod {
  const usd = (metric: string): number | null => toNullableNumber(row[periodColumn(`foundation_${metric}_revenue_usd`, range)]);
  const change = (metric: string): number | null => toNullableNumber(row[periodColumn(`foundation_${metric}_revenue_change_pct`, range)]);

  return {
    range,
    totalUsd: usd('total'),
    registrationUsd: usd('registration'),
    sponsorshipUsd: usd('sponsorship'),
    registrationShare: toNullableNumber(row[periodColumn('foundation_registration_revenue_share_pct', range)]),
    sponsorshipShare: toNullableNumber(row[periodColumn('foundation_sponsorship_revenue_share_pct', range)]),
    hasUnconverted: row[periodColumn('foundation_has_unconverted_registration_revenue', range)] === true,
    changes: HEALTH_METRICS_EVENTS_REVENUE_COMPARED_RANGES.includes(range)
      ? { total: change('total'), registration: change('registration'), sponsorship: change('sponsorship') }
      : null,
  };
}

function mapRevenueEvent(row: RevenueRow): HealthMetricsEventsRevenueEvent | null {
  if (!row.EVENT_ID) return null;

  // Both goals share one goal currency, so an unconverted one withholds every goal set.
  const hasUnconvertedGoal = row.HAS_UNCONVERTED_REVENUE_GOAL === true;
  const registrationGoal = toRevenueGoal(row.REGISTRATION_REVENUE_GOAL);
  const sponsorshipGoal = toRevenueGoal(row.SPONSORSHIP_REVENUE_GOAL);

  return {
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME ?? row.EVENT_ID,
    eventStartDate: toIsoDate(row.EVENT_START_DATE),
    registrationUsd: toNullableNumber(row.REGISTRATION_REVENUE_USD),
    sponsorshipUsd: toNullableNumber(row.SPONSORSHIP_REVENUE_USD),
    registrationGoal: hasUnconvertedGoal ? null : registrationGoal,
    sponsorshipGoal: hasUnconvertedGoal ? null : sponsorshipGoal,
    hasUnconverted: row.HAS_UNCONVERTED_REGISTRATION_REVENUE === true,
    registrationGoalWithheld: hasUnconvertedGoal && registrationGoal !== null,
    sponsorshipGoalWithheld: hasUnconvertedGoal && sponsorshipGoal !== null,
    ranges: HEALTH_METRICS_L2_RANGES.filter((range) => row[periodColumn('IN_PERIOD', range)] === true),
  };
}

function mapSpeakersPeriod(row: SpeakersDrilldownRow, range: HealthMetricsL2Range): HealthMetricsEventsSpeakersPeriod {
  const count = (prefix: string): number | null => toNullableNumber(row[periodColumn(`${prefix}_count`, range)]);

  return {
    range,
    submitted: count('proposals_submitted'),
    accepted: count('proposals_accepted'),
    inReview: count('proposals_in_review'),
    declined: count('proposals_declined'),
    speakers: count('speakers'),
    acceptanceRate: toNullableNumber(row[periodColumn('acceptance_rate', range)]),
    changes: HEALTH_METRICS_EVENTS_SPEAKERS_COMPARED_RANGES.includes(range)
      ? { speakers: toNullableNumber(row[periodColumn('speakers_count_change_pct', range)]) }
      : null,
  };
}

/** Keeps only the periods the organization ranks in the top few for; `null` when it has no id or no such period. */
function mapSpeakersOrganization(row: SpeakersDrilldownRow): HealthMetricsEventsSpeakersOrganization | null {
  if (!row.ACCOUNT_ID) return null;

  const periods = HEALTH_METRICS_L2_RANGES.flatMap((range) => {
    const rank = toNullableNumber(row[periodColumn('sort_rank', range)]);
    if (rank === null || rank > HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS) return [];
    return [{ range, rank, submitted: toNullableNumber(row[periodColumn('proposals_submitted_count', range)]) }];
  });
  if (periods.length === 0) return null;

  return { accountId: row.ACCOUNT_ID, accountName: row.ACCOUNT_NAME ?? row.ACCOUNT_ID, periods };
}

function mapSpeakersUnaffiliated(row: SpeakersDrilldownRow | undefined): HealthMetricsEventsSpeakersPeriodCount[] {
  if (!row) return [];

  return HEALTH_METRICS_L2_RANGES.map((range) => ({ range, submitted: toNullableNumber(row[periodColumn('proposals_submitted_count', range)]) }));
}

function mapSpeakerProposal(row: SpeakerProposalRow): HealthMetricsEventsSpeakersProposal | null {
  if (!row.PROPOSAL_KEY || !row.PERIOD) return null;

  return {
    proposalKey: row.PROPOSAL_KEY,
    range: row.PERIOD,
    jobTitle: row.JOB_TITLE?.trim() || null,
    organizationName: row.ACCOUNT_NAME,
    unaffiliated: row.IS_UNAFFILIATED_PROPOSAL === true,
    eventName: row.EVENT_NAME ?? '',
    sessionTitle: row.SESSION_TITLE ?? '',
    submissionDate: toIsoDate(row.SUBMISSION_DATE),
    status: row.SUBMISSION_STATUS_ORIGINAL ?? row.PROPOSAL_STATUS_GROUP ?? '',
    statusGroup: toSpeakersStatusGroup(row.PROPOSAL_STATUS_GROUP),
  };
}

function mapOrganization(row: OrganizationRow): HealthMetricsEventsOrganization | null {
  if (!row.ACCOUNT_ID) return null;

  return {
    accountId: row.ACCOUNT_ID,
    accountName: row.ACCOUNT_NAME ?? row.ACCOUNT_ID,
    logoUrl: row.LOGO_URL || null,
    isMember: row.IS_MEMBER === true,
    registrations: toNullableNumber(row.REGISTRATIONS_COUNT),
    registrationsShare: toNullableNumber(row.REGISTRATIONS_SHARE),
    sponsorshipUsd: toNullableNumber(row.SPONSORSHIP_REVENUE),
    proposals: toNullableNumber(row.PROPOSALS_COUNT),
    speakers: toNullableNumber(row.SPEAKERS_COUNT),
    events: toNullableNumber(row.EVENTS_COUNT),
  };
}

function toSpeakersStatusGroup(value: string | null): HealthMetricsEventsSpeakersStatusGroup | null {
  const groups = Object.keys(HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS) as HealthMetricsEventsSpeakersStatusGroup[];
  return groups.find((group) => HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[group].viewValue === value) ?? null;
}

/** A goal of zero or less is no goal set, the same rule the view's goal-met flag uses. */
function toRevenueGoal(value: unknown): number | null {
  const goal = toNullableNumber(value);
  return goal !== null && goal > 0 ? goal : null;
}

/** The whole calendar year `yearsBack` years before this one, as the view's completed-year windows read it. */
function completedYearPredicate(yearsBack: number): string {
  const yearStart = "DATE_TRUNC('YEAR', CURRENT_DATE())";
  const start = `DATEADD(YEAR, -${yearsBack}, ${yearStart})`;
  const nextStart = yearsBack === 1 ? yearStart : `DATEADD(YEAR, -${yearsBack - 1}, ${yearStart})`;
  return `event_start_date >= ${start} AND event_start_date < ${nextStart}`;
}

/** Snowflake returns unquoted identifiers upper-cased. */
function periodColumn(prefix: string, range: HealthMetricsL2Range): string {
  return `${prefix}_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]}`.toUpperCase();
}

function mapForecastEvent(row: ForecastEventRow): HealthMetricsEventsForecastEvent | null {
  // An event with no id cannot be selected or deep-linked, so it is dropped rather than shown.
  if (!row.EVENT_ID) return null;

  return {
    eventId: row.EVENT_ID,
    eventName: row.EVENT_NAME ?? row.EVENT_ID,
    eventStartDate: toIsoDate(row.EVENT_START_DATE),
    forecastAvg: toNullableNumber(row.FORECAST_AVG),
    forecastLow: toNullableNumber(row.FORECAST_LOW),
    forecastHigh: toNullableNumber(row.FORECAST_HIGH),
    registrationsNow: toNullableNumber(row.REGISTRATIONS_NOW),
    priorYearSamePoint: toNullableNumber(row.PRIOR_YEAR_SAME_POINT),
    goal: toNullableNumber(row.GOAL),
    daysLeft: toDaysLeft(row.DAYS_LEFT),
    isNewEvent: row.IS_NEW_EVENT === true,
  };
}

function groupCurveRows(rows: ForecastCurveRow[]): HealthMetricsEventsForecastCurveSeries[] {
  const byFormat = new Map<string, HealthMetricsEventsForecastCurveSeries>();

  for (const row of rows) {
    if (row.DAYS_TO_EVENT === null) continue;

    const format = row.EVENT_REGISTRATION_TYPE ?? UNTYPED_FORMAT_LABEL;
    const series = byFormat.get(format) ?? { format, points: [] };
    // The model marks a measured day `known`; every later day is `predicted`.
    const known = row.PRED_TYPE === 'known';
    series.points.push({
      daysToEvent: Number(row.DAYS_TO_EVENT),
      actual: known ? toNullableNumber(row.FORECAST_AVG) : null,
      forecastAvg: known ? null : toNullableNumber(row.FORECAST_AVG),
      forecastLow: known ? null : toNullableNumber(row.FORECAST_LOW),
      forecastHigh: known ? null : toNullableNumber(row.FORECAST_HIGH),
      priorYear: toNullableNumber(row.PRIOR_YEAR),
    });
    byFormat.set(format, series);
  }

  const series = [...byFormat.values()];
  series.forEach(joinForecastToToday);
  return series;
}

/** Starts the forecast and its band at the last measured day, so the dashed line meets the solid one. */
function joinForecastToToday(series: HealthMetricsEventsForecastCurveSeries): void {
  const todayIndex = series.points.map((point) => point.actual !== null).lastIndexOf(true);
  if (todayIndex < 0 || todayIndex === series.points.length - 1) return;

  const today = series.points[todayIndex];

  today.forecastAvg = today.actual;
  today.forecastLow = today.actual;
  today.forecastHigh = today.actual;
}

/** The model counts days left from yesterday, negative before the event; the UI shows the count from today. */
function toDaysLeft(value: unknown): number | null {
  const daysLeft = toNullableNumber(value);
  return daysLeft === null ? null : Math.max(0, Math.abs(daysLeft) - 1);
}

/** A row without a year cannot be placed on the chart, so it is dropped rather than guessed. */
function mapRegistrationsGrowthYear(row: RegistrationsGrowthRow): HealthMetricsEventsRegistrationsGrowthYear | null {
  const year = toNullableNumber(row.YEAR);
  const maxYear = new Date().getUTCFullYear() + HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MAX_YEARS_AHEAD;
  if (year === null || !Number.isInteger(year) || year < HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_MIN_YEAR || year > maxYear) return null;

  return {
    year,
    isPartialYear: row.IS_PARTIAL_YEAR === true,
    totalRegistrations: toNullableNumber(row.TOTAL_REGISTRATIONS),
    inPersonRegistrations: toNullableNumber(row.IN_PERSON_REGISTRATIONS),
    virtualRegistrations: toNullableNumber(row.VIRTUAL_REGISTRATIONS),
    totalAttendees: toNullableNumber(row.TOTAL_ATTENDEES),
    inPersonAttendees: toNullableNumber(row.IN_PERSON_ATTENDEES),
    virtualAttendees: toNullableNumber(row.VIRTUAL_ATTENDEES),
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
