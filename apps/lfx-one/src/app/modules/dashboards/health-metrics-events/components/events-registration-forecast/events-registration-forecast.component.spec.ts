// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsRegistrationForecastComponent } from './events-registration-forecast.component';

import type { ChartData } from 'chart.js';
import type {
  HealthMetricsEventsForecast,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurvePoint,
  HealthMetricsEventsForecastEvent,
} from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '<div data-testid="chart-stub"></div>' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'line'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

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
  let lifecycle: string[];

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
    })
      .overrideComponent(EventsRegistrationForecastComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(EventsRegistrationForecastComponent);
    fixture.componentInstance.countsChange.subscribe((note) => notes.push(note));
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
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

  function datasetLabels(): string[] {
    const chart = fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance as ChartStubComponent;
    return (chart.data()?.datasets ?? []).map((dataset) => dataset.label ?? '');
  }

  function datasetData(label: string): unknown[] {
    const chart = fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance as ChartStubComponent;
    return chart.data()?.datasets.find((dataset) => dataset.label === label)?.data ?? [];
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    notes = [];
    lifecycle = [];
  });

  it('reads the foundation, then the soonest event curve, and renders its headline and stats', async () => {
    await render();

    expect(getEventsRegistrationForecast).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(getEventsRegistrationForecastCurve).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
    expect(query('events-registration-forecast-value')?.textContent?.trim()).toBe('500');
    expect(query('events-registration-forecast-range')?.textContent).toContain('400–600');
    expect(query('events-registration-forecast-now')?.textContent?.trim()).toBe('250');
    expect(query('events-registration-forecast-last-year')?.textContent?.trim()).toBe('200');
    expect(query('events-registration-forecast-goal')?.textContent?.trim()).toBe('450');
    expect(query('events-registration-forecast-days-left')?.textContent?.trim()).toBe('40');
  });

  it('reports the miss count for the sub-nav note and settles once the list lands', async () => {
    await render({ events: [event(), event({ eventId: 'evt-2', goal: 700 })] });

    expect(notes).toEqual(['', '1 will miss goal']);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows an error rather than an empty list when the read fails, and still settles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(new Error('boom'));

    expect(query('events-registration-forecast-error')).not.toBeNull();
    expect(query('events-registration-forecast-empty')).toBeNull();
    expect(notes).toEqual(['', '']);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('says there are no upcoming events when the foundation has none', async () => {
    await render({ events: [] });

    expect(query('events-registration-forecast-empty')).not.toBeNull();
    expect(query('events-registration-forecast-pace')).toBeNull();
  });

  it('keeps the pace table when upcoming events exist but none has a forecast', async () => {
    await render({ events: [event({ forecastAvg: null })] });

    expect(query('events-registration-forecast-empty')).toBeNull();
    expect(query('events-registration-forecast-card')).toBeNull();
    expect(query('events-registration-forecast-no-forecast')).not.toBeNull();
    expect(query('events-registration-forecast-row-evt-1')).not.toBeNull();
    expect(getEventsRegistrationForecastCurve).not.toHaveBeenCalled();
  });

  it('marks a completed year as a closed period, reading nothing and noting no misses', async () => {
    await render({ events: [event({ goal: 700 })] });
    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(query('events-registration-forecast-closed')?.textContent).toContain('is a closed period');
    expect(query('events-registration-forecast-card')).toBeNull();
    expect(getEventsRegistrationForecast).toHaveBeenCalledTimes(1);
    expect(notes.at(-1)).toBe('');
    expect(lifecycle.at(-1)).toBe('settled');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance['onViewPastEvents']();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ fragment: 'past', queryParamsHandling: 'preserve' }));
  });

  it('names each event pill with its date, so same-named editions stay distinct', async () => {
    await render({ events: [event()] });

    expect(fixture.componentInstance['eventOptions']()[0].fullLabel).toMatch(/^Open Source Summit · \S/);
  });

  it('opens the event a deep link names, and writes a picked event back to the URL', async () => {
    await render({ events: [event(), event({ eventId: 'evt-2', eventName: 'Member Summit' })] }, curve(), { event: 'evt-2' });
    expect(getEventsRegistrationForecastCurve).toHaveBeenLastCalledWith({ foundationSlug: 'acme', eventId: 'evt-2' });

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance['onEventChange']('evt-1');
    await settle();

    expect(getEventsRegistrationForecastCurve).toHaveBeenLastCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { event: 'evt-1' }, queryParamsHandling: 'merge', preserveFragment: true })
    );
  });

  it('falls back to the soonest event when a deep link names one no longer upcoming', async () => {
    await render({ events: [event()] }, curve(), { event: 'gone' });

    expect(getEventsRegistrationForecastCurve).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'evt-1' });
  });

  it.each([
    [{ goal: 450 }, 'on-track', 'clear the goal by about 50'],
    [{ forecastAvg: 450.4, goal: 450 }, 'on-track', 'On track to meet the goal.'],
    [{ goal: 620 }, 'short', 'about 120 short of the 620 goal. There are 40 days left'],
    [{ forecastAvg: 449.6, goal: 450 }, 'short', 'just short of the 450 goal. There are 40 days left'],
    [{ goal: 150 }, 'stale', '3.3× the goal of 150'],
    [{ goal: 5000 }, 'goal-suspect', 'under a tenth of the goal'],
    [{ goal: 40 }, 'goal-suspect', 'over ten times the goal'],
    [{ goal: null }, 'no-goal', 'No registration goal is set'],
  ])('writes the %o verdict as %s', async (overrides, kind, copy) => {
    await render({ events: [event(overrides)] });
    const verdict = query('events-registration-forecast-verdict');

    expect(verdict?.getAttribute('data-kind')).toBe(kind);
    expect(verdict?.textContent?.replace(/\s+/g, ' ')).toContain(copy);
  });

  it('leaves the days-left sentence out of a short verdict when days left is unmeasured', async () => {
    await render({ events: [event({ goal: 620, daysLeft: null })] });

    expect(query('events-registration-forecast-verdict')?.textContent).not.toContain('days left');
    expect(query('events-registration-forecast-today')?.textContent).not.toContain('days left');
  });

  it('offers a format toggle only when both formats exist, opening on the one with more registrations', async () => {
    const twoFormats = curve({
      formats: [
        { format: 'Virtual', points: [point(-40, 30)] },
        { format: 'In Person', points: [point(-40, 220)] },
      ],
    });
    await render({ events: [event()] }, twoFormats);

    expect(query('events-registration-forecast-format-toggle')).not.toBeNull();
    expect(fixture.componentInstance['format']()).toBe('In Person');

    fixture.componentInstance['onFormatChange']('Virtual');
    await settle();
    expect(fixture.componentInstance['series']()?.format).toBe('Virtual');
  });

  it('hides the format toggle for a single-format event', async () => {
    await render();

    expect(query('events-registration-forecast-format-toggle')).toBeNull();
  });

  it('draws the goal and last year, and leaves out a suspect goal and a first edition prior curve', async () => {
    await render();
    expect(datasetLabels()).toEqual(['Confidence range', 'Forecast low', 'This year', 'Last year', 'Forecast', 'Goal', 'Today']);
    // Today marks the last measured day, whatever the days-left count says.
    expect(datasetData('Today')).toEqual([null, 250, null]);

    TestBed.resetTestingModule();
    await render({ events: [event({ goal: 5000, isNewEvent: true })] });
    expect(datasetLabels()).toEqual(['Confidence range', 'Forecast low', 'This year', 'Forecast', 'Today']);
    expect(query('events-registration-forecast-today')?.textContent).toContain('first edition');
    expect(query('events-registration-forecast-last-year')?.textContent?.trim()).toBe('first edition');
  });

  it('keeps the card when only the curve read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render({ events: [event()] }, new Error('boom'));

    expect(query('events-registration-forecast-value')?.textContent?.trim()).toBe('500');
    expect(query('events-registration-forecast-chart-empty')?.textContent).toContain('could not load the registration curve');
  });

  it('lists every upcoming event worst pacing first, with its status chip', async () => {
    await render({
      events: [
        event({ eventId: 'ahead', registrationsNow: 400 }),
        event({ eventId: 'behind', registrationsNow: 50, goal: 700 }),
        event({ eventId: 'none', goal: null }),
      ],
    });
    const rows = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-registration-forecast-row-"]')] as HTMLElement[];

    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'events-registration-forecast-row-behind',
      'events-registration-forecast-row-ahead',
      'events-registration-forecast-row-none',
    ]);
    expect(query('events-registration-forecast-status-behind')?.textContent?.trim()).toBe('Action required');
    expect(query('events-registration-forecast-status-none')?.textContent?.trim()).toBe('No goal');
    expect(rows[1].textContent).toContain('400 / 450');
  });
});
