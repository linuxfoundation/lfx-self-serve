// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import {
  buildHealthMetricsEventsAtAGlanceView,
  buildHealthMetricsEventsOrganizationRowView,
  buildHealthMetricsEventsForecastNote,
  buildHealthMetricsEventsForecastRowViews,
  buildHealthMetricsEventsForecastView,
  buildHealthMetricsEventsGeographyView,
  buildHealthMetricsEventsPastView,
  buildHealthMetricsEventsRegistrationsGrowthChart,
  buildHealthMetricsEventsRevenueView,
  buildHealthMetricsEventsSpeakersView,
  buildHealthMetricsEventsSpeakersYears,
  buildHealthMetricsEventsSponsorshipView,
  buildHealthMetricsEventsSubNavItems,
  formatHealthMetricsEventsOrganizationsCountLabel,
  hasHealthMetricsEventsGoal,
  formatHealthMetricsEventsPlaceLabel,
  pickHealthMetricsEventsForecastFormat,
  resolveHealthMetricsEventsForecastStatus,
  resolveHealthMetricsEventsForecastVerdict,
  resolveHealthMetricsEventsPastStatus,
  sortHealthMetricsEventsForecastRows,
} from './health-metrics-events.utils';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsAtAGlancePeriod,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsGeography,
  HealthMetricsEventsGeographyPeriod,
  HealthMetricsEventsOrganization,
  HealthMetricsEventsPast,
  HealthMetricsEventsPastEvent,
  HealthMetricsEventsRegistrationsGrowthYear,
  HealthMetricsEventsRevenue,
  HealthMetricsEventsRevenueEvent,
  HealthMetricsEventsRevenuePeriod,
  HealthMetricsEventsSpeakers,
  HealthMetricsEventsSpeakersPeriod,
  HealthMetricsEventsSpeakersProposal,
  HealthMetricsEventsSponsorship,
  HealthMetricsEventsSponsorshipPeriod,
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
    city: 'Springfield',
    isVirtual: false,
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
    city: 'Springfield',
    isVirtual: false,
    ...overrides,
  };
}

describe('buildHealthMetricsEventsSubNavItems', () => {
  it('lists every section in render order, with its label and no note', () => {
    const items = buildHealthMetricsEventsSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => section.label));
    expect(items.every((item) => item.note === '')).toBe(true);
  });

  it('puts a note on the section it names', () => {
    const items = buildHealthMetricsEventsSubNavItems({ forecast: '2 will miss goal' });

    expect(items.find((item) => item.key === 'forecast')?.note).toBe('2 will miss goal');
    expect(items.filter((item) => item.note !== '')).toHaveLength(1);
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
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 450 }))).toMatchObject({ kind: 'on-track', tone: 'healthy', gap: 50 });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 620 }))).toMatchObject({ kind: 'short', gap: 120, daysLeft: 40 });
  });

  it('needs action when even the high forecast misses, and attention when only the average does', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 700 })).tone).toBe('action');
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 550 })).tone).toBe('attention');
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 550, forecastHigh: null })).tone).toBe('attention');
  });

  it('calls a goal 3× under the forecast stale rather than a success', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 150 }))).toMatchObject({ kind: 'stale', tone: 'attention' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 170 }))).toMatchObject({ kind: 'on-track' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ forecastAvg: 300, goal: 100 }))).toMatchObject({ kind: 'stale', ratio: 3 });
  });

  it('flags a goal ten times off the forecast, either way, as suspect, matching the withheld chip', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 5000 }))).toMatchObject({ kind: 'goal-suspect', tone: 'attention' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: 50 }))).toMatchObject({ kind: 'goal-suspect', ratio: 10 });
  });

  it('agrees with the chip on a forecast a fraction under goal', () => {
    const nearGoal = event({ forecastAvg: 449.6, forecastHigh: 500, goal: 450 });

    expect(resolveHealthMetricsEventsForecastStatus(nearGoal)).toBe('at-risk');
    expect(resolveHealthMetricsEventsForecastVerdict(nearGoal)).toMatchObject({ kind: 'short', gap: 0 });
  });

  it('has nothing to pace against without a goal or a forecast', () => {
    expect(resolveHealthMetricsEventsForecastVerdict(event({ goal: null }))).toMatchObject({ kind: 'no-goal', tone: 'summary' });
    expect(resolveHealthMetricsEventsForecastVerdict(event({ forecastAvg: null }))).toMatchObject({ kind: 'no-data', tone: 'summary' });
  });
});

describe('buildHealthMetricsEventsForecastView', () => {
  it('lays out Current, Goal, Predicted and Days left, with last year and the likely range as descriptions', () => {
    const { metrics } = buildHealthMetricsEventsForecastView(
      event({ registrationsNow: 3748, priorYearSamePoint: 3373, goal: 5000, forecastAvg: 3921, forecastLow: 3907, forecastHigh: 3935, daysLeft: 1 })
    );

    expect(metrics.map(({ key, label, value, description }) => [key, label, value, description])).toEqual([
      ['current', 'Current', '3,748', 'Same point last year: 3,373'],
      ['goal', 'Goal', '5,000', undefined],
      ['predicted', 'Predicted', '3,921', 'High 3,935 · Low 3,907'],
      ['days-left', 'Days left', '1', undefined],
    ]);
    expect(metrics[2].tip).toContain('Where registrations are expected to land');
  });

  it('dashes what is unmeasured: last year for a first edition, an unset goal, a missing forecast and a running event', () => {
    const { metrics } = buildHealthMetricsEventsForecastView(event({ isNewEvent: true, goal: 0, forecastAvg: null, daysLeft: null }));

    expect(metrics.map((item) => item.value)).toEqual(['250', '—', '—', '—']);
    expect(metrics[0].description).toBe('Same point last year: —');
    expect(metrics[2].description).toBeUndefined();
  });

  it('writes a shortfall as a note, with the gap in bold and the days left', () => {
    const { note } = buildHealthMetricsEventsForecastView(event({ goal: 5000, forecastAvg: 3921, forecastHigh: 3935, forecastLow: 3907, daysLeft: 1 }));

    expect(note.tone).toBe('action');
    expect(note.parts).toEqual([
      { text: 'Projected to finish about ' },
      { text: '1,079', bold: true },
      { text: ' short of the 5,000 goal.' },
      { text: ' There is 1 day left to close the gap — after that the opportunity is gone.' },
    ]);
  });

  it.each([
    [{ daysLeft: 28 }, ' There are 28 days left to close the gap — after that the opportunity is gone.'],
    [{ daysLeft: 0 }, ' Today is the last day to close the gap — after that the opportunity is gone.'],
  ])('counts the days left in the shortfall copy (%o)', (overrides, sentence) => {
    expect(buildHealthMetricsEventsForecastView(event({ goal: 620, ...overrides })).note.parts.at(-1)).toEqual({ text: sentence });
  });

  it('drops the days-left sentence once a running event is past its start day', () => {
    expect(
      buildHealthMetricsEventsForecastView(event({ goal: 620, daysLeft: null }))
        .note.parts.map((part) => part.text)
        .join('')
    ).toBe('Projected to finish about 120 short of the 620 goal.');
  });

  it('keeps the shipped copy for on-track, no-goal, no-forecast and stale-goal verdicts', () => {
    const copy = (overrides: Partial<HealthMetricsEventsForecastEvent>) =>
      buildHealthMetricsEventsForecastView(event(overrides))
        .note.parts.map((part) => part.text)
        .join('');

    expect(copy({ goal: 450 })).toBe('On track to clear the goal by about 50 registrations. No action needed beyond keeping promotion running.');
    expect(copy({ goal: null })).toBe('No registration goal is set, so there is nothing to pace against. The forecast still projects 500 registrations.');
    expect(copy({ forecastAvg: null })).toBe('There is no forecast for this event yet.');
    expect(copy({ goal: 150 })).toContain('is 3.3× the goal of 150 — the goal looks stale');
    expect(copy({ goal: 5000 })).toContain('is a tenth or less of the goal of 5,000 — the goal looks mis-entered');
  });
});

describe('formatHealthMetricsEventsPlaceLabel', () => {
  it('puts the city before the date, says Virtual for a virtual event with no city, and else shows the date alone', () => {
    expect(formatHealthMetricsEventsPlaceLabel({ city: 'Toronto', isVirtual: false, eventStartDate: '2026-10-05' })).toBe('Toronto · Oct 5, 2026');
    expect(formatHealthMetricsEventsPlaceLabel({ city: null, isVirtual: true, eventStartDate: '2026-10-05' })).toBe('Virtual · Oct 5, 2026');
    expect(formatHealthMetricsEventsPlaceLabel({ city: null, isVirtual: false, eventStartDate: '2026-10-05' })).toBe('Oct 5, 2026');
    expect(formatHealthMetricsEventsPlaceLabel({ city: 'Toronto', isVirtual: true, eventStartDate: null })).toBe('Toronto');
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

  it('sorts an unmeasured registration count last rather than as zero, labelled with a dash', () => {
    const unmeasured = event({ eventId: 'unmeasured', eventName: 'A unmeasured', registrationsNow: null });
    const sorted = sortHealthMetricsEventsForecastRows([unmeasured, event({ eventId: 'behind', registrationsNow: 50 })]);

    expect(sorted.map((e) => e.eventId)).toEqual(['behind', 'unmeasured']);
    expect(buildHealthMetricsEventsForecastRowViews([unmeasured])[0]).toMatchObject({ registrationsLabel: '—' });
  });

  it('resolves the labels and fills the goal bar to registrations over goal, capped at 100%', () => {
    const [row] = buildHealthMetricsEventsForecastRowViews([event({ registrationsNow: 1200.4, forecastAvg: 1300, forecastHigh: 1400, goal: 1000 })]);

    expect(row).toEqual({
      eventId: 'evt-1',
      eventName: 'Summit',
      placeLabel: 'Springfield · Nov 4, 2026',
      registrationsLabel: '1,200',
      goalLabel: 'Goal: 1,000',
      pct: 100,
      fillClass: 'bg-emerald-500',
      paceLabel: 'On track',
    });
    expect(buildHealthMetricsEventsForecastRowViews([event({ registrationsNow: 250, goal: 1000 })])[0].pct).toBe(25);
  });

  it('colours the bar red when even the high forecast misses, amber when the average does, and gray with no forecast', () => {
    const pace = (overrides: Partial<HealthMetricsEventsForecastEvent>) => {
      const [row] = buildHealthMetricsEventsForecastRowViews([event(overrides)]);
      return [row.fillClass, row.paceLabel];
    };

    expect(pace({ goal: 700 })).toEqual(['bg-red-400', 'Needs action']);
    expect(pace({ goal: 550 })).toEqual(['bg-amber-400', 'Needs attention']);
    expect(pace({ goal: 500 })).toEqual(['bg-emerald-500', 'On track']);
    expect(pace({ goal: 550, forecastAvg: null, forecastHigh: null })).toEqual(['bg-gray-400', 'No forecast']);
  });

  it('keeps the raw colour for a goal ten times off the forecast, which still sorts last', () => {
    const rows = buildHealthMetricsEventsForecastRowViews([
      event({ eventId: 'suspect', eventName: 'A suspect', goal: 5000 }),
      event({ eventId: 'behind', registrationsNow: 50, goal: 450 }),
    ]);

    expect(rows.map((row) => [row.eventId, row.fillClass])).toEqual([
      ['behind', 'bg-emerald-500'],
      ['suspect', 'bg-red-400'],
    ]);
  });

  it.each([null, 0, -5])('reads a goal of %s as no goal: no goal label and an empty bar', (goal) => {
    expect(buildHealthMetricsEventsForecastRowViews([event({ goal })])[0]).toMatchObject({ goalLabel: '', pct: 0, paceLabel: '' });
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

  it.each([0, -5])('reads a goal of %i as no goal, never as a hit', (goal) => {
    expect(resolveHealthMetricsEventsPastStatus(pastEvent({ goal, registrations: 120, goalMet: null }))).toBe('no-goal');
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

  it("lays out Total registrations from the view and Goal reached off the period's pills, and lists only its events", () => {
    const view = buildHealthMetricsEventsPastView(past, 'YTD');

    expect(view.metrics.map(({ key, label, value }) => [key, label, value])).toEqual([
      ['registrations', 'Total registrations', '1,500'],
      ['goal-reached', 'Goal reached', '1 of 1'],
    ]);
    expect(view.rows.map((row) => row.eventId)).toEqual(['hit', 'no-goal']);
  });

  it('counts a fallback hit, and leaves an unmeasured outcome and an unset goal out of Goal reached', () => {
    const events = [
      pastEvent({ eventId: 'fallback', goalMet: null, registrations: 1000 }),
      pastEvent({ eventId: 'missed', goalMet: false }),
      pastEvent({ eventId: 'unmeasured', goalMet: null, registrations: null }),
      pastEvent({ eventId: 'unset', goal: null }),
    ];

    expect(buildHealthMetricsEventsPastView({ periods: past.periods, events }, 'YTD').metrics[1].value).toBe('1 of 2');
  });

  it('reads Goal reached as "—" when no event in the period has a goal it can be read against, and an unmeasured period as "—"', () => {
    const view = buildHealthMetricsEventsPastView({ periods: [], events: [pastEvent({ goal: null })] }, 'YTD');

    expect(view.metrics.map((item) => item.value)).toEqual(['—', '—']);
  });

  it('resolves each row: place and date, the inline goal suffix, revenue and the status pill', () => {
    const [row] = buildHealthMetricsEventsPastView({ periods: past.periods, events: [pastEvent()] }, 'YTD').rows;

    expect(row).toEqual({
      eventId: 'past-1',
      eventName: 'Summit',
      placeLabel: 'Springfield · Mar 10, 2026',
      registrationsLabel: '900',
      goalSuffix: ' / 1,000 (goal)',
      revenueLabel: '$125K',
      status: 'near-miss',
      statusLabel: 'Just missed',
      statusTone: 'warning',
    });
  });

  it.each([
    [{ goalMet: true }, 'Goal reached', 'success'],
    [{ goalMet: false, paceStatus: 'needs_action' }, 'Goal missed', 'danger'],
    [{ goal: null }, 'No goal set', 'neutral'],
    [{ goalMet: null, registrations: null }, 'Not tracked', 'neutral'],
  ])('labels %o as a %s pill', (overrides, label, tone) => {
    const [row] = buildHealthMetricsEventsPastView({ periods: past.periods, events: [pastEvent(overrides)] }, 'YTD').rows;

    expect([row.statusLabel, row.statusTone]).toEqual([label, tone]);
  });

  it.each([null, 0, -5])('reads a goal of %s as "/ no goal set", and an unmeasured count or revenue as "—"', (goal) => {
    const [row] = buildHealthMetricsEventsPastView({ periods: past.periods, events: [pastEvent({ goal, registrations: null, revenueUsd: null })] }, 'YTD').rows;

    expect(row).toMatchObject({ registrationsLabel: '—', goalSuffix: ' / no goal set', revenueLabel: '—' });
  });

  it('keeps $0 revenue as a measured result', () => {
    expect(buildHealthMetricsEventsPastView({ periods: past.periods, events: [pastEvent({ revenueUsd: 0 })] }, 'YTD').rows[0].revenueLabel).toBe('$0');
  });
});

describe('hasHealthMetricsEventsGoal', () => {
  it('treats only a positive goal as set', () => {
    expect(hasHealthMetricsEventsGoal(450)).toBe(true);
    expect(hasHealthMetricsEventsGoal(0)).toBe(false);
    expect(hasHealthMetricsEventsGoal(-5)).toBe(false);
    expect(hasHealthMetricsEventsGoal(null)).toBe(false);
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

  it('lays out the metrics row: registrations with its change, attendees with the show-up rate, events and companies', () => {
    const view = buildHealthMetricsEventsAtAGlanceView(glance(), 'YTD');

    expect(view.metrics.map(({ key, label, value, trend, description }) => [key, label, value, trend, description])).toEqual([
      ['registrations', 'Total registrations', '12,400', '−12%', undefined],
      ['attendees', 'Attendees', '9,300', undefined, '75% show-up rate'],
      ['events', 'Events', '9', undefined, '6 past · 3 upcoming'],
      ['companies', 'Participating companies', '410', undefined, undefined],
    ]);
    expect(view.metrics[0].trendTone).toBe('down');
    expect(view.metrics[3].tip).toBe('Companies that sent at least one registrant to an event this period.');
  });

  it('compares year to date with the whole of last year, and a completed year with the one before', () => {
    const year = new Date().getFullYear();
    const ytd = buildHealthMetricsEventsAtAGlanceView(glance(), 'YTD');
    const last = buildHealthMetricsEventsAtAGlanceView(glance(), 'COMPLETED_YEAR');

    expect([ytd.periodHeading, ytd.comparisonHeading]).toEqual([`${year} (YTD)`, `${year - 1} (full year)`]);
    expect([last.periodHeading, last.comparisonHeading]).toEqual([`${year - 1}`, `${year - 2}`]);
    expect(last.metrics.find((item) => item.key === 'events')?.description).toBe('14 past');
  });

  it('lists each figure against the comparison period, with its change as a badge, the show-up rate in points', () => {
    // Each comparison value is the one its change implies, as the view measures year to date against the whole last year.
    const changes = {
      registrations: -0.1143,
      attendees: -0.35,
      organizations: 0.0024,
      speakers: -0.2982,
      countries: 0.1875,
      events: 0.5,
      showUpRatePts: 0.022,
    };
    const periods = [
      glancePeriod({ changes }),
      glancePeriod({ range: 'COMPLETED_YEAR', registrations: 14000, attendees: 14308, organizations: 409, speakers: 171, countries: 32, showUpRate: 0.728 }),
    ];

    expect(buildHealthMetricsEventsAtAGlanceView(glance({ periods }), 'YTD').rows).toEqual([
      { key: 'registrations', label: 'Registrations', value: '12,400', comparison: '14,000', change: '−11%', changeTone: 'danger' },
      { key: 'attendees', label: 'Attendees', value: '9,300', comparison: '14,308', change: '−35%', changeTone: 'danger' },
      { key: 'companies', label: 'Participating companies', value: '410', comparison: '409', change: '+0%', changeTone: 'success' },
      { key: 'speakers', label: 'Speakers', value: '120', comparison: '171', change: '−30%', changeTone: 'danger' },
      { key: 'countries', label: 'Countries', value: '38', comparison: '32', change: '+19%', changeTone: 'success' },
      { key: 'show-up-rate', label: 'Show-up rate', value: '75%', comparison: '73%', change: '+2.2pp', changeTone: 'success' },
    ]);
  });

  it('shows "—" for the comparison and the change of a period the view does not compare', () => {
    const view = buildHealthMetricsEventsAtAGlanceView(glance(), 'COMPLETED_YEAR_2');

    expect(view.rows.every((row) => row.comparison === '—' && row.change === null)).toBe(true);
    expect(view.metrics[0].trend).toBeUndefined();
  });

  it('reads a compared but unmeasured change as "—" in the table and "not available" in the metrics row', () => {
    const changes = { registrations: null, attendees: null, organizations: null, speakers: null, countries: null, events: null, showUpRatePts: null };
    const view = buildHealthMetricsEventsAtAGlanceView(glance({ periods: [glancePeriod({ changes }), glancePeriod({ range: 'COMPLETED_YEAR' })] }), 'YTD');

    expect(view.rows[0].change).toBeNull();
    expect(view.metrics[0]).toMatchObject({ trend: 'not available', trendTone: 'flat' });
  });

  it('reads every unmeasured figure as "—", never as zero, and drops the show-up description', () => {
    const blank = glancePeriod({ registrations: null, attendees: null, organizations: null, pastEvents: null, showUpRate: null });
    const view = buildHealthMetricsEventsAtAGlanceView(glance({ periods: [blank], upcomingEvents: null }), 'YTD');

    expect(view.metrics.map((item) => item.value)).toEqual(['—', '—', '—', '—']);
    expect(view.metrics[1].description).toBeUndefined();
    expect(view.metrics[2].description).toBe('— past · — upcoming');
  });
});

describe('buildHealthMetricsEventsRevenueView', () => {
  function revenuePeriod(overrides: Partial<HealthMetricsEventsRevenuePeriod> = {}): HealthMetricsEventsRevenuePeriod {
    return {
      range: 'YTD',
      totalUsd: 258000,
      registrationUsd: 180000,
      sponsorshipUsd: 78000,
      registrationShare: 0.6977,
      sponsorshipShare: 0.3023,
      hasUnconverted: false,
      changes: { total: 0.06, registration: 0.05, sponsorship: -0.09 },
      ...overrides,
    };
  }

  function revenueEvent(overrides: Partial<HealthMetricsEventsRevenueEvent> = {}): HealthMetricsEventsRevenueEvent {
    return {
      eventId: 'rev-1',
      eventName: 'Summit',
      eventStartDate: '2026-03-10',
      registrationUsd: 96000,
      sponsorshipUsd: 40000,
      registrationGoal: 145000,
      sponsorshipGoal: null,
      hasUnconverted: false,
      registrationGoalWithheld: false,
      sponsorshipGoalWithheld: false,
      isPastEvent: true,
      goalMet: null,
      ranges: ['YTD'],
      city: 'Springfield',
      isVirtual: false,
      ...overrides,
    };
  }

  function revenue(overrides: Partial<HealthMetricsEventsRevenue> = {}): HealthMetricsEventsRevenue {
    return {
      periods: [revenuePeriod(), revenuePeriod({ range: 'COMPLETED_YEAR_3', changes: null })],
      events: [revenueEvent(), revenueEvent({ eventId: 'rev-2', ranges: ['COMPLETED_YEAR'] })],
      eventsMeasured: true,
      ...overrides,
    };
  }

  it('lays out the three money lines, each with its change', () => {
    const view = buildHealthMetricsEventsRevenueView(revenue(), 'YTD');

    expect(view.metrics.map(({ key, label, value, trend, trendTone }) => [key, label, value, trend, trendTone])).toEqual([
      ['total', 'Total event revenue', '$258K', '+6%', 'up'],
      ['registration', 'Registration', '$180K', '+5%', 'up'],
      ['sponsorship', 'Sponsorship', '$78K', '−9%', 'down'],
    ]);
  });

  it('draws no change for the period the view does not compare, and reads an unmeasured figure as "—"', () => {
    const view = buildHealthMetricsEventsRevenueView(
      revenue({ periods: [revenuePeriod({ range: 'COMPLETED_YEAR_3', changes: null, registrationUsd: null })] }),
      'COMPLETED_YEAR_3'
    );

    expect(view.metrics.every((item) => item.trend === undefined)).toBe(true);
    expect(view.metrics[1].value).toBe('—');
  });

  it('keeps a refund signed, and reads a compared but unmeasured change as not available', () => {
    const period = revenuePeriod({ totalUsd: -1200, changes: { total: null, registration: 0.05, sponsorship: 0 } });
    const view = buildHealthMetricsEventsRevenueView(revenue({ periods: [period] }), 'YTD');

    expect(view.metrics[0]).toMatchObject({ value: '-$1.2K', trend: 'not available', trendTone: 'flat' });
    expect(view.metrics[2]).toMatchObject({ trend: '0%', trendTone: 'flat' });
  });

  it('resolves each row with its place and date, and each amount against its goal as an inline suffix', () => {
    const [row] = buildHealthMetricsEventsRevenueView(revenue(), 'YTD').rows;

    expect(row).toEqual({
      eventId: 'rev-1',
      eventName: 'Summit',
      placeLabel: 'Springfield · Mar 10, 2026',
      registrationLabel: '$96K',
      registrationGoalSuffix: ' / $145K (goal)',
      sponsorshipLabel: '$40K',
      sponsorshipGoalSuffix: ' / no goal set',
    });
  });

  it('reads $0 with no goal as "—", keeps $0 against a goal, and names a goal withheld for its currency', () => {
    const events = [
      revenueEvent({ eventId: 'zero', registrationUsd: 0, registrationGoal: null, sponsorshipUsd: 0, sponsorshipGoal: 15000 }),
      revenueEvent({ eventId: 'withheld', registrationGoal: null, registrationGoalWithheld: true, sponsorshipUsd: null }),
    ];
    const [zero, withheld] = buildHealthMetricsEventsRevenueView(revenue({ events }), 'YTD').rows;

    expect(zero).toMatchObject({
      registrationLabel: '—',
      registrationGoalSuffix: ' / no goal set',
      sponsorshipLabel: '$0',
      sponsorshipGoalSuffix: ' / $15K (goal)',
    });
    expect(withheld).toMatchObject({ registrationGoalSuffix: ' / goal not in USD', sponsorshipLabel: '—' });
  });

  it('reports revenue only when the period has an event or a non-zero figure', () => {
    const zero = revenuePeriod({
      range: 'COMPLETED_YEAR',
      totalUsd: 0,
      registrationUsd: 0,
      sponsorshipUsd: 0,
      registrationShare: null,
      sponsorshipShare: null,
    });

    expect(buildHealthMetricsEventsRevenueView(revenue(), 'YTD').hasRevenue).toBe(true);
    expect(buildHealthMetricsEventsRevenueView(revenue({ periods: [zero], events: [] }), 'COMPLETED_YEAR').hasRevenue).toBe(false);
    expect(buildHealthMetricsEventsRevenueView(revenue({ periods: [zero] }), 'COMPLETED_YEAR').hasRevenue).toBe(true);
    expect(buildHealthMetricsEventsRevenueView(revenue({ periods: [{ ...zero, registrationUsd: -500 }], events: [] }), 'COMPLETED_YEAR').hasRevenue).toBe(true);
    expect(
      buildHealthMetricsEventsRevenueView(revenue({ periods: [{ ...zero, totalUsd: null, hasUnconverted: true }], events: [] }), 'COMPLETED_YEAR').hasRevenue
    ).toBe(true);
  });

  it('lists upcoming events soonest first, then past events latest first, in one table', () => {
    const events = [
      revenueEvent({ eventId: 'past-early', eventStartDate: '2026-01-15' }),
      revenueEvent({ eventId: 'later', eventStartDate: '2027-02-01', isPastEvent: false, ranges: [] }),
      revenueEvent({ eventId: 'past-undated', eventStartDate: null }),
      revenueEvent({ eventId: 'undated', eventStartDate: null, isPastEvent: false, ranges: [] }),
      revenueEvent({ eventId: 'past-late', eventStartDate: '2026-06-01' }),
      revenueEvent({ eventId: 'sooner', eventStartDate: '2026-11-20', isPastEvent: false, ranges: [] }),
    ];

    expect(buildHealthMetricsEventsRevenueView(revenue({ events }), 'YTD').rows.map((row) => row.eventId)).toEqual([
      'sooner',
      'later',
      'undated',
      'past-late',
      'past-early',
      'past-undated',
    ]);
  });

  it('lists upcoming events on the current-year view only, since they fall in no period', () => {
    const events = [
      revenueEvent({ eventId: 'past', ranges: ['COMPLETED_YEAR'] }),
      revenueEvent({ eventId: 'upcoming', eventStartDate: '2026-11-20', isPastEvent: false, ranges: [] }),
    ];

    expect(buildHealthMetricsEventsRevenueView(revenue({ events }), 'COMPLETED_YEAR').rows.map((row) => row.eventId)).toEqual(['past']);
  });

  it('carries whether the read had per-event figures at all', () => {
    expect(buildHealthMetricsEventsRevenueView(revenue(), 'YTD').eventsMeasured).toBe(true);
    expect(buildHealthMetricsEventsRevenueView(revenue({ events: [], eventsMeasured: false }), 'YTD')).toMatchObject({ eventsMeasured: false, rows: [] });
  });

  it('marks a period missing from the read as unmeasured', () => {
    expect(buildHealthMetricsEventsRevenueView(revenue(), 'COMPLETED_YEAR_4')).toMatchObject({ foundationMeasured: true, measured: false });
  });

  it('marks the whole foundation unmeasured when the read carried no period at all', () => {
    expect(buildHealthMetricsEventsRevenueView(revenue({ periods: [] }), 'YTD')).toMatchObject({ foundationMeasured: false, measured: false });
  });
});

describe('buildHealthMetricsEventsRegistrationsGrowthChart', () => {
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

  const chart = (years: HealthMetricsEventsRegistrationsGrowthYear[], metric: 'registrations' | 'attendees' = 'registrations') =>
    buildHealthMetricsEventsRegistrationsGrowthChart({ years }, metric, 2026);

  it('draws every year oldest first, in-person under virtual, with the total above and the current year at full colour', () => {
    const view = chart([growthYear({ year: 2026, isPartialYear: true }), growthYear({ year: 2025 })]);

    expect(view.columns.map((column) => [column.label, column.sub, column.total, column.opacity])).toEqual([
      ['2025', '', '1.2K', 0.35],
      ['2026', 'partial', '1.2K', 1],
    ]);
    expect(view.columns[0].segments.map((segment) => segment.key)).toEqual(['in-person', 'virtual']);
    expect(view.series.map((series) => [series.label, series.color])).toEqual([
      ['In-person', '#009AFF'],
      ['Virtual', '#8E51FF'],
    ]);
    expect([view.heightPx, view.barWidthPx]).toEqual([260, 40]);
  });

  it('tops the axis at the largest total plus 8%, rounded up to a clean step, as the design draws 24K for 18,772', () => {
    expect(chart([growthYear({ totalRegistrations: 18772, inPersonRegistrations: 1210, virtualRegistrations: 17562 })]).yTicks).toEqual([
      '24K',
      '18K',
      '12K',
      '6K',
      '0',
    ]);
  });

  it('switches every figure between registrations and attendees', () => {
    expect(chart([growthYear()], 'attendees').columns[0].tip.rows.map((row) => [row.label, row.value])).toEqual([
      ['In-person', '800'],
      ['Virtual', '100'],
      ['Total', '900'],
    ]);
    expect(chart([growthYear()], 'attendees').ariaLabel).toBe('Attendees by year, in person and virtual');
  });

  it('titles the popup with the year, "partial year", or "no events recorded" for a gap year that keeps its empty slot', () => {
    const view = chart([growthYear({ year: 2023 }), growthYear({ year: 2025, isPartialYear: true })]);

    expect(view.columns.map((column) => column.tip.title)).toEqual(['2023', '2024 · no events recorded', '2025 · partial year']);
    expect(view.columns[1]).toMatchObject({ total: '', segments: [] });
    expect(view.columns[1].tip.rows).toEqual([]);
  });

  it('takes each column\'s total from the view, and reads an unmeasured one as "—", never 0', () => {
    const view = chart(
      [growthYear({ totalRegistrations: 1500 }), growthYear({ year: 2024, totalAttendees: null, inPersonAttendees: null, virtualAttendees: null })],
      'attendees'
    );

    expect(chart([growthYear({ totalRegistrations: 1500 })]).columns[0].total).toBe('1.5K');
    expect(view.columns[1].total).toBe('');
    expect(view.columns[1].tip.rows.map((row) => row.value)).toEqual(['—', '—', '—']);
  });

  it('sizes the axis to the drawn formats when a year has no total, so its bar fits', () => {
    const view = chart([growthYear({ totalRegistrations: null, inPersonRegistrations: 1000, virtualRegistrations: 0 })]);

    expect(view.yTicks[0]).toBe('1.2K');
    expect(view.columns[0].total).toBe('');
  });

  it('draws nothing for a foundation with no year', () => {
    expect(chart([]).columns).toEqual([]);
  });
});

describe('buildHealthMetricsEventsSpeakersView', () => {
  function speakersPeriod(overrides: Partial<HealthMetricsEventsSpeakersPeriod> = {}): HealthMetricsEventsSpeakersPeriod {
    return {
      range: 'YTD',
      submitted: 6283,
      accepted: 348,
      inReview: 3447,
      declined: 2488,
      speakers: 3559,
      acceptanceRate: 0.055388,
      changes: { speakers: -0.143029 },
      ...overrides,
    };
  }

  function proposal(overrides: Partial<HealthMetricsEventsSpeakersProposal> = {}): HealthMetricsEventsSpeakersProposal {
    return {
      proposalKey: 'p-1',
      range: 'YTD',
      jobTitle: 'Staff Engineer',
      organizationName: 'Acme Motors',
      unaffiliated: false,
      eventName: 'Summit',
      sessionTitle: 'A talk',
      submissionDate: '2026-03-10',
      status: 'Accepted',
      statusGroup: 'accepted',
      ...overrides,
    };
  }

  function speakers(overrides: Partial<HealthMetricsEventsSpeakers> = {}): HealthMetricsEventsSpeakers {
    return {
      periods: [speakersPeriod(), speakersPeriod({ range: 'COMPLETED_YEAR_3', submitted: 4000, changes: null })],
      organizations: [
        { accountId: 'org-b', accountName: 'Vendor Corp', periods: [{ range: 'YTD', submitted: 200, rank: 2 }] },
        { accountId: 'org-a', accountName: 'Acme Motors', periods: [{ range: 'YTD', submitted: 400, rank: 1 }] },
        { accountId: 'org-c', accountName: 'Other Co', periods: [{ range: 'COMPLETED_YEAR', submitted: 90, rank: 1 }] },
      ],
      unaffiliated: [{ range: 'YTD', submitted: 1351 }],
      proposals: [
        proposal({ proposalKey: 'p-old', submissionDate: '2026-01-02', status: 'Waitlisted', statusGroup: 'in-review' }),
        proposal(),
        proposal({ proposalKey: 'p-ind', unaffiliated: true, organizationName: null, status: 'Rejected', statusGroup: 'declined' }),
        proposal({ proposalKey: 'p-prev', range: 'COMPLETED_YEAR' }),
      ],
      ...overrides,
    };
  }

  it('builds the headline and side stats with the speakers change', () => {
    const view = buildHealthMetricsEventsSpeakersView(speakers(), 'YTD', 'all');

    expect(view.foundationMeasured).toBe(true);
    expect(view.measured).toBe(true);
    expect(view.countLabel).toBe('6,283 proposals');
    expect(view.headline).toMatchObject({ key: 'accepted', label: 'Accepted proposals', value: '348', delta: null });
    expect(view.side.map((stat) => stat.value)).toEqual(['6,283', '6%', '3,559']);
    expect(view.side[2]).toMatchObject({ delta: '−14%', deltaDirection: 'down' });
  });

  it('leaves the speakers stat without a delta for an uncompared period', () => {
    const view = buildHealthMetricsEventsSpeakersView(speakers(), 'COMPLETED_YEAR_3', 'all');

    expect(view.side[2]).toMatchObject({ delta: null, deltaDirection: 'neutral' });
  });

  it('counts the chosen tab, singular for one', () => {
    const data = speakers({ periods: [speakersPeriod({ inReview: 1 })] });

    expect(buildHealthMetricsEventsSpeakersView(data, 'YTD', 'accepted').countLabel).toBe('348 proposals');
    expect(buildHealthMetricsEventsSpeakersView(data, 'YTD', 'in-review').countLabel).toBe('1 proposal');
  });

  it('ranks the status rows by count, largest first', () => {
    const view = buildHealthMetricsEventsSpeakersView(speakers(), 'YTD', 'all');

    expect(view.statusRows.map((row) => row.key)).toEqual(['in-review', 'declined', 'accepted']);
    expect(view.statusRows[0]).toEqual({ key: 'in-review', label: 'In review', valueLabel: '3,447' });
  });

  it('charts the four years oldest first, marking the open one partial', () => {
    expect(buildHealthMetricsEventsSpeakersYears(speakers())).toEqual([
      {
        year: getYearForRange('COMPLETED_YEAR_3'),
        submitted: 4000,
        isPartialYear: false,
        yearLabel: `${getYearForRange('COMPLETED_YEAR_3')}`,
        submittedLabel: '4,000',
      },
      {
        year: getYearForRange('COMPLETED_YEAR_2'),
        submitted: null,
        isPartialYear: false,
        yearLabel: `${getYearForRange('COMPLETED_YEAR_2')}`,
        submittedLabel: 'not available',
      },
      {
        year: getYearForRange('COMPLETED_YEAR'),
        submitted: null,
        isPartialYear: false,
        yearLabel: `${getYearForRange('COMPLETED_YEAR')}`,
        submittedLabel: 'not available',
      },
      { year: getYearForRange('YTD'), submitted: 6283, isPartialYear: true, yearLabel: `${getYearForRange('YTD')} (partial year)`, submittedLabel: '6,283' },
    ]);
  });

  it("ranks the period's organizations and keeps individuals on their own line", () => {
    const view = buildHealthMetricsEventsSpeakersView(speakers(), 'YTD', 'all');

    expect(view.organizations).toEqual([
      { key: 'org-a', label: 'Acme Motors', valueLabel: '400' },
      { key: 'org-b', label: 'Vendor Corp', valueLabel: '200' },
    ]);
    expect(view.individualLabel).toBe('1,351 proposals submitted');
    expect(buildHealthMetricsEventsSpeakersView(speakers(), 'COMPLETED_YEAR', 'all').individualLabel).toBeNull();
    expect(buildHealthMetricsEventsSpeakersView(speakers({ unaffiliated: [{ range: 'YTD', submitted: 1 }] }), 'YTD', 'all').individualLabel).toBe(
      '1 proposal submitted'
    );
  });

  it("lists the period's proposals most recent first, filtered by the tab", () => {
    const all = buildHealthMetricsEventsSpeakersView(speakers(), 'YTD', 'all');

    expect(all.proposals.map((row) => row.proposal.proposalKey)).toEqual(['p-1', 'p-ind', 'p-old']);
    expect(all.proposals[1]).toMatchObject({ organizationLabel: 'Individual', statusClass: 'bg-gray-100 text-gray-600' });
    expect(all.proposals[0]).toMatchObject({ organizationLabel: 'Acme Motors', statusClass: 'bg-emerald-50 text-emerald-700' });
    expect(buildHealthMetricsEventsSpeakersView(speakers(), 'YTD', 'in-review').proposals.map((row) => row.proposal.proposalKey)).toEqual(['p-old']);
  });

  it('caps the list at ten and shows a dash for a missing organization or date', () => {
    const many = Array.from({ length: 12 }, (_, index) => proposal({ proposalKey: `p-${String(index).padStart(2, '0')}` }));
    const view = buildHealthMetricsEventsSpeakersView(speakers({ proposals: many }), 'YTD', 'all');

    expect(view.proposals).toHaveLength(10);
    const bare = buildHealthMetricsEventsSpeakersView(
      speakers({ proposals: [proposal({ organizationName: null, submissionDate: null, statusGroup: null })] }),
      'YTD',
      'all'
    );
    expect(bare.proposals[0]).toMatchObject({ organizationLabel: '—', dateLabel: '—', statusClass: 'bg-gray-100 text-gray-600' });
  });

  it('reads as unmeasured with no period, and as foundation-unmeasured with none at all', () => {
    const missing = buildHealthMetricsEventsSpeakersView(speakers(), 'COMPLETED_YEAR', 'all');
    const empty = buildHealthMetricsEventsSpeakersView(speakers({ periods: [] }), 'YTD', 'all');

    expect(missing).toMatchObject({ foundationMeasured: true, measured: false, countLabel: '' });
    expect(empty.foundationMeasured).toBe(false);
  });
});

describe('buildHealthMetricsEventsOrganizationRowView', () => {
  const organization = (overrides: Partial<HealthMetricsEventsOrganization> = {}): HealthMetricsEventsOrganization => ({
    accountId: '0014100000AcmeAAAA',
    accountName: 'Acme Motors',
    logoUrl: 'https://acme-motors.example/logo.png',
    isMember: true,
    registrations: 1204,
    registrationsShare: 0.5,
    sponsorshipUsd: 150000,
    proposals: 12,
    speakers: 4,
    events: 3,
    ...overrides,
  });

  it('labels a member with its figures and a bar scaled to the top organization', () => {
    expect(buildHealthMetricsEventsOrganizationRowView(organization())).toEqual({
      accountId: '0014100000AcmeAAAA',
      accountName: 'Acme Motors',
      memberLabel: 'Member',
      memberGlyph: '●',
      memberClass: 'text-emerald-600',
      registrationsLabel: '1,204',
      barWidthPct: 50,
      sponsorshipLabel: '$150K',
      proposalsLabel: '12',
      speakersLabel: '4',
      eventsLabel: '3',
      link: {
        commands: ['/foundation/health-metrics', 'members'],
        fragment: 'list',
        queryParams: { memSearch: 'Acme Motors', memTier: null, memNps: null, memPage: null },
      },
      linkLabel: 'Open Acme Motors in Members',
    });
  });

  it('opens a non-member in Non-Members company participation, searched by name with its filters cleared', () => {
    const row = buildHealthMetricsEventsOrganizationRowView(organization({ isMember: false }));

    expect(row.link).toEqual({
      commands: ['/foundation/health-metrics', 'non-members'],
      fragment: 'orgs',
      queryParams: { nonSearch: 'Acme Motors', nonFit: null, nonPage: null },
    });
    expect(row.linkLabel).toBe('Open Acme Motors in Non-Members');
  });

  it('caps the search it opens with at the target search box length', () => {
    const name = 'A'.repeat(140);

    expect(buildHealthMetricsEventsOrganizationRowView(organization({ accountName: name })).link.queryParams).toMatchObject({ memSearch: 'A'.repeat(100) });
    expect(buildHealthMetricsEventsOrganizationRowView(organization({ accountName: name, isMember: false })).link.queryParams).toMatchObject({
      nonSearch: 'A'.repeat(100),
    });
  });

  it('reads zero sponsorship and proposals as not tracked, but keeps a measured zero elsewhere', () => {
    const row = buildHealthMetricsEventsOrganizationRowView(organization({ sponsorshipUsd: 0, proposals: 0, registrations: 0, speakers: 0 }));

    expect(row.sponsorshipLabel).toBe('—');
    expect(row.proposalsLabel).toBe('—');
    expect(row.registrationsLabel).toBe('0');
    expect(row.speakersLabel).toBe('0');
  });

  it('labels a non-member with a hollow dot in grey and keeps the bar inside its track', () => {
    const row = buildHealthMetricsEventsOrganizationRowView(organization({ isMember: false, registrationsShare: 1.2, sponsorshipUsd: null }));

    expect(row).toMatchObject({ memberLabel: 'Non-member', memberGlyph: '○', memberClass: 'text-gray-400' });
    expect(row.barWidthPct).toBe(100);
    expect(row.sponsorshipLabel).toBe('—');
  });

  it('draws no bar when the share is not available', () => {
    expect(buildHealthMetricsEventsOrganizationRowView(organization({ registrationsShare: null })).barWidthPct).toBe(0);
  });
});

describe('formatHealthMetricsEventsOrganizationsCountLabel', () => {
  it('counts organizations, singular for one', () => {
    expect(formatHealthMetricsEventsOrganizationsCountLabel(1204)).toBe('1,204 organizations');
    expect(formatHealthMetricsEventsOrganizationsCountLabel(1)).toBe('1 organization');
    expect(formatHealthMetricsEventsOrganizationsCountLabel(0)).toBe('0 organizations');
  });

  it('shows a dash while the count is unknown', () => {
    expect(formatHealthMetricsEventsOrganizationsCountLabel(null)).toBe('—');
  });
});

describe('buildHealthMetricsEventsSponsorshipView', () => {
  function sponsorshipPeriod(overrides: Partial<HealthMetricsEventsSponsorshipPeriod> = {}): HealthMetricsEventsSponsorshipPeriod {
    return {
      range: 'YTD',
      revenueUsd: 750000,
      goalUsd: 1000000,
      tierPackages: 12,
      addOns: 3,
      progressToGoal: 0.75,
      changes: { revenue: 0.25 },
      tiers: [
        { name: 'Gold', packages: 5 },
        { name: 'Silver', packages: 5 },
        { name: 'Platinum', packages: 2 },
      ],
      ...overrides,
    };
  }

  function sponsorship(...periods: HealthMetricsEventsSponsorshipPeriod[]): HealthMetricsEventsSponsorship {
    return { periods: periods.length ? periods : [sponsorshipPeriod()] };
  }

  it('lays out revenue with its change, the goal with how much of it was reached, tier packages and add-ons', () => {
    const view = buildHealthMetricsEventsSponsorshipView(sponsorship(), 'YTD');

    expect(view).toMatchObject({ foundationMeasured: true, measured: true });
    expect(view.metrics.map(({ key, label, value, trend, description }) => [key, label, value, trend, description])).toEqual([
      ['revenue', 'Sponsorship revenue', '$750K', '+25%', undefined],
      ['goal', 'Goal', '$1M', undefined, '75% reached'],
      ['tier-packages', 'Tier packages', '12', undefined, undefined],
      ['add-ons', 'Add-ons', '3', undefined, undefined],
    ]);
  });

  it('reads Goal as "—" with no description when no goal is set, and draws no change for an uncompared period', () => {
    const view = buildHealthMetricsEventsSponsorshipView(sponsorship(sponsorshipPeriod({ goalUsd: null, progressToGoal: null, changes: null })), 'YTD');

    expect(view.metrics[1]).toEqual({ key: 'goal', label: 'Goal', value: '—' });
    expect(view.metrics[0].trend).toBeUndefined();
  });

  it('draws each tier as a bar against the most sold, with the tier icon for Diamond to Silver and the ticket for any other package', () => {
    const tiers = [
      { name: 'Gold', packages: 65 },
      { name: 'Startup', packages: 64 },
      { name: 'Silver', packages: 48 },
    ];
    const rows = buildHealthMetricsEventsSponsorshipView(sponsorship(sponsorshipPeriod({ tiers })), 'YTD').tiers;

    expect(rows.map(({ label, value, tier, icon }) => [label, value, tier, icon])).toEqual([
      ['Gold', '65', 'gold', ''],
      ['Startup', '64', null, 'fa-light fa-ticket'],
      ['Silver', '48', 'silver', ''],
    ]);
    expect(rows[0].pct).toBe(100);
    expect(Math.round(rows[2].pct)).toBe(74);
  });

  it('marks a period missing from the read, and a foundation with no period, as unmeasured', () => {
    expect(buildHealthMetricsEventsSponsorshipView(sponsorship(), 'COMPLETED_YEAR')).toMatchObject({ foundationMeasured: true, measured: false });
    expect(buildHealthMetricsEventsSponsorshipView({ periods: [] }, 'YTD')).toMatchObject({ foundationMeasured: false, measured: false });
  });
});

describe('buildHealthMetricsEventsGeographyView', () => {
  function geographyPeriod(overrides: Partial<HealthMetricsEventsGeographyPeriod> = {}): HealthMetricsEventsGeographyPeriod {
    return {
      range: 'YTD',
      countries: 42,
      changes: { countries: 0.1 },
      topCountries: [
        { country: 'Canada', registrations: 800 },
        { country: 'Germany', registrations: 400 },
        { country: 'Japan', registrations: 200 },
      ],
      rankedCountries: 40,
      ...overrides,
    };
  }

  function geography(...periods: HealthMetricsEventsGeographyPeriod[]): HealthMetricsEventsGeography {
    return { periods: periods.length ? periods : [geographyPeriod()] };
  }

  it('builds the headline, the pill and the top-country rows', () => {
    const view = buildHealthMetricsEventsGeographyView(geography(), 'YTD');

    expect(view.foundationMeasured).toBe(true);
    expect(view.measured).toBe(true);
    expect(view.countriesLabel).toBe('42 countries');
    expect(view.headline).toMatchObject({ label: 'Countries represented', value: '42', delta: '+10%', deltaDirection: 'up' });
    expect(view.topCountries.map((row) => [row.label, row.valueLabel])).toEqual([
      ['Canada', '800'],
      ['Germany', '400'],
      ['Japan', '200'],
    ]);
  });

  it('uses the singular for one country', () => {
    const view = buildHealthMetricsEventsGeographyView(
      geography(geographyPeriod({ countries: 1, topCountries: [{ country: 'Canada', registrations: 5 }], rankedCountries: 1 })),
      'YTD'
    );

    expect(view.countriesLabel).toBe('1 country');
  });

  it('carries no delta for a period that is not compared', () => {
    const view = buildHealthMetricsEventsGeographyView(geography(geographyPeriod({ range: 'COMPLETED_YEAR_2', changes: null })), 'COMPLETED_YEAR_2');

    expect(view.headline).toMatchObject({ delta: null, deltaDirection: 'neutral' });
  });

  it('marks a compared period with no prior value as not available', () => {
    const view = buildHealthMetricsEventsGeographyView(geography(geographyPeriod({ changes: { countries: null } })), 'YTD');

    expect(view.headline).toMatchObject({ delta: 'not available', deltaDirection: 'neutral' });
  });

  it('reads a period with no country registrations as unmeasured, even with a rollup count', () => {
    const view = buildHealthMetricsEventsGeographyView(geography(geographyPeriod({ countries: 3, topCountries: [], rankedCountries: 0 })), 'YTD');

    expect(view.measured).toBe(false);
    expect(view.countriesLabel).toBe('');
    expect(view.headline).toMatchObject({ value: 'not available', delta: null });
    expect(view.topCountries).toEqual([]);
  });

  it('reads as unmeasured for a period missing from the response', () => {
    const view = buildHealthMetricsEventsGeographyView(geography(), 'COMPLETED_YEAR');

    expect(view.foundationMeasured).toBe(true);
    expect(view.measured).toBe(false);
  });

  it('reads as unmeasured for a foundation with no geography', () => {
    const view = buildHealthMetricsEventsGeographyView({ periods: [] }, 'YTD');

    expect(view.foundationMeasured).toBe(false);
    expect(view.measured).toBe(false);
  });
});
