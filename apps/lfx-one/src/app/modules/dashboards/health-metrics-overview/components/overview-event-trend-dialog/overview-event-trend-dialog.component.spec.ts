// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
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
  goalMet: null,
  paceStatus: null,
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
  let closed: ReturnType<typeof vi.fn>;

  async function render(curve: HealthMetricsEventsForecastCurve | Error): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewEventTrendDialogComponent],
      providers: [
        {
          provide: AnalyticsService,
          useValue: {
            getEventsRegistrationForecast: vi.fn().mockReturnValue(of({ events: [HEADLINE] })),
            getEventsRegistrationForecastCurve: vi.fn().mockReturnValue(curve instanceof Error ? throwError(() => curve) : of(curve)),
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewEventTrendDialogComponent);
    fixture.componentRef.setInput('event', EVENT);
    closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
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

  it('is a labelled modal with the headline figures and the curve', async () => {
    await render(oneFormat);

    const dialog = query('overview-trend-dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(fixture.nativeElement.querySelector(`#${dialog?.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe('Acme Summit');
    expect(query('overview-trend-kpi-current')?.textContent).toContain('330');
    expect(query('overview-trend-kpi-predicted')?.textContent).toContain('620');
    expect(query('overview-trend-chart')?.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
    expect(query('overview-trend-format')).toBeNull();
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

  it('closes on the close button, the backdrop and Escape', async () => {
    await render(oneFormat);

    query('overview-trend-close')?.click();
    query('overview-trend-backdrop')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closed).toHaveBeenCalledTimes(3);
  });

  it('says so when the trend cannot be read', async () => {
    await render(new Error('down'));

    expect(query('overview-trend-error')).not.toBeNull();
    expect(query('overview-trend-chart')).toBeNull();
  });
});
