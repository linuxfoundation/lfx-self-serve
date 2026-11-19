// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPANIES_TIP,
  HEALTH_METRICS_EVENTS_CHART_BAR_WIDTH_PX,
  HEALTH_METRICS_EVENTS_FORECAST_PACES,
  HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_GEOGRAPHY_HOME_CODE,
  HEALTH_METRICS_EVENTS_GEOGRAPHY_TOP_COUNTRIES,
  HEALTH_METRICS_EVENTS_NOT_AVAILABLE,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS,
  HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE,
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_HEADROOM,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_HEIGHT_PX,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_SERIES,
  HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_CHART_HEIGHT_PX,
  HEALTH_METRICS_EVENTS_SPEAKERS_INDIVIDUAL,
  HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS,
  HEALTH_METRICS_EVENTS_SPEAKERS_SERIES,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
  HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_UNIQUE_TIP,
  HEALTH_METRICS_EVENTS_SPONSORSHIP_PACKAGE_ICON,
} from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_BASE_PATH } from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import { HEALTH_METRICS_OVERVIEW_TREND_PREDICTED_TIP } from '../constants/health-metrics-overview.constants';
import {
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIERS,
} from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH, HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_TABLE_DASH } from '../constants/health-metrics-table.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { buildHealthMetricsColumnChart, formatHealthMetricsChartCompact } from './health-metrics-column-chart.utils';
import { formatHealthMetricsCountryFlag } from './health-metrics-world-map.utils';
import { formatCurrency } from './number.utils';

import { formatHealthMetricsPercent, healthMetricsShownPercent } from './health-metrics-table.utils';
import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsAtAGlanceRowView,
  HealthMetricsEventsAtAGlanceView,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastRowView,
  HealthMetricsEventsForecastStatus,
  HealthMetricsEventsForecastVerdict,
  HealthMetricsEventsForecastView,
  HealthMetricsEventsGeography,
  HealthMetricsEventsGeographyView,
  HealthMetricsEventsOrganization,
  HealthMetricsEventsOrganizationLink,
  HealthMetricsEventsOrganizationRowView,
  HealthMetricsEventsOrganizationsSegment,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsPastRowView,
  HealthMetricsEventsPastStatus,
  HealthMetricsEventsPastView,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetric,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsRevenueEvent,
  HealthMetricsEventsRevenueRowView,
  HealthMetricsEventsRevenueView,
  HealthMetricsEventsRegistrationsGrowthYear,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersProposal,
  HealthMetricsEventsSpeakersProposalRowView,
  HealthMetricsEventsSpeakersView,
  HealthMetricsEventsSponsorship,
  HealthMetricsEventsSponsorshipView,
  HealthMetricsEventsSubNavItem,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsFootnotePart, HealthMetricsL2Range, HealthMetricsMetricItem, HealthMetricsNote } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsColumnChartView } from '../interfaces/health-metrics-column-chart.interface';

/** Sub-nav items for the Events tab; a section notes only once it reports a note. */
export function buildHealthMetricsEventsSubNavItems(notes: Partial<Record<HealthMetricsEventsSectionKey, string>> = {}): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: notes[section.key] ?? '' }));
}

/** The Companies at events segment a URL value or switch pick names; anything else is All. */
export function parseHealthMetricsEventsOrganizationsSegment(id: string | null): HealthMetricsEventsOrganizationsSegment {
  return HEALTH_METRICS_EVENTS_ORGANIZATIONS_SEGMENT_OPTIONS.find((option) => option.id === id)?.id ?? 'all';
}

/** One Companies at events row. A zero sponsorship or proposal count reads as `—`: the view cannot tell it from not tracked. */
export function buildHealthMetricsEventsOrganizationRowView(organization: HealthMetricsEventsOrganization): HealthMetricsEventsOrganizationRowView {
  return {
    accountId: organization.accountId,
    accountName: organization.accountName,
    company: { kind: 'company', name: organization.accountName, logoUrl: organization.logoUrl ?? '' },
    isMember: organization.isMember,
    membershipLabel: formatOrganizationMembership(organization),
    registrationsLabel: formatHealthMetricsEventsCount(organization.registrations),
    sponsorshipLabel: organization.sponsorshipUsd ? formatCurrency(organization.sponsorshipUsd) : HEALTH_METRICS_TABLE_DASH,
    proposalsLabel: organization.proposals ? formatHealthMetricsEventsCount(organization.proposals) : HEALTH_METRICS_TABLE_DASH,
    speakersLabel: formatHealthMetricsEventsCount(organization.speakers),
    eventsLabel: formatHealthMetricsEventsCount(organization.events),
    link: buildHealthMetricsEventsOrganizationLink(organization),
    linkLabel: `Open ${organization.accountName} in ${organization.isMember ? 'Members' : 'Non-Members'}`,
  };
}

/**
 * A member's tier, a reserved one spelled as the Members tab spells it; "Member" when the view has none. The tier is current
 * while membership is the period's, so a current "Non-Member" tier on a period member is no tier.
 */
function formatOrganizationMembership(organization: HealthMetricsEventsOrganization): string {
  if (!organization.isMember) return HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.nonMember;

  const raw = organization.membershipTier?.trim() ?? '';
  const tierName = raw.toLowerCase().replace(/[^a-z]/g, '') === 'nonmember' ? '' : raw;
  const reserved = HEALTH_METRICS_MEMBERS_RESERVED_TIERS.find((tier) => tier === tierName.toLowerCase());
  if (reserved) return HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS[reserved];
  return tierName || HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.member;
}

/** A member opens the Members directory and a non-member opens Non-Members company participation, each searched by name with other filters cleared. */
function buildHealthMetricsEventsOrganizationLink(organization: HealthMetricsEventsOrganization): HealthMetricsEventsOrganizationLink {
  if (organization.isMember) {
    return {
      commands: [HEALTH_METRICS_BASE_PATH, 'members'],
      fragment: 'list',
      queryParams: {
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directorySearch]: organization.accountName.slice(0, HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH),
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryTier]: null,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryNps]: null,
        [HEALTH_METRICS_MEMBERS_QUERY_PARAMS.directoryPage]: null,
      },
    };
  }

  return {
    commands: [HEALTH_METRICS_BASE_PATH, 'non-members'],
    fragment: 'orgs',
    queryParams: {
      [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsSearch]: organization.accountName.slice(0, HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH),
      [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsFilter]: null,
      [HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS.orgsPage]: null,
    },
  };
}

/** A registration goal of zero or less is no goal set; every registration-goal check reads it through here. */
export function hasHealthMetricsEventsGoal(goal: number | null): goal is number {
  return goal !== null && goal > 0;
}

/** True when goal and forecast differ by an order of magnitude or more — a data-entry problem, not a pace. */
export function isHealthMetricsEventsForecastGoalSuspect(event: HealthMetricsEventsForecastEvent): boolean {
  if (!hasHealthMetricsEventsGoal(event.goal) || event.forecastAvg === null) return false;

  const ratio = event.forecastAvg / event.goal;
  return ratio >= HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO || ratio <= 1 / HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO;
}

/**
 * EVT-01: upper forecast below goal is Action required, central below goal is At risk, else On track. It counts the
 * sub-nav's misses, which leave out a mis-entered goal; the band narrows as the event nears, so the rule calibrates itself.
 */
export function resolveHealthMetricsEventsForecastStatus(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastStatus {
  // No forecast outranks no goal: there is nothing to show either way, and the contract says No data.
  if (event.forecastAvg === null) return 'no-data';
  if (!hasHealthMetricsEventsGoal(event.goal)) return 'no-goal';
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return 'no-data';
  if (event.forecastHigh !== null && event.forecastHigh < event.goal) return 'action';
  if (event.forecastAvg < event.goal) return 'at-risk';

  return 'on-track';
}

/** The verdict note under the metrics row. A goal 3× under the forecast reads as stale, not as success. */
export function resolveHealthMetricsEventsForecastVerdict(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastVerdict {
  const base = { forecast: event.forecastAvg, goal: event.goal, gap: 0, ratio: null, daysLeft: event.daysLeft };

  if (event.forecastAvg === null) return { ...base, kind: 'no-data', tone: 'summary' };
  if (!hasHealthMetricsEventsGoal(event.goal)) return { ...base, kind: 'no-goal', tone: 'summary' };

  // Mis-entered goes first, so a 10× gap reads as the sub-nav count reads it: no miss.
  const ratio = event.forecastAvg / event.goal;
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return { ...base, kind: 'goal-suspect', tone: 'attention', ratio };
  if (ratio >= HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO) return { ...base, kind: 'stale', tone: 'attention', ratio };

  // Branch on the raw values, as the status does, and round only the gap shown.
  const gap = Math.round(Math.abs(event.forecastAvg - event.goal));
  if (event.forecastAvg >= event.goal) return { ...base, kind: 'on-track', tone: 'healthy', gap };

  // Even the high forecast missing is the status's Action required; within the band, it needs attention.
  const hopeless = event.forecastHigh !== null && event.forecastHigh < event.goal;
  return { ...base, kind: 'short', tone: hopeless ? 'action' : 'attention', gap };
}

/**
 * The selected event's metrics row (Current, Goal, Predicted, Days left) and its verdict note. Every unmeasured value
 * reads "—", and Predicted drops its range with no forecast.
 */
export function buildHealthMetricsEventsForecastView(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastView {
  const goal = hasHealthMetricsEventsGoal(event.goal) ? event.goal : null;
  const range =
    event.forecastAvg !== null && event.forecastHigh !== null && event.forecastLow !== null
      ? `High ${formatHealthMetricsEventsCount(event.forecastHigh)} · Low ${formatHealthMetricsEventsCount(event.forecastLow)}`
      : '';

  return {
    metrics: [
      {
        key: 'current',
        label: 'Current',
        value: formatHealthMetricsEventsCount(event.registrationsNow),
        description: `Same point last year: ${formatHealthMetricsEventsCount(event.isNewEvent ? null : event.priorYearSamePoint)}`,
      },
      { key: 'goal', label: 'Goal', value: formatHealthMetricsEventsCount(goal) },
      {
        key: 'predicted',
        label: 'Predicted',
        value: formatHealthMetricsEventsCount(event.forecastAvg),
        ...(range ? { description: range } : {}),
        tip: HEALTH_METRICS_OVERVIEW_TREND_PREDICTED_TIP,
      },
      { key: 'days-left', label: 'Days left', value: formatHealthMetricsEventsCount(event.daysLeft) },
    ],
    note: buildForecastVerdictNote(resolveHealthMetricsEventsForecastVerdict(event)),
  };
}

/** "{City} · {Mon D, YYYY}"; a virtual event with no city reads "Virtual", and any other shows the date alone. */
export function formatHealthMetricsEventsPlaceLabel(event: { city: string | null; isVirtual: boolean; eventStartDate: string | null }): string {
  const place = event.city ?? (event.isVirtual ? 'Virtual' : '');
  const date = event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '';
  return [place, date].filter(Boolean).join(' · ');
}

/** Sub-nav note: events projected under goal, leaving out the ones whose goal looks mis-entered. */
export function buildHealthMetricsEventsForecastNote(events: HealthMetricsEventsForecastEvent[]): string {
  const missing = events.filter((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    return status === 'action' || status === 'at-risk';
  }).length;

  return missing > 0 ? `${missing} will miss goal` : '';
}

/** Worst pacing first by registrations against goal; events with no usable goal or count go last. */
export function sortHealthMetricsEventsForecastRows(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  const pace = (event: HealthMetricsEventsForecastEvent): number =>
    isHealthMetricsEventsForecastGoalSuspect(event) ? Number.POSITIVE_INFINITY : (resolveProgressRatio(event) ?? Number.POSITIVE_INFINITY);

  return [...events].sort((a, b) => pace(a) - pace(b) || a.eventName.localeCompare(b.eventName, 'en-US'));
}

/**
 * "All upcoming events", worst pace first, with every label resolved. The bar fills to registrations over goal and takes
 * the forecast's colour: red when even the high forecast misses, amber when the average does, else emerald.
 */
export function buildHealthMetricsEventsForecastRowViews(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastRowView[] {
  return sortHealthMetricsEventsForecastRows(events).map((event) => {
    const goal = hasHealthMetricsEventsGoal(event.goal) ? event.goal : null;
    const pace = HEALTH_METRICS_EVENTS_FORECAST_PACES[forecastPace(event, goal)];

    return {
      eventId: event.eventId,
      eventName: event.eventName,
      placeLabel: formatHealthMetricsEventsPlaceLabel(event),
      registrationsLabel: formatHealthMetricsEventsCount(event.registrationsNow),
      goalLabel: goal === null ? '' : `Goal: ${formatHealthMetricsEventsCount(goal)}`,
      pct: goal === null ? 0 : Math.min(100, ((event.registrationsNow ?? 0) / goal) * 100),
      fillClass: pace.fillClass,
      paceLabel: goal === null ? '' : pace.label,
      // Registrations sorts by the share of goal reached; with no goal or no count it is empty.
      sortValues: {
        event: event.eventName,
        registrations: goal === null || event.registrationsNow === null ? null : (event.registrationsNow / goal) * 100,
      },
    };
  });
}

/** Rounded, `en-US`-pinned so the server render and the hydrated one agree; `—` for unmeasured. */
export function formatHealthMetricsEventsCount(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('en-US');
}

/** The format the chart opens on: whichever has registered more people so far. */
export function pickHealthMetricsEventsForecastFormat(formats: HealthMetricsEventsForecastCurveSeries[]): string | null {
  let best: { format: string; registrations: number } | null = null;

  for (const series of formats) {
    const registrations = Math.max(0, ...series.points.map((point) => point.actual ?? 0));
    if (!best || registrations > best.registrations) best = { format: series.format, registrations };
  }

  return best?.format ?? null;
}

/** A closed event's outcome. A miss the model banded as needing attention finished within reach. */
export function resolveHealthMetricsEventsPastStatus(event: HealthMetricsEventsPastEvent): HealthMetricsEventsPastStatus {
  if (!hasHealthMetricsEventsGoal(event.goal)) return 'no-goal';
  // An unflagged outcome falls back to final registrations against the goal; with neither, it is unmeasured.
  let met = event.goalMet;
  if (met === null) {
    if (event.registrations === null) return 'unmeasured';
    met = event.registrations >= event.goal;
  }
  if (met) return 'hit';

  return event.paceStatus === HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE ? 'near-miss' : 'missed';
}

/**
 * One period's section: Total registrations as the view totals it, Goal reached read off the same rows as the pills, and
 * the events most recent first. With no goal set or measured, Goal reached reads "—".
 */
export function buildHealthMetricsEventsPastView(past: HealthMetricsEventsPast, range: HealthMetricsRange): HealthMetricsEventsPastView {
  const period = past.periods.find((candidate) => candidate.range === range);
  const rows = past.events.filter((event) => event.ranges.some((candidate) => candidate === range)).map(buildPastRowView);
  const reached = rows.filter((row) => row.status === 'hit').length;
  const tracked = rows.filter((row) => row.status !== 'no-goal' && row.status !== 'unmeasured').length;

  return {
    metrics: [
      { key: 'registrations', label: 'Total registrations', value: formatDashCount(period?.registrations) },
      { key: 'goal-reached', label: 'Goal reached', value: tracked ? `${formatDashCount(reached)} of ${formatDashCount(tracked)}` : HEALTH_METRICS_TABLE_DASH },
    ],
    rows,
  };
}

/**
 * One period's at-a-glance section: the metrics row, then each figure against the comparison period. Year to date and
 * the last completed year are compared with the year before, the one the view's change columns use; older years read "—".
 */
export function buildHealthMetricsEventsAtAGlanceView(glance: HealthMetricsEventsAtAGlance, range: HealthMetricsRange): HealthMetricsEventsAtAGlanceView {
  const period = glance.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const ytd = range === 'YTD';
  const year = getYearForRange(range);
  const upcoming = ytd ? glance.upcomingEvents : 0;
  const past = period?.pastEvents ?? null;
  const total = past === null || upcoming === null ? null : past + upcoming;
  // The view's columns run oldest to newest, so the period before is the one ahead of it in the list.
  const rangeIndex = HEALTH_METRICS_L2_RANGES.indexOf(range as HealthMetricsL2Range);
  const comparedRange = changes && rangeIndex > 0 ? HEALTH_METRICS_L2_RANGES[rangeIndex - 1] : null;
  const compared = comparedRange ? (glance.periods.find((candidate) => candidate.range === comparedRange) ?? null) : null;
  const row = (
    key: string,
    label: string,
    pick: (candidate: HealthMetricsEventsAtAGlancePeriod | null) => string,
    figure: (candidate: HealthMetricsEventsAtAGlancePeriod | null) => number | null,
    change: number | null | undefined,
    unit: 'pct' | 'pp' = 'pct'
  ): HealthMetricsEventsAtAGlanceRowView => {
    const changeView = glanceChange(changes ? (change ?? null) : null, unit);
    return {
      key,
      label,
      value: pick(period),
      comparison: comparedRange ? pick(compared) : HEALTH_METRICS_TABLE_DASH,
      ...changeView,
      // Each figure as its cell reads it; the show-up rate and the change by their shown percent.
      sortValues: {
        metric: label,
        period: figure(period),
        comparison: comparedRange ? figure(compared) : null,
        change: changeView.change === null ? null : glanceChangeValue(change ?? 0, unit),
      },
    };
  };
  const count = (field: 'registrations' | 'attendees' | 'organizations' | 'speakers' | 'countries') => (candidate: HealthMetricsEventsAtAGlancePeriod | null) =>
    formatDashCount(candidate?.[field]);
  const countFigure =
    (field: 'registrations' | 'attendees' | 'organizations' | 'speakers' | 'countries') =>
    (candidate: HealthMetricsEventsAtAGlancePeriod | null): number | null =>
      candidate?.[field] ?? null;
  const showUpFigure = (candidate: HealthMetricsEventsAtAGlancePeriod | null): number | null =>
    candidate?.showUpRate === null || candidate?.showUpRate === undefined ? null : healthMetricsShownPercent(candidate.showUpRate * 100);
  const showUpRate = formatShowUpRate(period);
  const eventsDescription = ytd ? `${formatDashCount(past)} past · ${formatDashCount(upcoming)} upcoming` : `${formatDashCount(past)} past`;

  return {
    metrics: [
      {
        key: 'registrations',
        label: 'Total registrations',
        value: formatDashCount(period?.registrations),
        ...(changes ? metricTrend(changes.registrations) : {}),
      },
      {
        key: 'attendees',
        label: 'Attendees',
        value: formatDashCount(period?.attendees),
        ...(showUpRate === HEALTH_METRICS_TABLE_DASH ? {} : { description: `${showUpRate} show-up rate` }),
      },
      { key: 'events', label: 'Events', value: formatDashCount(total), description: eventsDescription },
      {
        key: 'companies',
        label: 'Participating companies',
        value: formatDashCount(period?.organizations),
        tip: HEALTH_METRICS_EVENTS_AT_A_GLANCE_COMPANIES_TIP,
      },
    ],
    periodHeading: ytd ? `${year} (YTD)` : `${year}`,
    // The view's year-to-date changes compare with the whole last completed year, so the column and badge agree.
    comparisonHeading: ytd ? `${year - 1} (full year)` : `${year - 1}`,
    rows: [
      row('registrations', 'Registrations', count('registrations'), countFigure('registrations'), changes?.registrations),
      row('attendees', 'Attendees', count('attendees'), countFigure('attendees'), changes?.attendees),
      row('companies', 'Participating companies', count('organizations'), countFigure('organizations'), changes?.organizations),
      row('speakers', 'Speakers', count('speakers'), countFigure('speakers'), changes?.speakers),
      row('countries', 'Countries', count('countries'), countFigure('countries'), changes?.countries),
      row('show-up-rate', 'Show-up rate', formatShowUpRate, showUpFigure, changes?.showUpRatePts, 'pp'),
    ],
  };
}

/**
 * One period's revenue section. Upcoming events fall in no period, so only the current-year view lists them,
 * soonest first, ahead of the period's past events, latest first.
 */
export function buildHealthMetricsEventsRevenueView(revenue: HealthMetricsEventsRevenue, range: HealthMetricsRange): HealthMetricsEventsRevenueView {
  const period = revenue.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const metric = (key: string, label: string, value: number | null | undefined, change: number | null | undefined) => ({
    key,
    label,
    value: value === null || value === undefined ? HEALTH_METRICS_TABLE_DASH : formatCurrency(value),
    ...(changes ? metricTrend(change ?? null) : {}),
  });
  const upcoming =
    range === 'YTD' ? revenue.events.filter((event) => !event.isPastEvent).sort((a, b) => compareStartDates(a.eventStartDate, b.eventStartDate, 'asc')) : [];
  const past = revenue.events
    .filter((event) => event.isPastEvent && event.ranges.some((candidate) => candidate === range))
    .sort((a, b) => compareStartDates(a.eventStartDate, b.eventStartDate, 'desc'));
  const rows = [...upcoming, ...past].map(buildRevenueRowView);
  const figures = [period?.totalUsd, period?.registrationUsd, period?.sponsorshipUsd];

  return {
    foundationMeasured: revenue.periods.length > 0,
    measured: period !== null,
    hasRevenue: rows.length > 0 || period?.hasUnconverted === true || figures.some((value) => typeof value === 'number' && value !== 0),
    metrics: [
      metric('total', 'Total event revenue', period?.totalUsd, changes?.total),
      metric('registration', 'Registration', period?.registrationUsd, changes?.registration),
      metric('sponsorship', 'Sponsorship', period?.sponsorshipUsd, changes?.sponsorship),
    ],
    rows,
    eventsMeasured: revenue.eventsMeasured,
  };
}

/**
 * Registrations or attendees by year, every year from the first to the last with events: In-person stacked under
 * Virtual, the current year at full colour and the rest at 35%, each with its total above it. A gap year keeps its slot.
 */
export function buildHealthMetricsEventsRegistrationsGrowthChart(
  growth: HealthMetricsEventsRegistrationsGrowth,
  metric: HealthMetricsEventsRegistrationsGrowthMetric,
  currentYear: number
): HealthMetricsColumnChartView {
  const byYear = new Map(growth.years.map((year) => [year.year, year]));
  const years = [...byYear.keys()];
  const first = years.length ? Math.min(...years) : currentYear;
  const span = years.length ? Math.max(...years) - first + 1 : 0;
  const attendees = metric === 'attendees';
  const columns = Array.from({ length: span }, (_, index) => {
    const year = first + index;
    const data = byYear.get(year) ?? null;
    const values = data && [attendees ? data.inPersonAttendees : data.inPersonRegistrations, attendees ? data.virtualAttendees : data.virtualRegistrations];
    // The view's own total, which can count registrations in neither format, never a sum of the two.
    const total = data && (attendees ? data.totalAttendees : data.totalRegistrations);
    return {
      key: String(year),
      label: String(year),
      sub: data?.isPartialYear ? 'partial' : '',
      values,
      total,
      muted: year !== currentYear,
      tipTitle: registrationsGrowthTipTitle(year, data),
    };
  });
  // A year with no total still draws its known formats, so the axis fits whichever is taller.
  const heights = columns.map((column) =>
    Math.max(
      column.total ?? 0,
      (column.values ?? []).reduce<number>((sum, value) => sum + (value ?? 0), 0)
    )
  );

  return buildHealthMetricsColumnChart({
    series: [...HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_SERIES],
    columns,
    peak: Math.max(0, ...heights) * HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_HEADROOM,
    heightPx: HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_HEIGHT_PX,
    barWidthPx: HEALTH_METRICS_EVENTS_CHART_BAR_WIDTH_PX,
    formatTotal: formatHealthMetricsChartCompact,
    formatValue: formatHealthMetricsEventsCount,
    ariaLabel: `${attendees ? 'Attendees' : 'Registrations'} by year, in person and virtual`,
  });
}

function registrationsGrowthTipTitle(year: number, data: HealthMetricsEventsRegistrationsGrowthYear | null): string {
  if (data === null) return `${year} · no events recorded`;
  return data.isPartialYear ? `${year} · partial year` : String(year);
}

/**
 * One period's speakers and proposals: the metrics row, the proposals by year as stacked status columns (every year the
 * view holds, the current one at full colour), the latest proposals, and the companies that submitted the most.
 */
export function buildHealthMetricsEventsSpeakersView(speakers: HealthMetricsEventsSpeakers, range: HealthMetricsRange): HealthMetricsEventsSpeakersView {
  const period = speakers.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const acceptance = period?.acceptanceRate ?? null;
  const companies = speakers.organizations
    .flatMap((organization) => {
      const entry = organization.periods.find((candidate) => candidate.range === range);
      return entry ? [{ organization, rank: entry.rank, submitted: entry.submitted }] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS);
  // An unmeasured count reads "—" with no bar, never as 0.
  const most = Math.max(0, ...companies.map((company) => company.submitted ?? 0));

  const proposals = speakers.proposals
    .filter((proposal) => proposal.range === range)
    .sort(compareProposalsByRecency)
    .slice(0, HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS)
    .map(buildHealthMetricsEventsSpeakersProposalRowView);

  return {
    foundationMeasured: speakers.periods.length > 0,
    measured: period !== null && period.submitted !== null,
    metrics: [
      { key: 'total', label: 'Total proposals', value: formatDashCount(period?.submitted) },
      {
        key: 'accepted',
        label: 'Accepted proposals',
        value: formatDashCount(period?.accepted),
        ...(acceptance === null ? {} : { description: `${Math.round(acceptance * 100)}% acceptance rate` }),
      },
      { key: 'in-review', label: 'In review', value: formatDashCount(period?.inReview) },
      {
        key: 'speakers',
        label: 'Unique speakers',
        value: formatDashCount(period?.speakers),
        tip: HEALTH_METRICS_EVENTS_SPEAKERS_UNIQUE_TIP,
        ...(changes ? metricTrend(changes.speakers) : {}),
      },
    ],
    chart: buildSpeakersChart(speakers),
    proposals,
    companies: companies.map(({ organization, submitted }) => ({
      key: organization.accountId,
      label: organization.accountName,
      value: submitted === null ? HEALTH_METRICS_TABLE_DASH : `${formatHealthMetricsEventsCount(submitted)} ${submitted === 1 ? 'proposal' : 'proposals'}`,
      pct: submitted !== null && most > 0 ? (submitted / most) * 100 : 0,
      tier: null,
      icon: '',
      company: { kind: 'company', name: organization.accountName, logoUrl: organization.logoUrl },
    })),
    viewAllLabel: proposals.length ? formatSpeakersViewAllLabel(period?.submitted ?? null) : '',
  };
}

/** The drawer's subtitle: "{N} proposals · {period}", the period as "2026 (YTD)" or "2025". */
export function formatHealthMetricsEventsSpeakerProposalsSubtitle(total: number, range: HealthMetricsRange): string {
  const year = getYearForRange(range);
  const period = range === 'YTD' ? `${year} (YTD)` : `${year}`;
  return `${formatHealthMetricsEventsCount(total)} ${total === 1 ? 'proposal' : 'proposals'} · ${period}`;
}

/**
 * One period's sponsorship: the metrics row (revenue with its change, the goal with how much of it was reached, tier
 * packages and add-ons), then each tier's packages as bars, most sold first, Diamond to Silver with their tier icon.
 */
export function buildHealthMetricsEventsSponsorshipView(
  sponsorship: HealthMetricsEventsSponsorship,
  range: HealthMetricsRange
): HealthMetricsEventsSponsorshipView {
  const period = sponsorship.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const goal = period?.goalUsd ? period.goalUsd : null;
  const reached = goal !== null && period?.progressToGoal !== null && period?.progressToGoal !== undefined ? Math.round(period.progressToGoal * 100) : null;
  const tiers = period?.tiers ?? [];
  const most = Math.max(0, ...tiers.map((tier) => tier.packages));

  return {
    foundationMeasured: sponsorship.periods.length > 0,
    measured: period !== null && period.revenueUsd !== null,
    metrics: [
      {
        key: 'revenue',
        label: 'Sponsorship revenue',
        value: period?.revenueUsd === null || period?.revenueUsd === undefined ? HEALTH_METRICS_TABLE_DASH : formatCurrency(period.revenueUsd),
        ...(changes ? metricTrend(changes.revenue) : {}),
      },
      {
        key: 'goal',
        label: 'Goal',
        value: goal === null ? HEALTH_METRICS_TABLE_DASH : formatCurrency(goal),
        ...(reached === null ? {} : { description: `${reached}% reached` }),
      },
      { key: 'tier-packages', label: 'Tier packages', value: formatDashCount(period?.tierPackages) },
      { key: 'add-ons', label: 'Add-ons', value: formatDashCount(period?.addOns) },
    ],
    tiers: tiers.map((tier) => {
      const reserved = HEALTH_METRICS_MEMBERS_RESERVED_TIERS.find((candidate) => candidate === tier.name.toLowerCase()) ?? null;
      return {
        key: tier.name,
        label: tier.name,
        value: formatHealthMetricsEventsCount(tier.packages),
        pct: most > 0 ? (tier.packages / most) * 100 : 0,
        tier: reserved,
        icon: reserved ? '' : HEALTH_METRICS_EVENTS_SPONSORSHIP_PACKAGE_ICON,
        company: null,
      };
    }),
  };
}

/**
 * One period's geographic distribution: countries represented with its change, the top country and the share from outside
 * the US, every country for the map, and the top few. Shares divide by registrations with a known country.
 */
export function buildHealthMetricsEventsGeographyView(geography: HealthMetricsEventsGeography, range: HealthMetricsRange): HealthMetricsEventsGeographyView {
  const period = geography.periods.find((candidate) => candidate.range === range) ?? null;
  const ranked = period?.registrationsByCountry ?? [];
  const measured = ranked.length > 0;
  const total = ranked.reduce((sum, country) => sum + country.registrations, 0);
  const share = (registrations: number): number => (total > 0 ? (registrations / total) * 100 : 0);
  const top = ranked[0] ?? null;
  const unitedStates = ranked
    .filter((country) => country.code === HEALTH_METRICS_EVENTS_GEOGRAPHY_HOME_CODE)
    .reduce((sum, country) => sum + country.registrations, 0);
  const changes = measured ? (period?.changes ?? null) : null;

  return {
    foundationMeasured: geography.periods.length > 0,
    measured,
    metrics: [
      {
        key: 'countries',
        label: 'Countries represented',
        value: formatDashCount(measured ? (period?.countries ?? null) : null),
        ...(changes ? metricTrend(changes.countries) : {}),
      },
      {
        key: 'top',
        label: 'Top country',
        value: top?.country ?? HEALTH_METRICS_TABLE_DASH,
        ...(top
          ? {
              description: `${formatHealthMetricsEventsCount(top.registrations)} ${top.registrations === 1 ? 'registration' : 'registrations'} · ${formatHealthMetricsPercent(share(top.registrations))}`,
            }
          : {}),
      },
      {
        key: 'outside-us',
        label: 'Outside the US',
        value: measured ? formatHealthMetricsPercent(share(total - unitedStates)) : HEALTH_METRICS_TABLE_DASH,
        ...(measured ? { description: 'of registrations' } : {}),
      },
    ],
    countries: ranked.map((country) => ({
      code: country.code,
      name: country.country,
      value: country.registrations,
      valueLabel: `${formatHealthMetricsEventsCount(country.registrations)} · ${formatHealthMetricsPercent(share(country.registrations))}`,
    })),
    topCountries: ranked.slice(0, HEALTH_METRICS_EVENTS_GEOGRAPHY_TOP_COUNTRIES).map((country) => ({
      key: country.code ?? country.country,
      flag: formatHealthMetricsCountryFlag(country.code),
      name: country.country,
      registrationsLabel: formatHealthMetricsEventsCount(country.registrations),
      pctLabel: formatHealthMetricsPercent(share(country.registrations)),
    })),
  };
}

function formatShowUpRate(period: HealthMetricsEventsAtAGlancePeriod | null): string {
  return period?.showUpRate === null || period?.showUpRate === undefined ? HEALTH_METRICS_TABLE_DASH : formatHealthMetricsPercent(period.showUpRate * 100);
}

function formatRevenueGoalSuffix(goal: number | null, withheld: boolean): string {
  if (withheld) return ` / ${HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD}`;
  return goal === null ? ' / no goal set' : ` / ${formatCurrency(goal)} (goal)`;
}

/** A goal cell's amount; "—" when unmeasured, or a $0 with no goal to read it against. */
function formatRevenueAmount(value: number | null, goal: number | null, withheld: boolean): string {
  const amount = revenueSortValue(value, goal, withheld);
  return amount === null ? HEALTH_METRICS_TABLE_DASH : formatCurrency(amount);
}

/** The amount a revenue cell shows: `null` for its "—" ($0 with no goal, or unmeasured). */
function revenueSortValue(value: number | null, goal: number | null, withheld: boolean): number | null {
  return value === null || (value === 0 && goal === null && !withheld) ? null : value;
}

function buildRevenueRowView(event: HealthMetricsEventsRevenueEvent): HealthMetricsEventsRevenueRowView {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    placeLabel: formatHealthMetricsEventsPlaceLabel(event),
    registrationLabel: formatRevenueAmount(event.registrationUsd, event.registrationGoal, event.registrationGoalWithheld),
    registrationGoalSuffix: formatRevenueGoalSuffix(event.registrationGoal, event.registrationGoalWithheld),
    sponsorshipLabel: formatRevenueAmount(event.sponsorshipUsd, event.sponsorshipGoal, event.sponsorshipGoalWithheld),
    sponsorshipGoalSuffix: formatRevenueGoalSuffix(event.sponsorshipGoal, event.sponsorshipGoalWithheld),
    // A "—" amount is empty, so it sorts last.
    sortValues: {
      event: event.eventName,
      registration: revenueSortValue(event.registrationUsd, event.registrationGoal, event.registrationGoalWithheld),
      sponsorship: revenueSortValue(event.sponsorshipUsd, event.sponsorshipGoal, event.sponsorshipGoalWithheld),
    },
  };
}

/** Start dates in either order, with an undated event last so it can't top the list. */
function compareStartDates(a: string | null, b: string | null, order: 'asc' | 'desc'): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return order === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

function buildPastRowView(event: HealthMetricsEventsPastEvent): HealthMetricsEventsPastRowView {
  const status = resolveHealthMetricsEventsPastStatus(event);
  const goal = hasHealthMetricsEventsGoal(event.goal) ? event.goal : null;

  return {
    eventId: event.eventId,
    eventName: event.eventName,
    placeLabel: formatHealthMetricsEventsPlaceLabel(event),
    registrationsLabel: formatDashCount(event.registrations),
    goalSuffix: goal === null ? ' / no goal set' : ` / ${formatHealthMetricsEventsCount(goal)} (goal)`,
    revenueLabel: event.revenueUsd === null ? HEALTH_METRICS_TABLE_DASH : formatCurrency(event.revenueUsd),
    status,
    statusLabel: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].label,
    statusTone: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].tone,
    // Event sorts by its date, not its name.
    sortValues: {
      event: event.eventStartDate,
      registrations: event.registrations,
      revenue: event.revenueUsd,
      status: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].label,
    },
  };
}

/** A count, or "—" when unmeasured. */
function formatDashCount(value: number | null | undefined): string {
  return value === null || value === undefined ? HEALTH_METRICS_TABLE_DASH : formatHealthMetricsEventsCount(value);
}

/** A metrics row change, as the design's `dlt`: "+12%" green, "−8%" red, "0%" grey, or "not available". */
function metricTrend(fraction: number | null): Pick<HealthMetricsMetricItem, 'trend' | 'trendTone'> {
  if (fraction === null) return { trend: HEALTH_METRICS_EVENTS_NOT_AVAILABLE, trendTone: 'flat' };

  const rounded = Math.round(fraction * 100);
  if (rounded === 0) return { trend: '0%', trendTone: 'flat' };
  return { trend: `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`, trendTone: rounded > 0 ? 'up' : 'down' };
}

/** A change as its badge shows it: whole percent, or points to one decimal. */
function glanceChangeValue(fraction: number, unit: 'pct' | 'pp'): number {
  return unit === 'pct' ? Math.round(fraction * 100) : Math.round(fraction * 1000) / 10;
}

/** A comparison-table change as the design's badge: success from 0 up ("+0%"), danger below; show-up rate in points. */
function glanceChange(fraction: number | null, unit: 'pct' | 'pp'): Pick<HealthMetricsEventsAtAGlanceRowView, 'change' | 'changeTone'> {
  if (fraction === null) return { change: null, changeTone: 'neutral' };

  const rounded = glanceChangeValue(fraction, unit);
  const magnitude = unit === 'pct' ? `${Math.abs(rounded)}%` : `${Math.abs(rounded).toFixed(1)}pp`;
  return rounded >= 0 ? { change: `+${magnitude}`, changeTone: 'success' } : { change: `−${magnitude}`, changeTone: 'danger' };
}

/**
 * The goal bar's fill from the raw forecast, as the design colours it, so a mis-entered goal keeps its colour while its
 * note and sort withhold the pace. An event with no forecast has no verdict, so its bar is gray.
 */
function forecastPace(event: HealthMetricsEventsForecastEvent, goal: number | null): keyof typeof HEALTH_METRICS_EVENTS_FORECAST_PACES {
  if (goal === null || event.forecastAvg === null) return 'none';
  if (event.forecastHigh !== null && event.forecastHigh < goal) return 'action';

  return event.forecastAvg < goal ? 'atRisk' : 'onTrack';
}

/** The verdict's copy as note parts, with its key figure in bold. */
function buildForecastVerdictNote(verdict: HealthMetricsEventsForecastVerdict): HealthMetricsNote {
  const forecast = formatHealthMetricsEventsCount(verdict.forecast);
  const goal = formatHealthMetricsEventsCount(verdict.goal);
  const gap = formatHealthMetricsEventsCount(verdict.gap);

  return { tone: verdict.tone, parts: forecastVerdictParts(verdict, { forecast, goal, gap }) };
}

function forecastVerdictParts(
  verdict: HealthMetricsEventsForecastVerdict,
  labels: { forecast: string; goal: string; gap: string }
): HealthMetricsFootnotePart[] {
  const { forecast, goal, gap } = labels;
  switch (verdict.kind) {
    case 'no-goal':
      return [
        plainPart('No registration goal is set, so there is nothing to pace against. The forecast still projects '),
        boldPart(forecast),
        plainPart(' registrations.'),
      ];
    case 'no-data':
      return [plainPart('There is no forecast for this event yet.')];
    case 'stale':
      return [
        plainPart('Forecast of '),
        boldPart(forecast),
        plainPart(
          ` is ${(verdict.ratio ?? 0).toFixed(1)}× the goal of ${goal} — the goal looks stale rather than the event over-performing. Worth re-setting before it is reported as success.`
        ),
      ];
    case 'goal-suspect':
      return [
        plainPart('Forecast of '),
        boldPart(forecast),
        plainPart(
          (verdict.ratio ?? 0) >= 1
            ? ` is ten or more times the goal of ${goal} — the goal looks mis-entered rather than the event over-performing. Worth checking before it is reported as success.`
            : ` is a tenth or less of the goal of ${goal} — the goal looks mis-entered rather than the event falling short. Worth checking before it is reported as a miss.`
        ),
      ];
    case 'on-track':
      return verdict.gap === 0
        ? [plainPart('On track to meet the goal. No action needed beyond keeping promotion running.')]
        : [plainPart('On track to clear the goal by about '), boldPart(gap), plainPart(' registrations. No action needed beyond keeping promotion running.')];
    default: {
      const lead =
        verdict.gap === 0
          ? [plainPart(`Projected to finish just short of the ${goal} goal.`)]
          : [plainPart('Projected to finish about '), boldPart(gap), plainPart(` short of the ${goal} goal.`)];
      return verdict.daysLeft === null
        ? lead
        : [...lead, plainPart(` ${daysLeftLead(verdict.daysLeft)} to close the gap — after that the opportunity is gone.`)];
    }
  }
}

function plainPart(value: string): HealthMetricsFootnotePart {
  return { text: value };
}

function boldPart(value: string): HealthMetricsFootnotePart {
  return { text: value, bold: true };
}

/** 0 means the event starts today, so it reads as the last day rather than "0 days left". */
function daysLeftLead(daysLeft: number): string {
  if (daysLeft === 0) return 'Today is the last day';
  return daysLeft === 1 ? 'There is 1 day left' : `There are ${formatHealthMetricsEventsCount(daysLeft)} days left`;
}

/** Registrations now against goal; null when either is unmeasured, since null is not zero. */
function resolveProgressRatio(event: HealthMetricsEventsForecastEvent): number | null {
  if (!hasHealthMetricsEventsGoal(event.goal) || event.registrationsNow === null) return null;

  return event.registrationsNow / event.goal;
}

/** "View all {N} proposals" from the period's total; an unmeasured total drops the count rather than read as zero. */
function formatSpeakersViewAllLabel(total: number | null): string {
  if (total === null) return 'View all proposals';
  return `View all ${formatHealthMetricsEventsCount(total)} ${total === 1 ? 'proposal' : 'proposals'}`;
}

/** Most recent first; the proposal key breaks ties so the order is stable. */
function compareProposalsByRecency(a: HealthMetricsEventsSpeakersProposal, b: HealthMetricsEventsSpeakersProposal): number {
  const byDate = (b.submissionDate ?? '').localeCompare(a.submissionDate ?? '');
  return byDate !== 0 ? byDate : a.proposalKey.localeCompare(b.proposalKey);
}

/** Proposals by year, one column per year the view holds, Accepted under In review under Declined; independent of the period. */
function buildSpeakersChart(speakers: HealthMetricsEventsSpeakers): HealthMetricsColumnChartView {
  const columns = HEALTH_METRICS_L2_RANGES.map((yearRange) => {
    const year = getYearForRange(yearRange);
    const period = speakers.periods.find((candidate) => candidate.range === yearRange) ?? null;
    const current = yearRange === 'YTD';
    return {
      key: String(year),
      label: String(year),
      sub: '',
      values: period && [period.accepted, period.inReview, period.declined],
      total: period?.submitted ?? null,
      muted: !current,
      tipTitle: current ? `${year} · partial year` : String(year),
    };
  });

  // A year with no total still draws its known statuses, so the axis fits whichever is taller.
  const heights = columns.map((column) =>
    Math.max(
      column.total ?? 0,
      (column.values ?? []).reduce<number>((sum, value) => sum + (value ?? 0), 0)
    )
  );

  return buildHealthMetricsColumnChart({
    series: [...HEALTH_METRICS_EVENTS_SPEAKERS_SERIES],
    columns,
    peak: Math.max(0, ...heights),
    heightPx: HEALTH_METRICS_EVENTS_SPEAKERS_CHART_HEIGHT_PX,
    barWidthPx: HEALTH_METRICS_EVENTS_CHART_BAR_WIDTH_PX,
    formatTotal: formatHealthMetricsEventsCount,
    formatValue: formatHealthMetricsEventsCount,
    ariaLabel: 'Proposals by year, by status',
  });
}

/** A proposal's labels, shared by the recent proposals table and the All speaker proposals drawer. */
export function buildHealthMetricsEventsSpeakersProposalRowView(proposal: HealthMetricsEventsSpeakersProposal): HealthMetricsEventsSpeakersProposalRowView {
  // Only the view's flag makes a speaker an individual; a company with no name reads "—".
  const company = proposal.unaffiliated ? HEALTH_METRICS_EVENTS_SPEAKERS_INDIVIDUAL : (proposal.organizationName ?? HEALTH_METRICS_TABLE_DASH);
  const group = proposal.statusGroup ? HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[proposal.statusGroup] : null;
  const date = proposal.submissionDate ? formatIsoDateLabel(proposal.submissionDate) : '';

  return {
    key: proposal.proposalKey,
    // The speaker is shown by job title, never by name; with none, the session title leads.
    title: proposal.jobTitle ?? proposal.sessionTitle,
    description: proposal.jobTitle ? proposal.sessionTitle : '',
    company: { kind: 'company', name: company, logoUrl: proposal.unaffiliated ? '' : proposal.logoUrl },
    eventName: proposal.eventName,
    dateLabel: date || HEALTH_METRICS_TABLE_DASH,
    eventLine: [proposal.eventName, date].filter(Boolean).join(' · '),
    statusLabel: group?.label ?? proposal.status,
    statusTone: group?.tone ?? 'neutral',
  };
}
