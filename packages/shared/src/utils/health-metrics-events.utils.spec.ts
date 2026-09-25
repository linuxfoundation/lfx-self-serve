// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import {
  buildHealthMetricsEventsForecastNote,
  buildHealthMetricsEventsForecastRowViews,
  buildHealthMetricsEventsSubNavItems,
  filterHealthMetricsEventsForecastable,
  pickHealthMetricsEventsForecastFormat,
  resolveHealthMetricsEventsForecastStatus,
  resolveHealthMetricsEventsForecastVerdict,
  sortHealthMetricsEventsForecastRows,
  truncateHealthMetricsEventsPillName,
} from './health-metrics-events.utils';

import type { HealthMetricsEventsForecastEvent } from '../interfaces/health-metrics-events.interface';

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
