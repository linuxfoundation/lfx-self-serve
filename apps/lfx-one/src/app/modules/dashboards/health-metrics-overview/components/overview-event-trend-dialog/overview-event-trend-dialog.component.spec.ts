// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OverviewEventTrendDialogComponent } from './overview-event-trend-dialog.component';

import type { HealthMetricsEventsForecastCurve, HealthMetricsOverviewEvent } from '@lfx-one/shared/interfaces';

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

describe('OverviewEventTrendDialogComponent', () => {
  let fixture: ComponentFixture<OverviewEventTrendDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let history: ReturnType<typeof vi.fn>;

  async function render(curve: HealthMetricsEventsForecastCurve | Error, isPast = false): Promise<void> {
    close = vi.fn();
    history = vi.fn().mockReturnValue(curve instanceof Error ? throwError(() => curve) : of(curve));
    await TestBed.configureTestingModule({
      imports: [OverviewEventTrendDialogComponent],
      providers: [
        {
          provide: AnalyticsService,
          useValue: {
            getEventsRegistrationForecast: vi.fn().mockReturnValue(of({ events: [HEADLINE] })),
            getEventsRegistrationForecastCurve: vi.fn().mockReturnValue(curve instanceof Error ? throwError(() => curve) : of(curve)),
            getEventsRegistrationHistory: history,
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { event: EVENT, isPast } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewEventTrendDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  const oneFormat: HealthMetricsEventsForecastCurve = {
    eventId: 'e1',
    formats: [{ format: 'In Person', points: [point(-90, 100, null), point(-46, 330, null), point(0, null, 620)] }],
  };

  it('titles itself with the event, under the heading the dialog is named by, with the figures and the curve', async () => {
    await render(oneFormat);

    expect(fixture.nativeElement.querySelector(`#${OverviewEventTrendDialogComponent.headingId}`)?.textContent?.trim()).toBe('Acme Summit');
    expect(query('overview-trend-dialog')?.textContent).toContain('Springfield · Dec 8–10, 2026');
    expect(query('overview-trend-kpi-current')?.textContent).toContain('330');
    expect(query('overview-trend-kpi-predicted')?.textContent).toContain('620');
    expect(query('overview-trend-chart')?.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
    expect(query('overview-trend-format')).toBeNull();
  });

  it('draws the goal line and names every line, the range and the goal in its legend', async () => {
    await render(oneFormat);

    expect(query('overview-trend-goal')).not.toBeNull();
    expect(query('overview-trend-dialog')?.textContent).toContain('Predicted range');
    expect(query('overview-trend-dialog')?.textContent).toContain('Registration goal');
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

    expect(history).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'e1' });
    expect(query('overview-trend-kpi-final')?.textContent).toContain('328');
    expect(query('overview-trend-kpi-days-left')?.textContent).toContain('Event held');
    expect(query('overview-trend-kpi-predicted')).toBeNull();
    expect(query('overview-trend-dialog')?.textContent).not.toContain('Predicted');
    expect(query('overview-trend-dialog')?.textContent).toContain('Registration goal');
    expect(query('overview-trend-chart')?.querySelector('line[stroke-dasharray="3 3"]')).toBeNull();
  });

  it('opens with focus on its title rather than the close button', async () => {
    await render(oneFormat);

    expect(document.activeElement?.id).toBe(OverviewEventTrendDialogComponent.headingId);
  });

  it('closes the dialog from its close button', async () => {
    await render(oneFormat);

    query('overview-trend-close')?.click();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('says so when the trend cannot be read', async () => {
    await render(new Error('down'));

    expect(query('overview-trend-error')).not.toBeNull();
    expect(query('overview-trend-chart')).toBeNull();
  });
});
