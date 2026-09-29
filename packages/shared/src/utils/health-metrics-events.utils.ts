// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE,
  HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX,
  HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_FORECAST_STATUSES,
  HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO,
  HEALTH_METRICS_EVENTS_GEOGRAPHY_BAR_CLASS,
  HEALTH_METRICS_EVENTS_NOT_AVAILABLE,
  HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP,
  HEALTH_METRICS_EVENTS_PAST_NEAR_MISS_PACE,
  HEALTH_METRICS_EVENTS_PAST_STATUSES,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_VIRTUAL_SHARE,
  HEALTH_METRICS_EVENTS_REGISTRATIONS_GROWTH_PANDEMIC_YEARS,
  HEALTH_METRICS_EVENTS_REVENUE_GOAL_WITHHELD,
  HEALTH_METRICS_EVENTS_SECTIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_ORGANIZATION_BAR_CLASS,
  HEALTH_METRICS_EVENTS_SPEAKERS_RECENT_PROPOSALS,
  HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS,
  HEALTH_METRICS_EVENTS_SPEAKERS_TOP_ORGANIZATIONS,
  HEALTH_METRICS_EVENTS_SPEAKERS_UNGROUPED_BADGE_CLASS,
  HEALTH_METRICS_EVENTS_SPONSORSHIP_BAR_CLASS,
  HEALTH_METRICS_EVENTS_SPONSORSHIP_GOAL_NOT_SET,
} from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
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
  HealthMetricsEventsGeography,
  HealthMetricsEventsGeographyView,
  HealthMetricsEventsOrganization,
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
  HealthMetricsEventsSpeakersBarInput,
  HealthMetricsEventsSpeakersBarView,
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
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';

/** Sub-nav items for the Events tab. The forecast carries a note but, per the design, no badge. */
export function buildHealthMetricsEventsSubNavItems(
  notes: Partial<Record<HealthMetricsEventsSectionKey, string>> = {},
  counts: Partial<Record<HealthMetricsEventsSectionKey, number | null>> = {}
): HealthMetricsEventsSubNavItem[] {
  return HEALTH_METRICS_EVENTS_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    count: counts[section.key] ?? null,
    note: notes[section.key] ?? '',
  }));
}

/** One organizations row. A zero sponsorship or proposal count reads as `—`: the view cannot tell it from not tracked. */
export function buildHealthMetricsEventsOrganizationRowView(organization: HealthMetricsEventsOrganization): HealthMetricsEventsOrganizationRowView {
  const membership = organization.isMember ? HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.member : HEALTH_METRICS_EVENTS_ORGANIZATIONS_MEMBERSHIP.nonMember;
  const share = organization.registrationsShare ?? 0;

  return {
    accountId: organization.accountId,
    accountName: organization.accountName,
    logoUrl: organization.logoUrl ?? '',
    memberLabel: membership.label,
    memberClass: membership.badgeClass,
    registrationsLabel: formatHealthMetricsEventsCount(organization.registrations),
    barWidthPct: Math.min(Math.max(share * 100, 0), 100),
    sponsorshipLabel: organization.sponsorshipUsd ? formatCurrency(organization.sponsorshipUsd) : '—',
    proposalsLabel: organization.proposals ? formatHealthMetricsEventsCount(organization.proposals) : '—',
    speakersLabel: formatHealthMetricsEventsCount(organization.speakers),
    eventsLabel: formatHealthMetricsEventsCount(organization.events),
  };
}

/** The control line, e.g. `1,204 organizations`; `—` while the count is unknown. */
export function formatHealthMetricsEventsOrganizationsCountLabel(total: number | null): string {
  if (total === null) return '—';

  return `${formatHealthMetricsEventsCount(total)} ${total === 1 ? 'organization' : 'organizations'}`;
}

/** True when goal and forecast differ by an order of magnitude or more — a data-entry problem, not a pace. */
export function isHealthMetricsEventsForecastGoalSuspect(event: HealthMetricsEventsForecastEvent): boolean {
  if (event.goal === null || event.goal <= 0 || event.forecastAvg === null) return false;

  const ratio = event.forecastAvg / event.goal;
  return ratio >= HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO || ratio <= 1 / HEALTH_METRICS_EVENTS_FORECAST_WITHHELD_GOAL_RATIO;
}

/**
 * EVT-01: upper forecast below goal is Action required, central below goal is At risk, else On track.
 * The band narrows as the event nears, so the rule calibrates itself.
 */
export function resolveHealthMetricsEventsForecastStatus(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastStatus {
  // No forecast outranks no goal: there is nothing to show either way, and the contract says No data.
  if (event.forecastAvg === null) return 'no-data';
  if (event.goal === null || event.goal <= 0) return 'no-goal';
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return 'no-data';
  if (event.forecastHigh !== null && event.forecastHigh < event.goal) return 'action';
  if (event.forecastAvg < event.goal) return 'at-risk';

  return 'on-track';
}

/** The callout under the headline. A goal 3× under the forecast reads as stale, not as success. */
export function resolveHealthMetricsEventsForecastVerdict(event: HealthMetricsEventsForecastEvent): HealthMetricsEventsForecastVerdict {
  const base = { forecast: event.forecastAvg, goal: event.goal, gap: 0, ratio: null, daysLeft: event.daysLeft };

  if (event.forecastAvg === null) return { ...base, kind: 'no-data', tone: 'none' };
  if (event.goal === null || event.goal <= 0) return { ...base, kind: 'no-goal', tone: 'none' };

  // Mis-entered goes first, so a 10× gap reads the same as the chip, which withholds it.
  const ratio = event.forecastAvg / event.goal;
  if (isHealthMetricsEventsForecastGoalSuspect(event)) return { ...base, kind: 'goal-suspect', tone: 'watch', ratio };
  if (ratio >= HEALTH_METRICS_EVENTS_FORECAST_STALE_GOAL_RATIO) return { ...base, kind: 'stale', tone: 'watch', ratio };

  // Branch on the raw values, as the chip does, and round only the gap shown.
  const gap = Math.round(Math.abs(event.forecastAvg - event.goal));
  if (event.forecastAvg >= event.goal) return { ...base, kind: 'on-track', tone: 'ok', gap };

  return { ...base, kind: 'short', tone: 'act', gap };
}

/** Sub-nav note: events projected under goal, leaving out the ones whose goal looks mis-entered. */
export function buildHealthMetricsEventsForecastNote(events: HealthMetricsEventsForecastEvent[]): string {
  const missing = events.filter((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    return status === 'action' || status === 'at-risk';
  }).length;

  return missing > 0 ? `${missing} will miss goal` : '';
}

/** Events a forecast can be drawn for — the selector's pills. */
export function filterHealthMetricsEventsForecastable(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  return events.filter((event) => event.forecastAvg !== null);
}

/** Worst pacing first by registrations against goal; events with no usable goal or count go last. */
export function sortHealthMetricsEventsForecastRows(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastEvent[] {
  const pace = (event: HealthMetricsEventsForecastEvent): number =>
    isHealthMetricsEventsForecastGoalSuspect(event) ? Number.POSITIVE_INFINITY : (resolveProgressRatio(event) ?? Number.POSITIVE_INFINITY);

  return [...events].sort((a, b) => pace(a) - pace(b) || a.eventName.localeCompare(b.eventName, 'en-US'));
}

/** The table's rows with every label resolved, so the template formats nothing per render. */
export function buildHealthMetricsEventsForecastRowViews(events: HealthMetricsEventsForecastEvent[]): HealthMetricsEventsForecastRowView[] {
  return sortHealthMetricsEventsForecastRows(events).map((event) => {
    const status = resolveHealthMetricsEventsForecastStatus(event);
    const ratio = resolveProgressRatio(event);
    const pct = ratio === null ? null : Math.round(ratio * 100);

    return {
      event,
      status,
      statusLabel: HEALTH_METRICS_EVENTS_FORECAST_STATUSES[status].label,
      statusClass: HEALTH_METRICS_EVENTS_FORECAST_STATUSES[status].badgeClass,
      dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
      registrationsLabel: formatHealthMetricsEventsCount(event.registrationsNow),
      goalLabel: formatHealthMetricsEventsCount(event.goal),
      progressPct: pct === null ? null : Math.min(pct, 100),
      progressClass: resolveProgressClass(pct),
    };
  });
}

/** Rounded, `en-US`-pinned so the server render and the hydrated one agree; `—` for unmeasured. */
export function formatHealthMetricsEventsCount(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('en-US');
}

/** A pill label, truncated with an ellipsis past the design's length. */
export function truncateHealthMetricsEventsPillName(name: string): string {
  return name.length > HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX ? `${name.slice(0, HEALTH_METRICS_EVENTS_FORECAST_PILL_NAME_MAX - 2)}…` : name;
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
  if (event.goal === null) return 'no-goal';
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

/** One period's at-a-glance section. For YTD the events total adds the upcoming ones to those held so far. */
export function buildHealthMetricsEventsAtAGlanceView(glance: HealthMetricsEventsAtAGlance, range: HealthMetricsRange): HealthMetricsEventsAtAGlanceView {
  const period = glance.periods.find((candidate) => candidate.range === range) ?? null;
  const changes = period?.changes ?? null;
  const upcoming = range === 'YTD' ? glance.upcomingEvents : 0;
  const past = period?.pastEvents ?? null;
  const total = past === null || upcoming === null ? null : past + upcoming;
  // `null` changes means the period is not compared, so its figures carry no delta at all.
  const delta = (value: number | null | undefined, unit: 'pct' | 'pp' = 'pct'): HealthMetricsEventsAtAGlanceDelta =>
    changes ? formatAtAGlanceDelta(value ?? null, unit) : { delta: null, deltaDirection: 'neutral' };
  const warns = (value: number | null | undefined): boolean => value !== null && value !== undefined && value < HEALTH_METRICS_EVENTS_AT_A_GLANCE_WARN_CHANGE;
  const stat = (key: string, label: string, value: string, change: HealthMetricsEventsAtAGlanceDelta, warn = false): HealthMetricsEventsAtAGlanceStatView => ({
    key,
    label,
    value,
    ...change,
    warn,
  });

  return {
    measured: period !== null,
    controlLabel: [formatCountPart(total, 'events'), formatCountPart(past, 'past'), formatCountPart(upcoming, 'upcoming')].join(' · '),
    baselineLabel: formatAtAGlanceBaseline(range, changes !== null),
    headline: stat('registrations', 'Total registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
    side: [
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees)),
      stat('show-up-rate', 'Show-up rate', formatShowUpRate(period), delta(changes?.showUpRatePts, 'pp')),
      stat('events', 'Events held', formatAtAGlanceCount(period?.events), delta(changes?.events)),
    ],
    tiles: [
      stat('registrations', 'Registrations', formatAtAGlanceCount(period?.registrations), delta(changes?.registrations)),
      stat('attendees', 'Attendees', formatAtAGlanceCount(period?.attendees), delta(changes?.attendees), warns(changes?.attendees)),
      stat('organizations', 'Organizations', formatAtAGlanceCount(period?.organizations), delta(changes?.organizations)),
      stat('speakers', 'Speakers', formatAtAGlanceCount(period?.speakers), delta(changes?.speakers), warns(changes?.speakers)),
      stat('countries', 'Countries', formatAtAGlanceCount(period?.countries), delta(changes?.countries)),
      { key: 'past-upcoming', label: 'Past / upcoming', value: formatPastUpcoming(past, upcoming), delta: null, deltaDirection: 'neutral', warn: false },
    ],
  };
}

/** One period's revenue section; the table lists only the events in that period, matching the headline. */
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
    warn: false,
  });
  const rows = revenue.events.filter((event) => event.ranges.some((candidate) => candidate === range)).map(buildRevenueRowView);

  return {
    foundationMeasured: revenue.periods.length > 0,
    measured: period !== null,
    headline: stat('total', 'Total event revenue', period?.totalUsd, delta(changes?.total)),
    side: [
      stat('registration', 'Registration', period?.registrationUsd, delta(changes?.registration)),
      stat('sponsorship', 'Sponsorship', period?.sponsorshipUsd, delta(changes?.sponsorship)),
      { key: 'split', label: 'Split', value: formatRevenueSplit(period?.registrationShare ?? null), delta: null, deltaDirection: 'neutral', warn: false },
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
  if (years.length === 0) return { rows: [], yearCount: 0, hasPartialYear: false, pandemicNote: null };

  const first = Math.min(...years);
  const last = Math.max(...years);
  const rows = Array.from({ length: last - first + 1 }, (_, index) =>
    buildRegistrationsGrowthRowView(first + index, byYear.get(first + index) ?? null, metric)
  );

  return {
    rows,
    yearCount: rows.length,
    hasPartialYear: rows.some((row) => row.isPartialYear),
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
    warn: false,
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
              barClass: HEALTH_METRICS_EVENTS_SPEAKERS_ORGANIZATION_BAR_CLASS,
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
    statusBars: buildSpeakersBars(
      (Object.keys(HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS) as HealthMetricsEventsSpeakersStatusGroup[])
        .map((group) => ({
          key: group,
          label: HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[group].label,
          value: statusCounts[group],
          barClass: HEALTH_METRICS_EVENTS_SPEAKERS_STATUS_GROUPS[group].barClass,
        }))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    ),
    organizations: buildSpeakersBars(organizations),
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
    warn: false,
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
    tiers: buildSpeakersBars(
      (period?.tiers ?? []).map((tier) => ({ key: tier.name, label: tier.name, value: tier.packages, barClass: HEALTH_METRICS_EVENTS_SPONSORSHIP_BAR_CLASS }))
    ),
  };
}

/** The section for one period; a period with no country registrations reads as not available, never as zero countries. */
export function buildHealthMetricsEventsGeographyView(geography: HealthMetricsEventsGeography, range: HealthMetricsRange): HealthMetricsEventsGeographyView {
  const period = geography.periods.find((candidate) => candidate.range === range) ?? null;
  const topCountries = period?.topCountries ?? [];
  const measured = topCountries.length > 0;
  const countries = measured ? (period?.countries ?? null) : null;
  const changes = measured ? (period?.changes ?? null) : null;
  const hidden = measured ? Math.max((period?.rankedCountries ?? 0) - topCountries.length, 0) : 0;

  return {
    foundationMeasured: geography.periods.length > 0,
    measured,
    countries,
    countriesLabel: formatGeographyCountriesLabel(countries),
    headline: {
      key: 'countries',
      label: 'Countries represented',
      value: formatAtAGlanceCount(countries),
      ...(changes ? formatAtAGlanceDelta(changes.countries, 'pct') : { delta: null, deltaDirection: 'neutral' }),
      warn: false,
    },
    bars: buildSpeakersBars(
      topCountries.map((country) => ({
        key: country.country,
        label: country.country,
        value: country.registrations,
        barClass: HEALTH_METRICS_EVENTS_GEOGRAPHY_BAR_CLASS,
      }))
    ),
    moreLabel: hidden > 0 ? `+${hidden.toLocaleString('en-US')} more` : '',
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

function buildPastRowView(event: HealthMetricsEventsPastEvent): HealthMetricsEventsPastRowView {
  const status = resolveHealthMetricsEventsPastStatus(event);

  return {
    event,
    status,
    statusLabel: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].label,
    statusClass: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].badgeClass,
    dateLabel: event.eventStartDate ? formatIsoDateLabel(event.eventStartDate) : '—',
    registrationsLabel: formatHealthMetricsEventsCount(event.registrations),
    goalLabel: formatHealthMetricsEventsCount(event.goal),
    revenueLabel: formatHealthMetricsEventsRevenue(event.revenueUsd),
    progressPct: resolvePastProgressPct(event),
    progressClass: HEALTH_METRICS_EVENTS_PAST_STATUSES[status].progressClass,
  };
}

/** Final registrations against goal, capped at 100; null when either is unmeasured, since null is not zero. */
function resolvePastProgressPct(event: HealthMetricsEventsPastEvent): number | null {
  if (event.goal === null || event.goal <= 0 || event.registrations === null) return null;

  return Math.min(100, Math.round((event.registrations / event.goal) * 100));
}

/** Registrations now against goal; null when either is unmeasured, since null is not zero. */
function resolveProgressRatio(event: HealthMetricsEventsForecastEvent): number | null {
  if (event.goal === null || event.goal <= 0 || event.registrationsNow === null) return null;

  return event.registrationsNow / event.goal;
}

function resolveProgressClass(pct: number | null): string {
  if (pct === null) return 'bg-gray-200';
  if (pct >= 90) return 'bg-emerald-500';

  return pct >= 45 ? 'bg-amber-500' : 'bg-red-400';
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

/** Bars scaled against the longest; an unmeasured value draws no bar and reads as not available. */
function buildSpeakersBars(items: HealthMetricsEventsSpeakersBarInput[]): HealthMetricsEventsSpeakersBarView[] {
  const max = Math.max(0, ...items.map((item) => item.value ?? 0));

  return items.map((item) => ({
    key: item.key,
    label: item.label,
    valueLabel: formatAtAGlanceCount(item.value),
    widthPct: max > 0 && item.value !== null ? (item.value / max) * 100 : 0,
    barClass: item.barClass,
  }));
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
