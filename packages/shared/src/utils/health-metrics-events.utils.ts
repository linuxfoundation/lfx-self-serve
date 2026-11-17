// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE,
  HEALTH_METRICS_EVENTS_FORECAST_PACES,
  HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_NOT_AVAILABLE,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP,
  HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE,
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_VIRTUAL_SHARE,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_YEARS,
  HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
  HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_UNGROUPED_BADGE_CLASS,
  HEALTH_METRICS_EVENTS_SPONSORSHIP_GOAL_NOT_SET,
} from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_BASE_PATH } from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import { HEALTH_METRICS_OVERVIEW_TREND_PREDICTED_TIP } from '../constants/health-metrics-overview.constants';
import { HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_SEARCH_LENGTH, HEALTH_METRICS_MEMBERS_QUERY_PARAMS } from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH, HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS } from '../constants/health-metrics-non-members.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { formatCurrency } from './number.utils';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlanceDelta,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsAtAGlanceStatView,
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
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsPastRowView,
  HealthMetricsEventsPastStatus,
  HealthMetricsEventsPastView,
  HealthMetricsEventsRegistrationsGrowth,
  HealthMetricsEventsRegistrationsGrowthMetric,
  HealthMetricsEventsRegistrationsGrowthRowView,
  HealthMetricsEventsRegistrationsGrowthView,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsRevenueEvent,
  HealthMetricsEventsRevenueRowView,
  HealthMetricsEventsRevenueView,
  HealthMetricsEventsRegistrationsGrowthYear,
  HealthMetricsEventsSectionKey,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsRankedRowInput,
  HealthMetricsEventsRankedRowView,
  HealthMetricsEventsSpeakersProposal,
  HealthMetricsEventsSpeakersProposalRowView,
  HealthMetricsEventsSpeakersStatusGroup,
  HealthMetricsEventsSpeakersTab,
  HealthMetricsEventsSpeakersView,
  HealthMetricsEventsSpeakersYearView,
  HealthMetricsEventsSponsorship,
  HealthMetricsEventsSponsorshipProgressView,
  HealthMetricsEventsSponsorshipView,
  HealthMetricsEventsSubNavItem,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsFootnotePart, HealthMetricsNote } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';

/** Sub-nav items for the Events tab; a section notes only once it reports a note. */
export function buildHealthMetricsEventsSubNavItems(notes: Partial<Record<HealthMetricsEventsSectionKey, string>> = {}): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: notes[section.key] ?? '' }));
}

/** One organizations row. A zero sponsorship or proposal count reads as `—`: the view cannot tell it from not tracked. */
export function buildHealthMetricsEventsOrganizationRowView(organization: HealthMetricsEventsOrganization): HealthMetricsEventsOrganizationRowView {
  const membership = organization.isMember ? HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.member : HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.nonMember;
  const share = organization.registrationsShare ?? 0;

  return {
    accountId: organization.accountId,
    accountName: organization.accountName,
    memberLabel: membership.label,
    memberGlyph: membership.glyph,
    memberClass: membership.textClass,
    registrationsLabel: formatHealthMetricsEventsCount(organization.registrations),
    barWidthPct: Math.min(Math.max(share * 100, 0), 100),
    sponsorshipLabel: organization.sponsorshipUsd ? formatCurrency(organization.sponsorshipUsd) : '—',
    proposalsLabel: organization.proposals ? formatHealthMetricsEventsCount(organization.proposals) : '—',
    speakersLabel: formatHealthMetricsEventsCount(organization.speakers),
    eventsLabel: formatHealthMetricsEventsCount(organization.events),
    link: buildHealthMetricsEventsOrganizationLink(organization),
    linkLabel: `Open ${organization.accountName} in ${organization.isMember ? 'Members' : 'Non-Members'}`,
  };
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

/** The control line, e.g. `1,204 organizations`; `—` while the count is unknown. */
export function formatHealthMetricsEventsOrganizationsCountLabel(total: number | null): string {
  if (total === null) return '—';

  return `${formatHealthMetricsEventsCount(total)} ${total === 1 ? 'organization' : 'organizations'}`;
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

/** One period's section: the view's count and registrations, with the goal tally read off the same rows as the chips. */
export function buildHealthMetricsEventsPastView(past: HealthMetricsEventsPast, range: HealthMetricsRange): HealthMetricsEventsPastView {
  const period = past.periods.find((candidate) => candidate.range === range);
  const rows = past.events.filter((event) => event.ranges.some((candidate) => candidate === range)).map(buildPastRowView);

  return {
    eventCount: period?.eventCount ?? null,
    registrations: period?.registrations ?? null,
    goalMetCount: rows.filter((row) => row.status === 'hit').length,
    goalSetCount: rows.filter((row) => row.status !== 'no-goal' && row.status !== 'unmeasured').length,
    hasGoals: rows.some((row) => row.status !== 'no-goal'),
    rows,
  };
}

/** The control line: how many events the period closed; `—` when the period is unmeasured. */
export function formatHealthMetricsEventsPastClosedLabel(eventCount: number | null): string {
  if (eventCount === null) return '—';

  return `${formatHealthMetricsEventsCount(eventCount)} ${eventCount === 1 ? 'event' : 'events'} closed this period`;
}

/** `$0` is a measured result; only an unmeasured revenue reads as not available. */
export function formatHealthMetricsEventsRevenue(value: number | null): string {
  return value === null ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : formatCurrency(value);
}

/** One period's at-a-glance section. For YTD the events total adds the upcoming ones to those held so far; it carries no delta. */
export function buildHealthMetricsEventsAtAGlanceView(glance: HealthMetricsEventsAtAGlance, range: HealthMetricsRange): HealthMetricsEventsAtAGlanceView {
  const period = glance.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const upcoming = range === 'YTD' ? glance.upcomingEvents : 0;
  const past = period?.pastEvents ?? null;
  const total = past === null || upcoming === null ? null : past + upcoming;
  const noDelta: HealthMetricsEventsAtAGlanceDelta = { delta: null, deltaDirection: 'neutral' };
  // `null` changes means the period is not compared, so its figures carry no delta at all.
  const delta = (value: number | null | undefined, unit: 'pct' | 'pp' = 'pct'): HealthMetricsEventsAtAGlanceDelta =>
    changes ? formatAtAGlanceDelta(value ?? null, unit) : noDelta;
  const stat = (key: string, label: string, value: string, change: HealthMetricsEventsAtAGlanceDelta): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value,
    ...change,
  });

  return {
    measured: period !== null,
    controlLabel: [formatCountPart(total, 'events'), formatCountPart(past, 'past'), formatCountPart(upcoming, 'upcoming')].join(' · '),
    baselineLabel: formatAtAGlanceBaseline(range, changes !== null),
    headline: stat('registrations', 'Total registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
    side: [
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees)),
      stat('show-up-rate', 'Show-up rate', formatShowUpRate(period), delta(changes?.showUpRatePts, 'pp')),
      stat('events', 'Events', formatAtAGlanceCount(total), noDelta),
    ],
    tiles: [
      stat('registrations', 'Registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees)),
      stat('organizations', 'Companies', formatAtAGlanceCount(period?.organizations), delta(changes?.organizations)),
      stat('speakers', 'Speakers', formatAtAGlanceCount(period?.speakers), delta(changes?.speakers)),
      stat('countries', 'Countries', formatAtAGlanceCount(period?.countries), delta(changes?.countries)),
      stat('past-upcoming', 'Past / upcoming', formatPastUpcoming(past, upcoming), noDelta),
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
  const delta = (value: number | null | undefined): HealthMetricsEventsAtAGlanceDelta =>
    changes ? formatAtAGlanceDelta(value ?? null, 'pct') : { delta: null, deltaDirection: 'neutral' };
  const stat = (
    key: string,
    label: string,
    value: number | null | undefined,
    change: HealthMetricsEventsAtAGlanceDelta
  ): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value: formatHealthMetricsEventsRevenue(value ?? null),
    ...change,
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
    headline: stat('total', 'Total event revenue', period?.totalUsd, delta(changes?.total)),
    side: [
      stat('registration', 'Registration', period?.registrationUsd, delta(changes?.registration)),
      stat('sponsorship', 'Sponsorship', period?.sponsorshipUsd, delta(changes?.sponsorship)),
      { key: 'split', label: 'Split', value: formatRevenueSplit(period?.registrationShare ?? null), delta: null, deltaDirection: 'neutral' },
    ],
    rows,
    eventsMeasured: revenue.eventsMeasured,
    hasUnconverted: period?.hasUnconverted === true || rows.some((row) => row.event.hasUnconverted),
    headlineUnconverted: period?.hasUnconverted === true,
  };
}

/** Every year from the first to the last with events, oldest first; a gap year is left unrecorded, never zeroed. */
export function buildHealthMetricsEventsRegistrationsGrowthView(
  growth: HealthMetricsEventsRegistrationsGrowth,
  metric: HealthMetricsEventsRegistrationsGrowthMetric
): HealthMetricsEventsRegistrationsGrowthView {
  const byYear = new Map(growth.years.map((year) => [year.year, year]));
  const years = [...byYear.keys()];
  if (years.length === 0) return { rows: [], yearCount: 0, pandemicNote: null };

  const first = Math.min(...years);
  const last = Math.max(...years);
  const rows = Array.from({ length: last - first + 1 }, (_, index) =>
    buildRegistrationsGrowthRowView(first + index, byYear.get(first + index) ?? null, metric)
  );

  return {
    rows,
    yearCount: rows.length,
    pandemicNote: formatRegistrationsGrowthPandemicNote(rows, metric),
  };
}

/** Explains the pandemic years only when one was mostly virtual, so a small virtual count never reads as a peak. */
function formatRegistrationsGrowthPandemicNote(
  rows: HealthMetricsEventsRegistrationsGrowthRowView[],
  metric: HealthMetricsEventsRegistrationsGrowthMetric
): string | null {
  const years = HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_YEARS;
  const mostlyVirtual = rows.some(
    (row) =>
      years.includes(row.year) &&
      row.virtual !== null &&
      row.total !== null &&
      row.total > 0 &&
      row.virtual / row.total >= HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_VIRTUAL_SHARE
  );
  if (!mostlyVirtual) return null;

  const first = Math.min(...years);
  const last = Math.max(...years);
  const label = first === last ? `${first}` : `${first}–${String(last).slice(-2)}`;
  return `${label} ${metric} were mostly virtual during the pandemic, so the years since read as a return to in-person rather than a collapse.`;
}

/** One period's speakers section; the tab picks the count beside the tabs and the proposals listed. */
export function buildHealthMetricsEventsSpeakersView(
  speakers: HealthMetricsEventsSpeakers,
  range: HealthMetricsRange,
  tab: HealthMetricsEventsSpeakersTab
): HealthMetricsEventsSpeakersView {
  const period = speakers.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const stat = (
    key: string,
    label: string,
    value: string,
    change: HealthMetricsEventsAtAGlanceDelta = { delta: null, deltaDirection: 'neutral' }
  ): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value,
    ...change,
  });
  const tabCounts: Record<HealthMetricsEventsSpeakersTab, number | null> = {
    all: period?.submitted ?? null,
    accepted: period?.accepted ?? null,
    'in-review': period?.inReview ?? null,
  };
  const statusCounts: Record<HealthMetricsEventsSpeakersStatusGroup, number | null> = {
    accepted: period?.accepted ?? null,
    'in-review': period?.inReview ?? null,
    declined: period?.declined ?? null,
  };
  const organizations = speakers.organizations
    .flatMap((organization) => {
      const entry = organization.periods.find((candidate) => candidate.range === range);
      return entry
        ? [
            {
              key: organization.accountId,
              label: organization.accountName,
              rank: entry.rank,
              value: entry.submitted,
            },
          ]
        : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS);
  const individual = speakers.unaffiliated.find((candidate) => candidate.range === range)?.submitted ?? null;

  return {
    foundationMeasured: speakers.periods.length > 0,
    measured: period !== null && period.submitted !== null,
    countLabel: formatProposalCount(tabCounts[tab]),
    headline: stat('accepted', 'Accepted proposals', formatAtAGlanceCount(period?.accepted)),
    side: [
      stat('total', 'Total proposals', formatAtAGlanceCount(period?.submitted)),
      stat('acceptance-rate', 'Acceptance rate', formatWholePercent(period?.acceptanceRate ?? null)),
      stat('speakers', 'Speakers', formatAtAGlanceCount(period?.speakers), changes ? formatAtAGlanceDelta(changes.speakers, 'pct') : undefined),
    ],
    statusRows: buildRankedRows(
      (Object.keys(HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS) as HealthMetricsEventsSpeakersStatusGroup[])
        .map((group) => ({
          key: group,
          label: HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[group].label,
          value: statusCounts[group],
        }))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    ),
    organizations: buildRankedRows(organizations),
    individualLabel: individual ? `${formatProposalCount(individual)} submitted` : null,
    proposals: speakers.proposals
      .filter((proposal) => proposal.range === range && (tab === 'all' || proposal.statusGroup === tab))
      .sort(compareProposalsByRecency)
      .slice(0, HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS)
      .map(buildSpeakersProposalRowView),
  };
}

/** Proposals per year, oldest first; independent of the period and tab, so the chart survives both. */
export function buildHealthMetricsEventsSpeakersYears(speakers: HealthMetricsEventsSpeakers): HealthMetricsEventsSpeakersYearView[] {
  return HEALTH_METRICS_L2_RANGES.map((yearRange) => {
    const year = getYearForRange(yearRange);
    const submitted = speakers.periods.find((candidate) => candidate.range === yearRange)?.submitted ?? null;
    const isPartialYear = yearRange === 'YTD';

    return { year, submitted, isPartialYear, yearLabel: isPartialYear ? `${year} (partial year)` : `${year}`, submittedLabel: formatAtAGlanceCount(submitted) };
  });
}

/** The sub-nav note, set only when speakers fell steeply against the year before. */
export function buildHealthMetricsEventsSpeakersNote(speakers: HealthMetricsEventsSpeakers, range: HealthMetricsRange): string {
  const change = speakers.periods.find((candidate) => candidate.range === range)?.changes?.speakers ?? null;
  if (change === null || change >= HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE) return '';

  return `down ${Math.round(Math.abs(change) * 100)}% YoY`;
}

/** One period's sponsorship section. Progress shows only against a goal that is set, so no goal never reads as a full bar. */
export function buildHealthMetricsEventsSponsorshipView(
  sponsorship: HealthMetricsEventsSponsorship,
  range: HealthMetricsRange
): HealthMetricsEventsSponsorshipView {
  const period = sponsorship.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const stat = (key: string, label: string, value: string, change?: HealthMetricsEventsAtAGlanceDelta): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value,
    ...(change ?? { delta: null, deltaDirection: 'neutral' }),
  });
  const tierPackages = period?.tierPackages ?? null;
  const addOns = period?.addOns ?? null;

  return {
    foundationMeasured: sponsorship.periods.length > 0,
    measured: period !== null && period.revenueUsd !== null,
    packagesLabel: formatSponsorshipPackagesLabel(tierPackages),
    headline: stat(
      'revenue',
      'Sponsorship revenue',
      formatHealthMetricsEventsRevenue(period?.revenueUsd ?? null),
      changes ? formatAtAGlanceDelta(changes.revenue, 'pct') : undefined
    ),
    side: [
      stat('goal', 'Goal', period?.goalUsd ? formatCurrency(period.goalUsd) : HEALTH_METRICS_EVENTS_SPONSORSHIP_GOAL_NOT_SET),
      stat('tier-packages', 'Tier packages', formatAtAGlanceCount(tierPackages)),
      stat('add-ons', 'Add-ons', formatAtAGlanceCount(addOns)),
    ],
    goalSet: !!period?.goalUsd,
    progress: period?.goalUsd ? resolveSponsorshipProgress(period.progressToGoal) : null,
    tiers: buildRankedRows((period?.tiers ?? []).map((tier) => ({ key: tier.name, label: tier.name, value: tier.packages }))),
  };
}

/** The section for one period; a period with no country registrations reads as not available, never as zero countries. */
export function buildHealthMetricsEventsGeographyView(geography: HealthMetricsEventsGeography, range: HealthMetricsRange): HealthMetricsEventsGeographyView {
  const period = geography.periods.find((candidate) => candidate.range === range) ?? null;
  const topCountries = period?.topCountries ?? [];
  const measured = topCountries.length > 0;
  const countries = measured ? (period?.countries ?? null) : null;
  const changes = measured ? (period?.changes ?? null) : null;

  return {
    foundationMeasured: geography.periods.length > 0,
    measured,
    countriesLabel: formatGeographyCountriesLabel(countries),
    headline: {
      key: 'countries',
      label: 'Countries represented',
      value: formatAtAGlanceCount(countries),
      ...(changes ? formatAtAGlanceDelta(changes.countries, 'pct') : { delta: null, deltaDirection: 'neutral' }),
    },
    topCountries: buildRankedRows(topCountries.map((country) => ({ key: country.country, label: country.country, value: country.registrations }))),
  };
}

function formatAtAGlanceCount(value: number | null | undefined): string {
  return value === null || value === undefined ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : value.toLocaleString('en-US');
}

function formatCountPart(value: number | null, noun: string): string {
  if (value === null) return `${noun} ${HEALTH_METRICS_EVENTS_NOT_AVAILABLE}`;

  return `${value.toLocaleString('en-US')} ${value === 1 && noun === 'events' ? 'event' : noun}`;
}

function formatShowUpRate(period: HealthMetricsEventsAtAGlancePeriod | null): string {
  return period?.showUpRate === null || period?.showUpRate === undefined ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : `${Math.round(period.showUpRate * 100)}%`;
}

function formatPastUpcoming(past: number | null, upcoming: number | null): string {
  if (past === null || upcoming === null) return HEALTH_METRICS_EVENTS_NOT_AVAILABLE;

  return `${past.toLocaleString('en-US')} / ${upcoming.toLocaleString('en-US')}`;
}

function formatAtAGlanceBaseline(range: HealthMetricsRange, compared: boolean): string {
  if (!compared) return 'no year-over-year comparison for this period';
  if (range === 'YTD') return 'all against the same point last year';

  return `all against ${getYearForRange(range) - 1}`;
}

/** A change as a whole percent (`−25%`) or, for a rate, points at one decimal (`+2.2 pp`); the sign follows the rounded value. */
function formatAtAGlanceDelta(fraction: number | null, unit: 'pct' | 'pp'): HealthMetricsEventsAtAGlanceDelta {
  if (fraction === null) return { delta: HEALTH_METRICS_EVENTS_NOT_AVAILABLE, deltaDirection: 'neutral' };

  const rounded = unit === 'pct' ? Math.round(fraction * 100) : Number((fraction * 100).toFixed(1));
  const magnitude = unit === 'pct' ? `${Math.abs(rounded)}%` : `${Math.abs(rounded).toFixed(1)} pp`;
  if (rounded === 0) return { delta: magnitude, deltaDirection: 'neutral' };

  return { delta: `${rounded > 0 ? '+' : '−'}${magnitude}`, deltaDirection: rounded > 0 ? 'up' : 'down' };
}

/** Registration over sponsorship as whole percents that sum to 100, e.g. `70 / 30`. */
function formatRevenueSplit(registrationShare: number | null): string {
  if (registrationShare === null) return HEALTH_METRICS_EVENTS_NOT_AVAILABLE;

  const registrationPct = Math.round(registrationShare * 100);
  return `${registrationPct} / ${100 - registrationPct}`;
}

function formatRevenueGoal(goal: number | null, withheld: boolean): string {
  if (withheld) return HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD;
  return goal === null ? '' : formatCurrency(goal);
}

function buildRevenueRowView(event: HealthMetricsEventsRevenueEvent): HealthMetricsEventsRevenueRowView {
  return {
    event,
    dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
    registrationLabel: formatHealthMetricsEventsRevenue(event.registrationUsd),
    registrationGoalLabel: formatRevenueGoal(event.registrationGoal, event.registrationGoalWithheld),
    sponsorshipLabel: formatHealthMetricsEventsRevenue(event.sponsorshipUsd),
    sponsorshipGoalLabel: formatRevenueGoal(event.sponsorshipGoal, event.sponsorshipGoalWithheld),
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

  return {
    event,
    status,
    statusLabel: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].label,
    statusClass: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].badgeClass,
    dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
    registrationsLabel: formatHealthMetricsEventsCount(event.registrations),
    goalLabel: formatHealthMetricsEventsCount(hasHealthMetricsEventsGoal(event.goal) ? event.goal : null),
    hasGoal: hasHealthMetricsEventsGoal(event.goal),
    revenueLabel: formatHealthMetricsEventsRevenue(event.revenueUsd),
  };
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

function buildRegistrationsGrowthRowView(
  year: number,
  data: HealthMetricsEventsRegistrationsGrowthYear | null,
  metric: HealthMetricsEventsRegistrationsGrowthMetric
): HealthMetricsEventsRegistrationsGrowthRowView {
  if (data === null) {
    return { year, recorded: false, isPartialYear: false, total: null, inPerson: null, virtual: null, totalLabel: '—', inPersonLabel: '—', virtualLabel: '—' };
  }

  const attendees = metric === 'attendees';
  const total = attendees ? data.totalAttendees : data.totalRegistrations;
  const inPerson = attendees ? data.inPersonAttendees : data.inPersonRegistrations;
  const virtual = attendees ? data.virtualAttendees : data.virtualRegistrations;

  return {
    year,
    recorded: true,
    isPartialYear: data.isPartialYear,
    total,
    inPerson,
    virtual,
    totalLabel: formatHealthMetricsEventsCount(total),
    inPersonLabel: formatHealthMetricsEventsCount(inPerson),
    // The design dashes a year with no virtual count, since most in-person-only years record zero.
    virtualLabel: virtual === 0 ? '—' : formatHealthMetricsEventsCount(virtual),
  };
}

/** Empty when unmeasured, since the section then renders no pill. */
function formatSponsorshipPackagesLabel(value: number | null): string {
  if (value === null) return '';

  return `${value.toLocaleString('en-US')} ${value === 1 ? 'package' : 'packages'} sold`;
}

/** Empty when unmeasured, since the section then renders no pill. */
function formatGeographyCountriesLabel(value: number | null): string {
  if (value === null) return '';

  return `${value.toLocaleString('en-US')} ${value === 1 ? 'country' : 'countries'}`;
}

/** Empty when unmeasured, since the section then renders no figures at all. */
function formatProposalCount(value: number | null): string {
  if (value === null) return '';

  return `${value.toLocaleString('en-US')} ${value === 1 ? 'proposal' : 'proposals'}`;
}

function formatWholePercent(fraction: number | null): string {
  return fraction === null ? HEALTH_METRICS_EVENTS_NOT_AVAILABLE : `${Math.round(fraction * 100)}%`;
}

/** Ranked-list rows, name and value only; an unmeasured value reads as not available. */
function buildRankedRows(items: HealthMetricsEventsRankedRowInput[]): HealthMetricsEventsRankedRowView[] {
  return items.map((item) => ({ key: item.key, label: item.label, valueLabel: formatAtAGlanceCount(item.value) }));
}

/** `null` without a modelled progress; the width stops at full while the label keeps the real percent. */
function resolveSponsorshipProgress(progress: number | null): HealthMetricsEventsSponsorshipProgressView | null {
  if (progress === null) return null;

  const pct = Math.round(progress * 100);
  return { pctLabel: `${pct}%`, widthPct: Math.min(Math.max(pct, 0), 100) };
}

/** Most recent first; the proposal key breaks ties so the order is stable. */
function compareProposalsByRecency(a: HealthMetricsEventsSpeakersProposal, b: HealthMetricsEventsSpeakersProposal): number {
  const byDate = (b.submissionDate ?? '').localeCompare(a.submissionDate ?? '');
  return byDate !== 0 ? byDate : a.proposalKey.localeCompare(b.proposalKey);
}

function buildSpeakersProposalRowView(proposal: HealthMetricsEventsSpeakersProposal): HealthMetricsEventsSpeakersProposalRowView {
  let organizationLabel = proposal.organizationName ?? '—';
  if (proposal.unaffiliated) organizationLabel = 'Individual';

  return {
    proposal,
    organizationLabel,
    dateLabel: proposal.submissionDate ? formatIsoDateLabel(proposal.submissionDate) : '—',
    statusClass: proposal.statusGroup
      ? HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[proposal.statusGroup].badgeClass
      : HEALTH_METRICS_EVENTS_SPEAKERS_UNGROUPED_BADGE_CLASS,
  };
}
