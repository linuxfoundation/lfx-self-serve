// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import {
  buildHealthMetricsEventsAtAGlanceView,
  buildHealthMetricsEventsForecastNote,
  buildHealthMetricsEventsForecastRowViews,
  buildHealthMetricsEventsPastView,
  buildHealthMetricsEventsRegistrationsGrowthView,
  buildHealthMetricsEventsSubNavItems,
  filterHealthMetricsEventsForecastable,
  formatHealthMetricsEventsPastClosedLabel,
  formatHealthMetricsEventsRevenue,
  pickHealthMetricsEventsForecastFormat,
  resolveHealthMetricsEventsForecastStatus,
  resolveHealthMetricsEventsForecastVerdict,
  resolveHealthMetricsEventsPastStatus,
  sortHealthMetricsEventsForecastRows,
  truncateHealthMetricsEventsPillName,
} from './health-metrics-events.utils';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsRegistrationsGrowthYear,
} from '../interfaces/health-metrics-events.interface';

function event(overrides: Partial<HealthMetricsEventsForecastEvent> = {}): HealthMetricsEventsForecastEvent {
  return {
    eventId: 'evt-1',
    eventName: 'Summit',
    eventStartDate: '2026-11-04',
    forecastAvg: 500,
    forecastLow: 400,
    forecastHigh: 600,
    registrationsNow: 250,
    priorYearSamePoint: 200,
    goal: 450,
    daysLeft: 40,
    isNewEvent: false,
    ...overrides,
  };
}

function pastEvent(overrides: Partial<HealthMetricsEventsPastEvent> = {}): HealthMetricsEventsPastEvent {
  return {
    eventId: 'past-1',
    eventName: 'Summit',
    eventStartDate: '2026-03-10',
    registrations: 900,
    goal: 1000,
    goalMet: false,
    revenueUsd: 125000,
    paceStatus: 'needs_attention',
    ranges: ['YTD'],
    ...overrides,
  };
}

describe('buildHealthMetricsEventsSubNavItems', () => {
  it('lists every section in render order, with its label and no badge', () => {
    const items = buildHealthMetricsEventsSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.label));
    expect(items.every((item) => item.count === null && item.note === '')).toBe(true);
  });

  it('puts a note on the section it names', () => {
    const items = buildHealthMetricsEventsSubNavItems({ forecast: '2 will miss goal' });

    expect(items.find((item) => item.key === 'forecast')?.note).toBe('2 will miss goal');
    expect(items.filter((item) => item.note !== '')).toHaveLength(1);
  });

  it('puts a badge on the section it counts, and none on the rest', () => {
    const items = buildHealthMetricsEventsSubNavItems({}, { past: 12 });

    expect(items.find((item) => item.key === 'past')?.count).toBe(12);
    expect(items.filter((item) => item.count !== null)).toHaveLength(1);
  });
});

describe('resolveHealthMetricsEventsForecastStatus', () => {
  it('follows EVT-01 on the forecast band', () => {
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 700 }))).toBe('action');
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 550 }))).toBe('at-risk');
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 500 }))).toBe('on-track');
  });

  it('says No goal for an unset goal, and No data rather than On track for a missing forecast', () => {
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: null }))).toBe('no-goal');
    expect(resolveHealthMetricsEventsForecastStatus(event({ forecastAvg: null, forecastHigh: null }))).toBe('no-data');
  });

  it('says No data rather than No goal when both the forecast and the goal are missing', () => {
    expect(resolveHealthMetricsEventsForecastStatus(event({ forecastAvg: null, forecastHigh: null, goal: null }))).toBe('no-data');
    expect(resolveHealthMetricsEventsForecastVerdict(event({ forecastAvg: null, goal: null })).kind).toBe('no-data');
  });

  it('withholds the chip when goal and forecast are an order of magnitude apart, either way', () => {
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 50 }))).toBe('no-data');
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 5000 }))).toBe('no-data');
    expect(resolveHealthMetricsEventsForecastStatus(event({ goal: 51 }))).toBe('on-track');
  });
});

describe('resolveHealthMetricsEventsForecastVerdict', () => {
  it('reports the margin when on track and the shortfall with days left when short', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 450 }))).toMatchObject({ kind: 'on-track', tone: 'ok', gap: 50 });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 620 }))).toMatchObject({ kind: 'short', tone: 'act', gap: 120, daysLeft: 40 });
  });

  it('calls a goal 3× under the forecast stale rather than a success', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 150 }))).toMatchObject({ kind: 'stale', tone: 'watch' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 170 }))).toMatchObject({ kind: 'on-track' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ forecastAvg: 300, goal: 100 }))).toMatchObject({ kind: 'stale', ratio: 3 });
  });

  it('flags a goal ten times off the forecast, either way, as suspect, matching the withheld chip', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 5000 }))).toMatchObject({ kind: 'goal-suspect', tone: 'watch' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 50 }))).toMatchObject({ kind: 'goal-suspect', ratio: 10 });
  });

  it('agrees with the chip on a forecast a fraction under goal', () => {
    const nearGoal = event({ forecastAvg: 449.6, forecastHigh: 500, goal: 450 });

    expect(resolveHealthMetricsEventsForecastStatus(nearGoal)).toBe('at-risk');
    expect(resolveHealthMetricsEventsForecastVerdict(nearGoal)).toMatchObject({ kind: 'short', gap: 0 });
  });

  it('has nothing to pace against without a goal or a forecast', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: null })).kind).toBe('no-goal');
    expect(resolveHealthMetricsEventsForecastVerdict(event({ forecastAvg: null })).kind).toBe('no-data');
  });
});

describe('buildHealthMetricsEventsForecastNote', () => {
  it('counts events projected under goal, leaving out withheld ones', () => {
    const events = [event({ goal: 700 }), event({ goal: 550 }), event({ goal: 450 }), event({ goal: 5000 }), event({ goal: null })];

    expect(buildHealthMetricsEventsForecastNote(events)).toBe('2 will miss goal');
    expect(buildHealthMetricsEventsForecastNote([event()])).toBe('');
  });
});

describe('forecast table helpers', () => {
  it('keeps only events with a forecast for the selector', () => {
    expect(filterHealthMetricsEventsForecastable([event(), event({ eventId: 'evt-2', forecastAvg: null })]).map((e) => e.eventId)).toEqual(['evt-1']);
  });

  it('sorts worst pacing first, with unset goals last', () => {
    const sorted = sortHealthMetricsEventsForecastRows([
      event({ eventId: 'none', goal: null }),
      event({ eventId: 'ahead', registrationsNow: 400, goal: 450 }),
      event({ eventId: 'behind', registrationsNow: 50, goal: 450 }),
    ]);

    expect(sorted.map((e) => e.eventId)).toEqual(['behind', 'ahead', 'none']);
  });

  it('sorts a mis-entered goal with the unset ones rather than as the worst pacing', () => {
    const sorted = sortHealthMetricsEventsForecastRows([
      event({ eventId: 'suspect', eventName: 'A suspect', goal: 5000 }),
      event({ eventId: 'behind', registrationsNow: 50, goal: 450 }),
    ]);

    expect(sorted.map((e) => e.eventId)).toEqual(['behind', 'suspect']);
  });

  it('sorts an unmeasured registration count last rather than as zero, and draws it no progress', () => {
    const unmeasured = event({ eventId: 'unmeasured', eventName: 'A unmeasured', registrationsNow: null });
    const sorted = sortHealthMetricsEventsForecastRows([unmeasured, event({ eventId: 'behind', registrationsNow: 50 })]);

    expect(sorted.map((e) => e.eventId)).toEqual(['behind', 'unmeasured']);
    expect(buildHealthMetricsEventsForecastRowViews([unmeasured])[0]).toMatchObject({ progressPct: null, progressClass: 'bg-gray-200' });
  });

  it('resolves labels and caps the progress bar at 100%', () => {
    const [row] = buildHealthMetricsEventsForecastRowViews([event({ registrationsNow: 1200.4, forecastAvg: 1300, forecastHigh: 1400, goal: 1000 })]);

    expect(row).toMatchObject({ statusLabel: 'On track', registrationsLabel: '1,200', goalLabel: '1,000', progressPct: 100, dateLabel: 'Nov 4, 2026' });
    expect(buildHealthMetricsEventsForecastRowViews([event({ goal: null })])[0]).toMatchObject({ statusLabel: 'No goal', goalLabel: '—', progressPct: null });
  });

  it('truncates long pill names with an ellipsis', () => {
    expect(truncateHealthMetricsEventsPillName('Short')).toBe('Short');
    const long = truncateHealthMetricsEventsPillName('A'.repeat(40));
    expect(long).toHaveLength(33);
    expect(long.endsWith('…')).toBe(true);
  });

  it('opens the chart on the format with more registrations', () => {
    const point = (actual: number | null) => ({ daysToEvent: -1, actual, forecastAvg: null, forecastLow: null, forecastHigh: null, priorYear: null });

    expect(
      pickHealthMetricsEventsForecastFormat([
        { format: 'Virtual', points: [point(30)] },
        { format: 'In Person', points: [point(80), point(null)] },
      ])
    ).toBe('In Person');
    expect(pickHealthMetricsEventsForecastFormat([])).toBeNull();
  });
});

describe('resolveHealthMetricsEventsPastStatus', () => {
  it('splits a miss on the pace band at close', () => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goalMet: true, paceStatus: 'healthy' }))).toBe('hit');
    expect(resolveHealthMetricsEventsPastStatus(pastEvent())).toBe('near-miss');
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ paceStatus: 'needs_action' }))).toBe('missed');
  });

  it('reads no goal as no goal, never as a miss', () => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: null, goalMet: null, paceStatus: null }))).toBe('no-goal');
  });

  it('falls back to final registrations when the outcome is not flagged', () => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: 100, registrations: 120, goalMet: null }))).toBe('hit');
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: 100, registrations: 80, goalMet: null, paceStatus: 'needs_action' }))).toBe('missed');
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: 100, registrations: 80, goalMet: null, paceStatus: 'needs_attention' }))).toBe('near-miss');
  });

  it('reads final registrations landing exactly on the goal as a hit', () => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: 100, registrations: 100, goalMet: null }))).toBe('hit');
  });

  it('reads an unflagged outcome with no final registrations as unmeasured, never a miss', () => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal: 100, registrations: null, goalMet: null }))).toBe('unmeasured');
  });
});

describe('buildHealthMetricsEventsPastView', () => {
  const past: HealthMetricsEventsPast = {
    periods: [
      { range: 'YTD', eventCount: 2, registrations: 1500 },
      { range: 'COMPLETED_YEAR', eventCount: 1, registrations: 300 },
    ],
    events: [
      pastEvent({ eventId: 'hit', goalMet: true, registrations: 1200, paceStatus: 'healthy' }),
      pastEvent({ eventId: 'no-goal', goal: null, goalMet: null, paceStatus: null, registrations: 300, ranges: ['YTD', 'COMPLETED_YEAR'] }),
    ],
  };

  it("takes the period's count and registrations from the view and lists only its events, in server order", () => {
    const view = buildHealthMetricsEventsPastView(past, 'YTD');

    expect(view).toMatchObject({ eventCount: 2, registrations: 1500, goalMetCount: 1, goalSetCount: 1 });
    expect(view.rows.map((row) => row.event.eventId)).toEqual(['hit', 'no-goal']);
  });

  it('counts only goal-set events in the period as the "of Y"', () => {
    expect(buildHealthMetricsEventsPastView(past, 'COMPLETED_YEAR')).toMatchObject({ eventCount: 1, goalSetCount: 0, hasGoals: false });
  });

  it('leaves a period with no header or events unmeasured', () => {
    expect(buildHealthMetricsEventsPastView(past, 'COMPLETED_YEAR_4')).toEqual({
      eventCount: null,
      registrations: null,
      goalMetCount: 0,
      goalSetCount: 0,
      hasGoals: false,
      rows: [],
    });
  });

  it('tallies "X of Y" off the chips, counting a fallback hit and leaving an unmeasured outcome out', () => {
    const view = buildHealthMetricsEventsPastView(
      {
        periods: [{ range: 'YTD', eventCount: 3, registrations: 1200 }],
        events: [
          pastEvent({ eventId: 'fallback-hit', goal: 100, registrations: 100, goalMet: null }),
          pastEvent({ eventId: 'unmeasured', goal: 100, registrations: null, goalMet: null }),
          pastEvent({ eventId: 'miss' }),
        ],
      },
      'YTD'
    );

    expect(view.rows.map((row) => row.status)).toEqual(['hit', 'unmeasured', 'near-miss']);
    expect(view).toMatchObject({ goalMetCount: 1, goalSetCount: 2, hasGoals: true });
    expect(view.rows[1]).toMatchObject({ statusLabel: 'Not tracked', registrationsLabel: '—', progressPct: null });
  });

  it('reads a period of only unset and untracked goals as having goals, none of them tracked', () => {
    const view = buildHealthMetricsEventsPastView(
      {
        periods: [{ range: 'YTD', eventCount: 2, registrations: 300 }],
        events: [
          pastEvent({ eventId: 'no-goal', goal: null, goalMet: null, paceStatus: null }),
          pastEvent({ eventId: 'unmeasured', goal: 100, registrations: null, goalMet: null }),
        ],
      },
      'YTD'
    );

    expect(view.rows.map((row) => row.status)).toEqual(['no-goal', 'unmeasured']);
    expect(view).toMatchObject({ goalMetCount: 0, goalSetCount: 0, hasGoals: true });
  });

  it('resolves row labels, capping the bar and drawing none without a goal', () => {
    const [hit, noGoal] = buildHealthMetricsEventsPastView(past, 'YTD').rows;

    expect(hit).toMatchObject({
      statusLabel: 'Hit goal',
      registrationsLabel: '1,200',
      goalLabel: '1,000',
      revenueLabel: '$125K',
      progressPct: 100,
      progressClass: 'bg-emerald-500',
      dateLabel: 'Mar 10, 2026',
    });
    expect(noGoal).toMatchObject({ status: 'no-goal', goalLabel: '—', progressPct: null, progressClass: 'bg-gray-200' });
  });
});

describe('past-events labels', () => {
  it('reads $0 revenue as measured and only null as not available', () => {
    expect(formatHealthMetricsEventsRevenue(0)).toBe('$0');
    expect(formatHealthMetricsEventsRevenue(null)).toBe('not available');
  });

  it('counts closed events in the control line', () => {
    expect(formatHealthMetricsEventsPastClosedLabel(1)).toBe('1 event closed this period');
    expect(formatHealthMetricsEventsPastClosedLabel(1234)).toBe('1,234 events closed this period');
    expect(formatHealthMetricsEventsPastClosedLabel(null)).toBe('—');
  });
});

describe('buildHealthMetricsEventsAtAGlanceView', () => {
  function glancePeriod(overrides: Partial<HealthMetricsEventsAtAGlancePeriod> = {}): HealthMetricsEventsAtAGlancePeriod {
    return {
      range: 'YTD',
      registrations: 12400,
      attendees: 9300,
      organizations: 410,
      speakers: 120,
      countries: 38,
      events: 6,
      pastEvents: 6,
      showUpRate: 0.75,
      changes: { registrations: -0.124, attendees: -0.35, organizations: 0.002, speakers: -0.3, countries: 0.2, events: 0.5, showUpRatePts: 0.022 },
      ...overrides,
    };
  }

  function glance(overrides: Partial<HealthMetricsEventsAtAGlance> = {}): HealthMetricsEventsAtAGlance {
    return {
      periods: [
        glancePeriod(),
        glancePeriod({ range: 'COMPLETED_YEAR', events: 14, pastEvents: 14 }),
        glancePeriod({ range: 'COMPLETED_YEAR_2', changes: null }),
      ],
      upcomingEvents: 3,
      hasEvents: true,
      ...overrides,
    };
  }

  it('counts upcoming events into the YTD total and compares against the same point last year', () => {
    const view = buildHealthMetricsEventsAtAGlanceView(glance(), 'YTD');

    expect(view.measured).toBe(true);
    expect(view.controlLabel).toBe('9 events · 6 past · 3 upcoming');
    expect(view.baselineLabel).toBe('all against the same point last year');
    expect(view.headline).toMatchObject({ value: '12,400', delta: '−12%', deltaDirection: 'down' });
    expect(view.tiles.find((tile) => tile.key === 'past-upcoming')).toMatchObject({ value: '6 / 3', delta: null });
  });

  it('shows the show-up rate as a whole percent and its change in points, never as a percent change', () => {
    const [, showUp] = buildHealthMetricsEventsAtAGlanceView(glance(), 'YTD').side;

    expect(showUp).toMatchObject({ value: '75%', delta: '+2.2 pp', deltaDirection: 'up' });
  });

  it('flags Attendees and Speakers only below a 30% fall, and a change that rounds to zero as flat', () => {
    const tiles = buildHealthMetricsEventsAtAGlanceView(glance(), 'YTD').tiles;

    expect(tiles.filter((tile) => tile.warn).map((tile) => tile.key)).toEqual(['attendees']);
    expect(tiles.find((tile) => tile.key === 'organizations')).toMatchObject({ delta: '0%', deltaDirection: 'neutral' });
  });

  it('gives a completed year no upcoming events and compares it with the year before', () => {
    const view = buildHealthMetricsEventsAtAGlanceView(glance(), 'COMPLETED_YEAR');

    expect(view.controlLabel).toBe('14 events · 14 past · 0 upcoming');
    expect(view.baselineLabel).toBe(`all against ${getYearForRange('COMPLETED_YEAR') - 1}`);
  });

  it('draws no delta for a period the view does not compare', () => {
    const view = buildHealthMetricsEventsAtAGlanceView(glance(), 'COMPLETED_YEAR_2');

    expect(view.baselineLabel).toBe('no year-over-year comparison for this period');
    expect([view.headline, ...view.side, ...view.tiles].every((stat) => stat.delta === null && !stat.warn)).toBe(true);
  });

  it('reads every unmeasured figure as not available, never as zero', () => {
    const unmeasured = glancePeriod({
      registrations: null,
      pastEvents: null,
      showUpRate: null,
      changes: { registrations: null, attendees: null, organizations: null, speakers: null, countries: null, events: null, showUpRatePts: null },
    });
    const view = buildHealthMetricsEventsAtAGlanceView(glance({ periods: [unmeasured], upcomingEvents: null }), 'YTD');

    expect(view.controlLabel).toBe('events not available · past not available · upcoming not available');
    expect(view.headline).toMatchObject({ value: 'not available', delta: 'not available', deltaDirection: 'neutral' });
    expect(view.side[1]).toMatchObject({ value: 'not available', delta: 'not available' });
    expect(view.tiles.find((tile) => tile.key === 'past-upcoming')?.value).toBe('not available');
    expect(view.tiles.some((tile) => tile.warn)).toBe(false);
  });

  it('marks a period missing from the read as unmeasured', () => {
    expect(buildHealthMetricsEventsAtAGlanceView(glance(), 'COMPLETED_YEAR_4').measured).toBe(false);
  });
});

describe('buildHealthMetricsEventsRegistrationsGrowthView', () => {
  function growthYear(overrides: Partial<HealthMetricsEventsRegistrationsGrowthYear> = {}): HealthMetricsEventsRegistrationsGrowthYear {
    return {
      year: 2023,
      isPartialYear: false,
      totalRegistrations: 1200,
      inPersonRegistrations: 1000,
      virtualRegistrations: 200,
      totalAttendees: 900,
      inPersonAttendees: 800,
      virtualAttendees: 100,
      ...overrides,
    };
  }

  it('lists every year oldest first, whatever order the read returned', () => {
    const view = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear({ year: 2024 }), growthYear({ year: 2023 })] }, 'registrations');

    expect(view.rows.map((row) => row.year)).toEqual([2023, 2024]);
    expect(view.yearCount).toBe(2);
  });

  it('switches every figure between registrations and attendees', () => {
    const registrations = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear()] }, 'registrations').rows[0];
    const attendees = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear()] }, 'attendees').rows[0];

    expect([registrations.totalLabel, registrations.inPersonLabel, registrations.virtualLabel]).toEqual(['1,200', '1,000', '200']);
    expect([attendees.totalLabel, attendees.inPersonLabel, attendees.virtualLabel]).toEqual(['900', '800', '100']);
  });

  it('fills a gap year as unrecorded, never as zero', () => {
    const view = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear({ year: 2021 }), growthYear({ year: 2023 })] }, 'registrations');
    const gap = view.rows[1];

    expect(view.rows.map((row) => row.year)).toEqual([2021, 2022, 2023]);
    expect(view.yearCount).toBe(3);
    expect(gap).toMatchObject({ year: 2022, recorded: false, total: null, inPerson: null, virtual: null });
    expect([gap.totalLabel, gap.inPersonLabel, gap.virtualLabel]).toEqual(['—', '—', '—']);
  });

  it('dashes a zero virtual count but keeps a zero total', () => {
    const row = buildHealthMetricsEventsRegistrationsGrowthView(
      { years: [growthYear({ totalRegistrations: 0, inPersonRegistrations: 0, virtualRegistrations: 0 })] },
      'registrations'
    ).rows[0];

    expect([row.totalLabel, row.inPersonLabel, row.virtualLabel]).toEqual(['0', '0', '—']);
    expect(row.virtual).toBe(0);
  });

  it('dashes an unmeasured count', () => {
    const row = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear({ totalAttendees: null })] }, 'attendees').rows[0];

    expect(row.total).toBeNull();
    expect(row.totalLabel).toBe('—');
  });

  it('flags a partial year', () => {
    const view = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear(), growthYear({ year: 2024, isPartialYear: true })] }, 'registrations');

    expect(view.hasPartialYear).toBe(true);
    expect(view.rows.map((row) => row.isPartialYear)).toEqual([false, true]);
    expect(buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear()] }, 'registrations').hasPartialYear).toBe(false);
  });

  it('explains the pandemic years only when one was mostly virtual for the metric', () => {
    const mostlyVirtual = {
      year: 2021,
      totalRegistrations: 1000,
      inPersonRegistrations: 400,
      virtualRegistrations: 600,
      totalAttendees: 800,
      virtualAttendees: 100,
    };
    const registrations = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear(mostlyVirtual), growthYear()] }, 'registrations');
    const attendees = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear(mostlyVirtual), growthYear()] }, 'attendees');
    const smallVirtual = buildHealthMetricsEventsRegistrationsGrowthView(
      { years: [growthYear({ year: 2020, totalRegistrations: 5000, inPersonRegistrations: 4990, virtualRegistrations: 10 }), growthYear()] },
      'registrations'
    );
    const unmeasured = buildHealthMetricsEventsRegistrationsGrowthView(
      { years: [growthYear({ year: 2020, totalAttendees: 100, virtualAttendees: null }), growthYear()] },
      'attendees'
    );
    const spannedOnly = buildHealthMetricsEventsRegistrationsGrowthView({ years: [growthYear({ year: 2019 }), growthYear({ year: 2022 })] }, 'registrations');

    expect(registrations.pandemicNote).toBe(
      '2020–21 registrations were mostly virtual during the pandemic, so the years since read as a return to in-person rather than a collapse.'
    );
    expect(attendees.pandemicNote).toBeNull();
    expect(smallVirtual.pandemicNote).toBeNull();
    expect(unmeasured.pandemicNote).toBeNull();
    expect(spannedOnly.pandemicNote).toBeNull();
  });

  it('returns no rows for no years', () => {
    expect(buildHealthMetricsEventsRegistrationsGrowthView({ years: [] }, 'registrations')).toEqual({
      rows: [],
      yearCount: 0,
      hasPartialYear: false,
      pandemicNote: null,
    });
  });
});
