// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsPastEventsComponent } from './events-past-events.component';

import type { HealthMetricsEventsPast, HealthMetricsEventsPastEvent, HealthMetricsEventsSectionKey } from '@lfx-one/shared/interfaces';

function pastEvent(overrides: Partial<HealthMetricsEventsPastEvent> = {}): HealthMetricsEventsPastEvent {
  return {
    eventId: 'past-1',
    eventName: 'Open Source Summit',
    eventStartDate: '2026-03-10',
    registrations: 1200,
    goal: 1000,
    goalMet: true,
    revenueUsd: 125000,
    paceStatus: 'healthy',
    ranges: ['YTD'],
    ...overrides,
  };
}

function past(overrides: Partial<HealthMetricsEventsPast> = {}): HealthMetricsEventsPast {
  return {
    periods: [
      { range: 'YTD', eventCount: 2, registrations: 1500 },
      { range: 'COMPLETED_YEAR', eventCount: 1, registrations: 300 },
      { range: 'COMPLETED_YEAR_2', eventCount: 0, registrations: 0 },
    ],
    events: [
      pastEvent(),
      pastEvent({
        eventId: 'past-2',
        eventName: 'Member Summit',
        goal: null,
        goalMet: null,
        paceStatus: null,
        registrations: 300,
        revenueUsd: 0,
        ranges: ['YTD', 'COMPLETED_YEAR'],
      }),
    ],
    ...overrides,
  };
}

describe('EventsPastEventsComponent', () => {
  let fixture: ComponentFixture<EventsPastEventsComponent>;
  let getEventsPast: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];
  let picked: HealthMetricsEventsSectionKey[];

  async function render(payload: HealthMetricsEventsPast | Error = past()): Promise<void> {
    getEventsPast = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsPastEventsComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsPast } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsPastEventsComponent);
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.sectionPicked.subscribe((key) => picked.push(key));
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
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    counts = [];
    lifecycle = [];
    picked = [];
  });

  it("reads the foundation once and renders the period's header from the view", async () => {
    await render();

    expect(getEventsPast).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(text('events-past-events-closed')).toBe('2 events closed this period');
    expect(text('events-past-events-registrations')).toBe('1,500');
    expect(text('events-past-events-goal-met-value')).toBe('1 of 1');
  });

  it('lists each event with its outcome, keeping $0 revenue as measured', async () => {
    await render();

    expect(query('events-past-events-row-past-1')).not.toBeNull();
    expect(text('events-past-events-status-past-1')).toBe('Hit goal');
    expect(text('events-past-events-status-past-2')).toBe('No goal set');
    expect(text('events-past-events-revenue-past-2')).toBe('$0');
  });

  it('reports the period count for the badge and settles once the list lands', async () => {
    await render();

    expect(counts).toEqual([null, 2]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('re-projects a period change off the loaded response without re-reading', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getEventsPast).toHaveBeenCalledTimes(1);
    expect(counts).toEqual([null, 2, 1]);
    expect(query('events-past-events-row-past-1')).toBeNull();
    expect(query('events-past-events-row-past-2')).not.toBeNull();
    expect(text('events-past-events-goal-met-value')).toBe('no goals set');
  });

  it('re-settles on a period change between two completed years, so the shell re-measures', async () => {
    await render();
    const chrome = TestBed.inject(HealthMetricsChromeService);

    chrome.selectedRange.set('COMPLETED_YEAR');
    await settle();
    chrome.selectedRange.set('COMPLETED_YEAR_2');
    await settle();

    expect(getEventsPast).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled', 'settled']);
  });

  it('reads goals with no measured outcome as not tracked, never as unset', async () => {
    await render(past({ events: [pastEvent({ registrations: null, goalMet: null })] }));

    expect(text('events-past-events-goal-met-value')).toBe('not tracked');
    expect(text('events-past-events-status-past-1')).toBe('Not tracked');
  });

  it('marks a within-reach miss as just missed', async () => {
    await render(past({ events: [pastEvent({ registrations: 900, goalMet: false, paceStatus: 'needs_attention' })] }));

    expect(text('events-past-events-status-past-1')).toBe('Just missed');
    expect(text('events-past-events-goal-met-value')).toBe('0 of 1');
  });

  it('shows the empty state for a period with no closed events', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    await settle();

    expect(query('events-past-events-empty')).not.toBeNull();
    expect(query('events-past-events-unmeasured')).toBeNull();
    expect(counts.at(-1)).toBe(0);
  });

  it('shows the unavailable state, not a measured zero, for a period the view has not measured', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_3');
    await settle();

    expect(query('events-past-events-unmeasured')).not.toBeNull();
    expect(query('events-past-events-empty')).toBeNull();
    expect(counts.at(-1)).toBeNull();
  });

  it('shows the error state and keeps the badge unmeasured when the read fails', async () => {
    await render(new Error('warehouse down'));

    expect(query('events-past-events-error')).not.toBeNull();
    expect(query('events-past-events-empty')).toBeNull();
    expect(counts).toEqual([null]);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(counts).toEqual([null]);
  });

  it('holds the skeleton until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsPast).not.toHaveBeenCalled();
    expect(query('events-past-events-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });

  it('cross-links back to the forecast', async () => {
    await render();

    query('events-past-events-forecast-link')?.click();

    expect(picked).toEqual(['forecast']);
  });
});
