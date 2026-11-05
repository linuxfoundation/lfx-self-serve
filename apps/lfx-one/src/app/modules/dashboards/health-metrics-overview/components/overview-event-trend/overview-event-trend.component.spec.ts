// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { OverviewEventTrendComponent } from './overview-event-trend.component';

import type { HealthMetricsEventsForecastCurve, HealthMetricsOverviewCardStatus, HealthMetricsOverviewEvent } from '@lfx-one/shared/interfaces';

const EVENT: HealthMetricsOverviewEvent = {
  eventId: 'e1',
  eventName: 'Acme Summit',
  startDate: '2026-12-08',
  endDate: '2026-12-10',
  city: 'Springfield',
  registrations: 328,
  registrationsGoal: 1000,
  compScore: 'medium',
  acceptedTalks: 0,
  totalProposals: 185,
  cfpStatus: 'Review Complete',
  ranges: [],
};
const HEADLINE = {
  eventId: 'e1',
  eventName: 'Acme Summit',
  eventStartDate: '2026-12-08',
  forecastAvg: 620,
  forecastLow: 560,
  forecastHigh: 680,
  registrationsNow: 330,
  priorYearSamePoint: 300,
  goal: 1000,
  daysLeft: 46,
  isNewEvent: false,
};
const point = (daysToEvent: number, actual: number | null, forecast: number | null) => ({
  daysToEvent,
  actual,
  forecastAvg: forecast,
  forecastLow: forecast,
  forecastHigh: forecast,
  priorYear: 100,
});

describe('OverviewEventTrendComponent', () => {
  let fixture: ComponentFixture<OverviewEventTrendComponent>;

  async function render(curve: HealthMetricsEventsForecastCurve | null, isPast = false, status: HealthMetricsOverviewCardStatus = 'ready'): Promise<void> {
    await TestBed.configureTestingModule({ imports: [OverviewEventTrendComponent] }).compileComponents();
    fixture = TestBed.createComponent(OverviewEventTrendComponent);
    fixture.componentRef.setInput('event', EVENT);
    fixture.componentRef.setInput('isPast', isPast);
    fixture.componentRef.setInput('reads', curve ? { forecast: isPast ? null : { events: [HEADLINE] }, curve } : null);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function labels(testId: string): string[] {
    return [...(query(testId)?.children ?? [])].map((child) => child.textContent?.trim() ?? '');
  }

  const oneFormat: HealthMetricsEventsForecastCurve = {
    eventId: 'e1',
    formats: [{ format: 'In Person', points: [point(-90, 100, null), point(-46, 330, null), point(0, null, 620)] }],
  };

  it('shows the headline figures and the curve, leaving the goal and days left to the dialog header', async () => {
    await render(oneFormat);

    expect(query('overview-trend-kpi-current')?.textContent).toContain('330');
    expect(query('overview-trend-kpi-predicted')?.textContent).toContain('620');
    expect(labels('overview-trend-kpi-predicted-range')).toEqual(['680 high', '560 low']);
    expect(query('overview-trend-kpi-goal')).toBeNull();
    expect(query('overview-trend-kpi-days-left')).toBeNull();
    expect(query('overview-trend-chart')?.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
    expect(query('overview-trend-format')).toBeNull();
  });

  it('draws the goal line, the axis ticks and the Today marker, and names every line, the range and the goal in its legend', async () => {
    await render(oneFormat);

    expect(query('overview-trend-goal')).not.toBeNull();
    expect(labels('overview-trend-y-ticks')).toEqual(['1,250', '1,000', '750', '500', '250', '0']);
    expect(labels('overview-trend-x-ticks')).toEqual(['180', '150', '120', '90', '60', '30', '0']);
    expect(query('overview-trend-today')?.textContent?.trim()).toBe('Today');
    expect(query('overview-trend')?.textContent).toContain('Predicted range');
    expect(query('overview-trend')?.textContent).toContain('Registration goal');
  });

  it('offers a format toggle only when the event has both, opening on the larger', async () => {
    await render({
      eventId: 'e1',
      formats: [
        { format: 'Virtual', points: [point(-46, 30, null)] },
        { format: 'In Person', points: [point(-46, 300, null)] },
      ],
    });

    expect(query('overview-trend-format')).not.toBeNull();
    expect(fixture.componentInstance['format']()).toBe('In Person');
  });

  it("shows a past event's history with its final count and no forecast", async () => {
    await render({ eventId: 'e1', formats: [{ format: 'In Person', points: [point(-90, 100, null), point(0, 328, null)] }] }, true);

    expect(query('overview-trend-kpi-final')?.textContent).toContain('328');
    expect(query('overview-trend-kpi-predicted')).toBeNull();
    expect(query('overview-trend')?.textContent).not.toContain('Predicted');
    expect(query('overview-trend')?.textContent).toContain('Registration goal');
    expect(query('overview-trend-chart')?.querySelector('line[stroke-dasharray="3 3"]')).toBeNull();
    expect(query('overview-trend-today')).toBeNull();
  });

  it('says so in place of an empty chart when a past event has no history', async () => {
    await render({ eventId: '', formats: [] }, true);

    expect(query('overview-trend-empty')?.textContent).toContain('No registration history for this event yet.');
    expect(query('overview-trend-chart')).toBeNull();
    expect(query('overview-trend-kpi-final')).not.toBeNull();
  });

  it('holds a skeleton while the dialog reads, and says so when the read failed', async () => {
    await render(null, false, 'loading');
    expect(query('overview-trend-loading')).not.toBeNull();

    fixture.componentRef.setInput('status', 'failed');
    fixture.detectChanges();

    expect(query('overview-trend-error')).not.toBeNull();
    expect(query('overview-trend-chart')).toBeNull();
  });
});
