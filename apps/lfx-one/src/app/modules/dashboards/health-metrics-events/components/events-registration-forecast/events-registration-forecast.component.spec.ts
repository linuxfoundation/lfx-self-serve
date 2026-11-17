// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsRegistrationForecastComponent } from './events-registration-forecast.component';

import type {
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurvePoint,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsForecastPicker,
} from '@lfx-one/shared/interfaces';

function event(overrides: Partial<HealthMetricsEventsForecastEvent> = {}): HealthMetricsEventsForecastEvent {
  return {
    eventId: 'evt-1',
    eventName: 'Open Source Summit',
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

function point(
  daysToEvent: number,
  actual: number | null,
  overrides: Partial<HealthMetricsEventsForecastCurvePoint> = {}
): HealthMetricsEventsForecastCurvePoint {
  return { daysToEvent, actual, forecastAvg: null, forecastLow: null, forecastHigh: null, priorYear: 150, ...overrides };
}

function curve(overrides: Partial<HealthMetricsEventsForecastCurve> = {}): HealthMetricsEventsForecastCurve {
  return {
    eventId: 'evt-1',
    formats: [{ format: 'In Person', points: [point(-41, 240), point(-40, 250), point(-20, null, { forecastAvg: 400, forecastLow: 350, forecastHigh: 450 })] }],
    ...overrides,
  };
}

describe('EventsRegistrationForecastComponent', () => {
  let fixture: ComponentFixture<EventsRegistrationForecastComponent>;
  let getEventsRegistrationForecast: ReturnType<typeof vi.fn>;
  let getEventsRegistrationForecastCurve: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let notes: string[];
  let pickers: HealthMetricsEventsForecastPicker[];
  let lifecycle: string[];
  let verdicts: (boolean | null)[];

  async function render(
    payload: HealthMetricsEventsForecast | Error = { events: [event()] },
    curvePayload: HealthMetricsEventsForecastCurve | Error = curve(),
    queryParams: Record<string, string> = {}
  ): Promise<void> {
    getEventsRegistrationForecast = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));
    getEventsRegistrationForecastCurve = vi.fn().mockReturnValue(curvePayload instanceof Error ? throwError(() => curvePayload) : of(curvePayload));

    await TestBed.configureTestingModule({
      imports: [EventsRegistrationForecastComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsRegistrationForecast, getEventsRegistrationForecastCurve } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsRegistrationForecastComponent);
    fixture.componentInstance.countsChange.subscribe((note) => notes.push(note));
    fixture.componentInstance.pickerChange.subscribe((picker) => pickers.push(picker));
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowIds(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid^="events-registration-forecast-row-"]')].map(
      (row) => (row as HTMLElement).getAttribute('data-testid') ?? ''
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    notes = [];
    pickers = [];
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation, then the soonest event curve, and lays out its metrics row', async () => {
    await render();

    expect(getEventsRegistrationForecast).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(getEventsRegistrationForecastCurve).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
    const metrics = text('events-registration-forecast-metrics');
    expect(metrics).toContain('Current');
    expect(metrics).toContain('Same point last year: 200');
    expect(metrics).toContain('High 600 · Low 400');
    expect(metrics).toContain('Days left');
  });

  it('writes the verdict as a tagged note', async () => {
    await render({ events: [event({ goal: 700 })] });

    expect(text('events-registration-forecast-verdict')).toContain('Needs action:');
    expect(text('events-registration-forecast-verdict')).toContain('Projected to finish about 200 short of the 700 goal. There are 40 days left');
  });

  it("draws the Overview dialog's registration trend without its headline figures", async () => {
    await render();

    expect(query('events-registration-forecast-trend')).not.toBeNull();
    expect(query('overview-trend-kpis')).toBeNull();
    expect(query('overview-trend-chart')).not.toBeNull();
    expect(query('overview-trend-grid')?.className).toContain('grid-rows-[280px_auto_auto]');
  });

  it('keeps the metrics when only the curve read fails, and says so in the chart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render({ events: [event()] }, new Error('boom'));

    expect(text('events-registration-forecast-metrics')).toContain('500');
    expect(query('overview-trend-error')).not.toBeNull();
  });

  it('reports the header select its events, soonest first, and the one shown', async () => {
    await render({ events: [event(), event({ eventId: 'evt-2', eventName: 'Member Summit' })] });

    expect(pickers.at(-1)).toEqual({
      options: [
        { eventId: 'evt-1', label: 'Open Source Summit' },
        { eventId: 'evt-2', label: 'Member Summit' },
      ],
      eventId: 'evt-1',
    });
  });

  it('opens the event a deep link names, and writes a picked event back to the URL', async () => {
    await render({ events: [event(), event({ eventId: 'evt-2', eventName: 'Member Summit' })] }, curve(), { event: 'evt-2' });
    expect(getEventsRegistrationForecastCurve).toHaveBeenLastCalledWith({ foundationSlug: 'acme', eventId: 'evt-2' });
    expect(pickers.at(-1)?.eventId).toBe('evt-2');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('pickedEventId', 'evt-1');
    await settle();

    expect(getEventsRegistrationForecastCurve).toHaveBeenLastCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
    expect(pickers.at(-1)?.eventId).toBe('evt-1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { event: 'evt-1' }, queryParamsHandling: 'merge', preserveFragment: true })
    );
  });

  it('falls back to the soonest event when a deep link names one no longer upcoming', async () => {
    await render({ events: [event()] }, curve(), { event: 'gone' });

    expect(getEventsRegistrationForecastCurve).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
  });

  it('keeps an event with no forecast in the select, with a dashed Predicted and a Summary note', async () => {
    await render({ events: [event({ forecastAvg: null, forecastHigh: null, forecastLow: null })] });

    expect(pickers.at(-1)?.options).toHaveLength(1);
    expect(text('events-registration-forecast-metrics')).not.toContain('High');
    expect(text('events-registration-forecast-verdict')).toContain('Summary:');
    expect(text('events-registration-forecast-verdict')).toContain('There is no forecast for this event yet.');
  });

  it('reports the miss count for the sub-nav note and settles once the list lands', async () => {
    await render({ events: [event(), event({ eventId: 'evt-2', goal: 700 })] });

    expect(notes).toEqual(['', '1 will miss goal']);
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('shows an error rather than an empty list when the read fails, offering no events, and still settles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(new Error('boom'));

    expect(query('events-registration-forecast-error')).not.toBeNull();
    expect(pickers.at(-1)).toEqual({ options: [], eventId: null });
    expect(notes).toEqual(['', '']);
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('settles empty, with no body, when the foundation has no upcoming events', async () => {
    await render({ events: [] });

    expect(verdicts).toEqual([true]);
    expect(query('events-registration-forecast-metrics')).toBeNull();
    expect(query('events-registration-forecast-table')).toBeNull();
  });

  it('shows only the closed-period empty state for a completed year, reading nothing and offering no events', async () => {
    await render({ events: [event({ goal: 700 })] });
    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(text('events-registration-forecast-closed')).toContain('is a closed period');
    expect(text('events-registration-forecast-closed')).not.toContain('Past events');
    expect(query('events-registration-forecast-metrics')).toBeNull();
    expect(pickers.at(-1)).toEqual({ options: [], eventId: null });
    expect(getEventsRegistrationForecast).toHaveBeenCalledTimes(1);
    expect(notes.at(-1)).toBe('');
    expect(lifecycle.at(-1)).toBe('settled');
    // A closed period keeps its own note, so it gives the shell no verdict.
    expect(verdicts.at(-1)).toBeNull();
  });

  it('lists every upcoming event worst pace first under its heading, each with its place and date', async () => {
    await render({
      events: [
        event({ eventId: 'ahead', registrationsNow: 400 }),
        event({ eventId: 'behind', registrationsNow: 50, goal: 700 }),
        event({ eventId: 'none', goal: null, city: null, isVirtual: true }),
      ],
    });

    expect(text('events-registration-forecast-upcoming-heading')).toBe('All upcoming events');
    expect(rowIds()).toEqual(['events-registration-forecast-row-behind', 'events-registration-forecast-row-ahead', 'events-registration-forecast-row-none']);
    expect(text('events-registration-forecast-row-ahead')).toContain('Springfield · Nov 4, 2026');
    expect(text('events-registration-forecast-row-none')).toContain('Virtual · Nov 4, 2026');
  });

  it('draws the goal bar coloured by the forecast, and "No goal set" with no bar for an event without a goal', async () => {
    await render({ events: [event({ eventId: 'behind', registrationsNow: 50, goal: 700 }), event({ eventId: 'none', registrationsNow: 120, goal: null })] });

    expect(text('events-registration-forecast-goal-behind')).toContain('Goal: 700');
    expect(query('events-registration-forecast-goal-behind')?.querySelector('[data-testid="health-metrics-progress-fill"]')?.className).toContain('bg-red-400');
    expect(text('events-registration-forecast-goal-none')).toContain('No goal set');
    expect(query('events-registration-forecast-goal-none')?.querySelector('[data-testid="health-metrics-progress-fill"]')).toBeNull();
  });

  it('pages the table at 10 events', async () => {
    const events = Array.from({ length: 12 }, (_, index) => event({ eventId: `evt-${index}`, registrationsNow: index * 10 }));
    await render({ events });

    expect(rowIds()).toHaveLength(10);
    fixture.componentInstance['page'].set(1);
    await settle();
    expect(rowIds()).toHaveLength(2);
  });
});
