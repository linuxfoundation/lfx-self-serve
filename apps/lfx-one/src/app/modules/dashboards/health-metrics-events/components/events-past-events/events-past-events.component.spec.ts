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

import type { HealthMetricsEventsPast, HealthMetricsEventsPastEvent } from '@lfx-one/shared/interfaces';

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
    city: 'Toronto',
    isVirtual: false,
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
  let lifecycle: string[];
  let verdicts: boolean[];

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
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it("reads the foundation once and renders the period's header from the view", async () => {
    await render();

    expect(getEventsPast).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(text('events-past-events-metrics-registrations-value')).toBe('1,500');
    expect(text('events-past-events-metrics-goal-reached-value')).toBe('1 of 1');
    expect(query('events-past-events-closed')).toBeNull();
  });

  it('lists each event with its place and date and its status pill, keeping $0 revenue as measured', async () => {
    await render();

    expect(text('events-past-events-row-past-1')).toContain('Toronto · Mar 10, 2026');
    expect(text('events-past-events-status-past-1')).toBe('Goal reached');
    expect(text('events-past-events-status-past-2')).toBe('No goal set');
    expect(text('events-past-events-revenue-past-2')).toBe('$0');
  });

  it('writes each goal as an inline neutral suffix, "/ {goal} (goal)" or "/ no goal set"', async () => {
    await render();

    expect(text('events-past-events-goal-past-1')).toBe('1,200 / 1,000 (goal)');
    expect(text('events-past-events-goal-past-2')).toBe('300 / no goal set');
    expect(query('events-past-events-goal-past-1')?.querySelector('span.text-gray-400')?.textContent?.trim()).toBe('/ 1,000 (goal)');
  });

  it('pages the table at 10 events, most recent first as read', async () => {
    const events = Array.from({ length: 12 }, (_, index) => pastEvent({ eventId: `evt-${index}` }));
    await render(past({ events }));

    const rows = () => fixture.nativeElement.querySelectorAll('[data-testid^="events-past-events-row-"]').length;
    expect(rows()).toBe(10);
    fixture.componentInstance['page'].set(1);
    await settle();
    expect(rows()).toBe(2);
  });

  it('opens on the latest event with the Event arrow, and sorts the whole list from page 1 on a picked column', async () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      pastEvent({ eventId: `evt-${index}`, eventStartDate: `2026-0${(index % 9) + 1}-01`, revenueUsd: index === 11 ? 999999 : 1000 })
    );
    await render(past({ events }));
    const header = (key: string): HTMLElement => query(`events-past-events-sort-${key}`) as HTMLElement;
    const firstRow = (): string | null | undefined =>
      fixture.nativeElement.querySelector('tr[data-testid^="events-past-events-row-"]')?.getAttribute('data-testid');

    expect(header('event').closest('th')?.getAttribute('aria-sort')).toBe('descending');
    fixture.componentInstance['page'].set(1);
    await settle();

    (header('revenue').querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(fixture.componentInstance['page']()).toBe(0);
    expect(firstRow()).toBe('events-past-events-row-evt-11');
  });

  it('settles once the list lands', async () => {
    await render();

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('re-projects a period change off the loaded response without re-reading', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getEventsPast).toHaveBeenCalledTimes(1);
    expect(query('events-past-events-row-past-1')).toBeNull();
    expect(query('events-past-events-row-past-2')).not.toBeNull();
    expect(text('events-past-events-metrics-goal-reached-value')).toBe('—');
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

    expect(text('events-past-events-metrics-goal-reached-value')).toBe('—');
    expect(text('events-past-events-status-past-1')).toBe('Not tracked');
  });

  it('marks a within-reach miss as just missed', async () => {
    await render(past({ events: [pastEvent({ registrations: 900, goalMet: false, paceStatus: 'needs_attention' })] }));

    expect(text('events-past-events-status-past-1')).toBe('Just missed');
    expect(text('events-past-events-metrics-goal-reached-value')).toBe('0 of 1');
  });

  it('settles empty, with no body, for a period with no closed events', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    await settle();

    expect(verdicts).toEqual([false, true]);
    expect(query('events-past-events-metrics')).toBeNull();
    expect(query('events-past-events-table')).toBeNull();
  });

  it('settles empty, with no body, for a period never measured', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_3');
    await settle();

    expect(verdicts).toEqual([false, true]);
    expect(query('events-past-events-metrics')).toBeNull();
    expect(query('events-past-events-table')).toBeNull();
  });

  it('shows the error state and does not re-settle a failed read on a period change', async () => {
    await render(new Error('warehouse down'));

    expect(query('events-past-events-error')).not.toBeNull();
    expect(verdicts).toEqual([false]);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsPast).not.toHaveBeenCalled();
    expect(query('events-past-events-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
