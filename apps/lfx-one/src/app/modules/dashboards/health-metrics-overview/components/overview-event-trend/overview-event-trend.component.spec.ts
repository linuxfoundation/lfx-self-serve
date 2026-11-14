// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

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
    const forecast = isPast ? null : { events: [HEADLINE] };
    fixture.componentRef.setInput('reads', curve ? { forecast, curve } : null);
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
    expect(labels('overview-trend-kpi-predicted-range')).toEqual(['High: 680', 'Low: 560']);
    expect(query('overview-trend-kpi-predicted-tip')?.getAttribute('aria-label')).toContain('expected to land');
    expect(query('overview-trend-kpi-goal')).toBeNull();
    expect(query('overview-trend-kpi-days-left')).toBeNull();
    expect(query('overview-trend-chart')?.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
    expect(query('overview-trend-format')).toBeNull();
  });

  // A prediction near the 1,000 goal, so the goal sits on the scale.
  const nearGoal: HealthMetricsEventsForecastCurve = {
    eventId: 'e1',
    formats: [{ format: 'In Person', points: [point(-90, 100, null), point(-46, 330, null), point(0, null, 900)] }],
  };

  it('labels the goal on its line rather than in the legend, and marks today, on the best-fit window', async () => {
    await render(nearGoal);

    expect(query('overview-trend-goal')).not.toBeNull();
    expect(query('overview-trend-goal-label')?.textContent?.trim()).toBe('Registration goal: 1,000');
    expect(labels('overview-trend-y-ticks')).toEqual(['1,250', '1,000', '750', '500', '250', '0']);
    expect(labels('overview-trend-x-ticks')).toEqual(['0', '20', '40', '60', '80', '100']);
    expect(query('overview-trend-today')?.textContent?.trim()).toBe('Today');
    expect(labels('overview-trend-legend')).toEqual(['This year', 'Last year', 'Predicted', 'Predicted range']);
    expect(query('overview-trend-band-high')?.getAttribute('d')).toMatch(/^M/);
    expect(query('overview-trend-reset')).toBeNull();
  });

  it('moves the window with the navigator, offering Reset view until it is back on the best fit', async () => {
    await render(nearGoal);
    const navigator = query('overview-trend-navigator')!;
    vi.spyOn(navigator, 'getBoundingClientRect').mockReturnValue({ width: 180, left: 0 } as DOMRect);
    const handle = query('overview-trend-navigator-start')!;
    const pointer = (type: string, target: Element, x: number): void => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, pointerId: 1 }));
    };

    // 180px for 180 days: dragging the start handle 80px right starts the span 80 days later.
    pointer('pointerdown', handle, 70);
    pointer('pointermove', handle, 150);
    pointer('pointerup', handle, 150);
    fixture.detectChanges();

    expect(query('overview-trend-navigator-selection')?.style.left).toBe('83.33%');
    expect(labels('overview-trend-x-ticks')).toEqual(['0', '5', '10', '15', '20', '25', '30']);
    expect(query('overview-trend-reset')).not.toBeNull();

    query('overview-trend-navigator-selection')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    // This span holds no read of the sparse curve, but its lines still cross it.
    expect(query('overview-trend-navigator-selection')?.getAttribute('aria-valuetext')).toBe('35 to 5 days before the event');
    expect(query('overview-trend-band-high')?.getAttribute('d')).toMatch(/^M0\.0 /);

    // A focused handle resizes from its side, never below 7 days.
    const end = query('overview-trend-navigator-end')!;
    end.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(end.getAttribute('aria-valuetext')).toBe('0 days before the event');
    for (let press = 0; press < 6; press++) end.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(query('overview-trend-navigator-selection')?.getAttribute('aria-valuetext')).toBe('35 to 28 days before the event');
    expect(end.getAttribute('aria-valuemin')).toBe('152');

    query('overview-trend-reset')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(query('overview-trend-navigator-selection')?.style.left).toBe('38.89%');
    expect(query('overview-trend-reset')).toBeNull();
  });

  it('offers no format filter, charting the format with the most registrations when the event has both', async () => {
    await render({
      eventId: 'e1',
      formats: [
        { format: 'Virtual', points: [point(-46, 30, null)] },
        { format: 'In Person', points: [point(-46, 300, null)] },
      ],
    });

    expect(query('overview-trend-format')).toBeNull();
    expect(fixture.componentInstance['series']()?.format).toBe('In Person');
  });

  it('drops the rotated axis label, and lays the metrics out for a phone with Current spanning both rows', async () => {
    await render(oneFormat);

    expect(fixture.nativeElement.textContent).not.toContain('Registration count');
    expect(query('overview-trend-grid')?.className).toContain('grid-cols-[44px_1fr]');
    expect(query('overview-trend-grid')?.className).toContain('max-[640px]:grid-cols-[0_1fr]');
    // A short phone scrolls rather than squeezing the chart under its tracks' minimum into the navigator.
    expect(query('overview-trend-grid')?.className).toContain('max-[640px]:min-h-min');
    // The phone legend wraps only when Reset leaves it no room, so the two never overlap.
    expect(query('overview-trend-legend')?.className).not.toContain('flex-nowrap');
    expect(query('overview-trend-kpi-current')?.className).toContain('max-[640px]:row-span-2');
    expect(query('overview-trend-kpi-predicted')?.className).toContain('max-[640px]:row-start-1');
    expect(query('overview-trend-kpi-last-year')?.className).toContain('max-[640px]:row-start-2');
    expect(query('overview-trend-kpi-current-value')?.className).toContain('max-[640px]:text-[40px]');
    expect(query('overview-trend-kpi-predicted-range')?.className).toContain('max-[640px]:hidden');
  });

  it("shows a past event's history with its final count and no forecast", async () => {
    await render({ eventId: 'e1', formats: [{ format: 'In Person', points: [point(-90, 100, null), point(0, 328, null)] }] }, true);

    expect(query('overview-trend-kpi-final')?.textContent).toContain('328');
    expect(query('overview-trend-kpi-predicted')).toBeNull();
    expect(query('overview-trend')?.textContent).not.toContain('Predicted');
    expect(query('overview-trend-band')?.getAttribute('d')).toBe('');
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
