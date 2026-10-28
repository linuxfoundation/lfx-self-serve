// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsAtAGlanceComponent } from './events-at-a-glance.component';

import type { HealthMetricsEventsAtAGlance, HealthMetricsEventsAtAGlancePeriod, HealthMetricsEventsAtAGlanceStatus } from '@lfx-one/shared/interfaces';

function period(overrides: Partial<HealthMetricsEventsAtAGlancePeriod> = {}): HealthMetricsEventsAtAGlancePeriod {
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
    changes: { registrations: -0.12, attendees: -0.35, organizations: 0.05, speakers: -0.1, countries: 0.2, events: 0.5, showUpRatePts: 0.022 },
    ...overrides,
  };
}

function glance(overrides: Partial<HealthMetricsEventsAtAGlance> = {}): HealthMetricsEventsAtAGlance {
  return {
    periods: [period(), period({ range: 'COMPLETED_YEAR_2', registrations: 8000, changes: null })],
    upcomingEvents: 3,
    hasEvents: true,
    ...overrides,
  };
}

describe('EventsAtAGlanceComponent', () => {
  let fixture: ComponentFixture<EventsAtAGlanceComponent>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(status: HealthMetricsEventsAtAGlanceStatus = 'ready', value: HealthMetricsEventsAtAGlance = glance()): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [EventsAtAGlanceComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsAtAGlanceComponent);
    fixture.componentRef.setInput('glance', value);
    fixture.componentRef.setInput('status', status);
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

  beforeEach(() => {
    lifecycle = [];
    verdicts = [];
  });

  it('renders the period control line, headline and side stats from the view', async () => {
    await render();

    expect(text('events-at-a-glance-control')).toBe('9 events · 6 past · 3 upcoming');
    expect(text('events-at-a-glance-headline-value')).toBe('12,400');
    expect(text('events-at-a-glance-headline-delta')).toBe('−12%');
    expect(text('events-at-a-glance-side-show-up-rate-value')).toBe('75%');
    expect(text('events-at-a-glance-side-show-up-rate-delta')).toBe('+2.2 pp');
    expect(verdicts).toEqual([false]);
  });

  it('compares against the same point last year, with no warning icon on a steep fall', async () => {
    await render();

    expect(text('events-at-a-glance-tile-attendees-delta')).toBe('−35%');
    expect(query('events-at-a-glance-tile-attendees')?.querySelector('.fa-triangle-exclamation')).toBeNull();
    expect(text('events-at-a-glance-baseline')).toBe('all against the same point last year');
  });

  it('shows Events as past plus upcoming, with no year-over-year delta', async () => {
    await render();

    expect(query('events-at-a-glance-side-events')?.querySelector('dt')?.textContent?.trim()).toBe('Events');
    expect(text('events-at-a-glance-side-events-value')).toBe('9');
    expect(query('events-at-a-glance-side-events-delta')).toBeNull();
  });

  it('draws the hero and the metric tiles unboxed, each tile labelled above its value', async () => {
    await render();

    expect(query('events-at-a-glance-hero')?.classList).not.toContain('border');
    const tile = query('events-at-a-glance-tile-attendees');
    expect(tile?.classList).not.toContain('border');
    expect(tile?.firstElementChild?.textContent?.trim()).toBe('Attendees');
  });

  it('re-projects a period change without deltas for an uncompared year, and settles again', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    await settle();

    expect(text('events-at-a-glance-headline-value')).toBe('8,000');
    expect(query('events-at-a-glance-headline-delta')).toBeNull();
    expect(query('events-at-a-glance-tile-registrations-delta')).toBeNull();
    expect(text('events-at-a-glance-baseline')).toBe('no year-over-year comparison for this period');
    expect(lifecycle).toEqual(['settled', 'settled']);
  });

  it('settles empty, with no body, for a period the read does not carry', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(verdicts).toEqual([false, true]);
    expect(query('events-at-a-glance-headline')).toBeNull();
    expect(query('events-at-a-glance-tiles')).toBeNull();
  });

  it('settles empty, with no body, for a zero-filled period with nothing upcoming', async () => {
    const quiet = period({ events: 0, pastEvents: 0, registrations: 0 });
    await render('ready', glance({ periods: [quiet], upcomingEvents: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('events-at-a-glance-control')).toBeNull();
    expect(query('events-at-a-glance-headline')).toBeNull();
  });

  it('keeps the body for a quiet year to date that has events upcoming', async () => {
    const quiet = period({ events: 0, pastEvents: 0, registrations: 0 });
    await render('ready', glance({ periods: [quiet], upcomingEvents: 2 }));

    expect(verdicts).toEqual([false]);
    expect(query('events-at-a-glance-headline')).not.toBeNull();
  });

  it('holds the skeleton and reports a read in flight while loading, then settles when it lands', async () => {
    await render('loading');

    expect(query('events-at-a-glance-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);

    fixture.componentRef.setInput('status', 'ready');
    await settle();

    expect(query('events-at-a-glance-headline')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows only its own error state when the read fails, and still settles', async () => {
    await render('failed');

    expect(query('events-at-a-glance-error')).not.toBeNull();
    expect(query('events-at-a-glance-headline')).toBeNull();
    expect(lifecycle).toEqual(['settled']);
    expect(verdicts).toEqual([false]);
  });
});
