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

import { EventsRevenueComponent } from './events-revenue.component';

import type { HealthMetricsEventsRevenue, HealthMetricsEventsRevenueEvent, HealthMetricsEventsRevenuePeriod } from '@lfx-one/shared/interfaces';

function revenueEvent(overrides: Partial<HealthMetricsEventsRevenueEvent> = {}): HealthMetricsEventsRevenueEvent {
  return {
    eventId: 'rev-1',
    eventName: 'Open Source Summit',
    eventStartDate: '2026-03-10',
    registrationUsd: 180000,
    sponsorshipUsd: 78000,
    registrationGoal: 200000,
    sponsorshipGoal: null,
    hasUnconverted: false,
    registrationGoalWithheld: false,
    sponsorshipGoalWithheld: false,
    isPastEvent: true,
    goalMet: null,
    ranges: ['YTD'],
    city: 'Toronto',
    isVirtual: false,
    ...overrides,
  };
}

function period(overrides: Partial<HealthMetricsEventsRevenuePeriod> = {}): HealthMetricsEventsRevenuePeriod {
  return {
    range: 'YTD',
    totalUsd: 258000,
    registrationUsd: 180000,
    sponsorshipUsd: 78000,
    registrationShare: 0.7,
    sponsorshipShare: 0.3,
    hasUnconverted: false,
    changes: { total: 0.06, registration: null, sponsorship: -0.09 },
    ...overrides,
  };
}

function revenue(overrides: Partial<HealthMetricsEventsRevenue> = {}): HealthMetricsEventsRevenue {
  return {
    periods: [
      period(),
      period({ range: 'COMPLETED_YEAR', totalUsd: 400000, registrationShare: null, sponsorshipShare: null, hasUnconverted: true }),
      period({ range: 'COMPLETED_YEAR_2', totalUsd: 0, registrationUsd: 0, sponsorshipUsd: 0, registrationShare: null, sponsorshipShare: null }),
    ],
    events: [
      revenueEvent(),
      revenueEvent({
        eventId: 'rev-2',
        eventName: 'Member Summit',
        registrationUsd: 90000,
        registrationGoal: null,
        sponsorshipGoal: 50000,
        hasUnconverted: true,
        ranges: ['COMPLETED_YEAR'],
      }),
    ],
    eventsMeasured: true,
    ...overrides,
  };
}

describe('EventsRevenueComponent', () => {
  let fixture: ComponentFixture<EventsRevenueComponent>;
  let getEventsRevenue: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEventsRevenue | Error = revenue()): Promise<void> {
    getEventsRevenue = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsRevenueComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsRevenue } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsRevenueComponent);
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

  async function pickRange(range: HealthMetricsEventsRevenuePeriod['range']): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation once and settles once the revenue lands', async () => {
    await render();

    expect(getEventsRevenue).toHaveBeenCalledTimes(1);
    expect(getEventsRevenue).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('events-revenue-loading')).toBeNull();
  });

  it("lays out the period's three money lines with their changes, with no caption", async () => {
    await render();

    expect(text('events-revenue-metrics-total-value')).toBe('$258K');
    expect(text('events-revenue-metrics-total-trend')).toBe('+6%');
    expect(text('events-revenue-metrics-registration-value')).toBe('$180K');
    expect(text('events-revenue-metrics-registration-trend')).toBe('not available');
    expect(text('events-revenue-metrics-sponsorship-trend')).toBe('−9%');
    expect(query('events-revenue-metrics-split')).toBeNull();
    expect(query('events-revenue-pending')).toBeNull();
    expect(text('events-revenue-by-event-heading')).toBe('Revenue by event');
  });

  it('lists the events in the period with place and date, each amount with its goal as an inline suffix', async () => {
    await render();

    expect(text('events-revenue-row-rev-1')).toContain('Toronto · Mar 10, 2026');
    expect(query('events-revenue-row-rev-2')).toBeNull();
    expect(text('events-revenue-registration-rev-1')).toBe('$180K / $200K (goal)');
    expect(text('events-revenue-sponsorship-rev-1')).toBe('$78K / no goal set');
    expect(query('events-revenue-unconverted-note')).toBeNull();
  });

  it('re-projects a period change off the loaded response, with no unconverted markers', async () => {
    await render();

    await pickRange('COMPLETED_YEAR');

    expect(getEventsRevenue).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(query('events-revenue-row-rev-1')).toBeNull();
    expect(text('events-revenue-registration-rev-2')).toBe('$90K / no goal set');
    expect(text('events-revenue-sponsorship-rev-2')).toBe('$78K / $50K (goal)');
    expect(query('events-revenue-row-rev-2')?.textContent).not.toContain('*');
  });

  it('opens with no arrow, and sorts the whole list from page 1 on a picked column, a "—" amount last', async () => {
    const events = Array.from({ length: 12 }, (_, index) => revenueEvent({ eventId: `evt-${index}`, sponsorshipUsd: index === 0 ? null : index * 1000 }));
    await render(revenue({ events }));
    const header = (key: string): HTMLElement => query(`events-revenue-sort-${key}`) as HTMLElement;
    const ids = (): string[] =>
      [...fixture.nativeElement.querySelectorAll('tr[data-testid^="events-revenue-row-"]')].map((row: Element) => row.getAttribute('data-testid') ?? '');

    expect(['event', 'registration', 'sponsorship'].map((key) => header(key).closest('th')?.getAttribute('aria-sort'))).toEqual(['none', 'none', 'none']);
    fixture.componentInstance['page'].set(1);
    await settle();

    (header('sponsorship').querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(fixture.componentInstance['page']()).toBe(0);
    expect(ids()[0]).toBe('events-revenue-row-evt-11');
    fixture.componentInstance['page'].set(1);
    await settle();
    expect(ids().at(-1)).toBe('events-revenue-row-evt-0');
  });

  it('pages the table at 10 events', async () => {
    const events = Array.from({ length: 12 }, (_, index) => revenueEvent({ eventId: `evt-${index}` }));
    await render(revenue({ events }));

    const rows = () => fixture.nativeElement.querySelectorAll('[data-testid^="events-revenue-row-"]').length;
    expect(rows()).toBe(10);
    fixture.componentInstance['page'].set(1);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rows()).toBe(2);
  });

  it('lists upcoming events first in the one table on the current-year view, with no goal chip', async () => {
    const upcoming = revenueEvent({ eventId: 'rev-3', eventName: 'Winter Summit', eventStartDate: '2026-12-01', isPastEvent: false, ranges: [] });
    await render(revenue({ events: [revenueEvent({ goalMet: true }), upcoming] }));

    const rowIds = Array.from(query('events-revenue-table')?.querySelectorAll('[data-testid^="events-revenue-row-"]') ?? []).map((row) =>
      row.getAttribute('data-testid')
    );
    expect(rowIds).toEqual(['events-revenue-row-rev-3', 'events-revenue-row-rev-1']);

    await pickRange('COMPLETED_YEAR');

    expect(query('events-revenue-row-rev-3')).toBeNull();
  });

  it('says a goal is withheld for its currency, and reads $0 with no goal as "—"', async () => {
    await render(revenue({ events: [revenueEvent({ registrationGoal: null, registrationGoalWithheld: true, sponsorshipUsd: 0 })] }));

    expect(text('events-revenue-registration-rev-1')).toBe('$180K / goal not in USD');
    expect(text('events-revenue-sponsorship-rev-1')).toBe('— / no goal set');
  });

  // $0 with no event in the period is nothing to show, so the shell's empty state takes the section over.
  it('settles empty, with no body, for a $0 period with no events', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(verdicts).toEqual([false, true]);
    expect(query('events-revenue-metrics')).toBeNull();
  });

  it('shows the empty table note for a period with revenue but no listed events', async () => {
    await render(revenue({ events: [revenueEvent({ ranges: ['COMPLETED_YEAR'] })] }));

    expect(text('events-revenue-metrics-total-value')).toBe('$258K');
    expect(query('events-revenue-empty')).not.toBeNull();
    expect(query('events-revenue-table')).toBeNull();
    expect(verdicts).toEqual([false]);
  });

  it('says per-event figures are missing, not that no event ran, when only the totals were read', async () => {
    await render(revenue({ events: [], eventsMeasured: false }));

    expect(text('events-revenue-metrics-total-value')).toBe('$258K');
    expect(query('events-revenue-events-unmeasured')).not.toBeNull();
    expect(query('events-revenue-empty')).toBeNull();
  });

  it('settles empty, with no body, for a period the response does not carry', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_3');

    expect(verdicts).toEqual([false, true]);
    expect(query('events-revenue-metrics')).toBeNull();
  });

  it('settles empty, with no body, when no period was read for the foundation', async () => {
    await render(revenue({ periods: [], events: [], eventsMeasured: false }));

    expect(verdicts).toEqual([true]);
    expect(query('events-revenue-metrics')).toBeNull();
  });

  it('shows the error state and does not re-settle on a period change after a failed read', async () => {
    await render(new Error('warehouse down'));

    expect(query('events-revenue-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);

    await pickRange('COMPLETED_YEAR');

    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsRevenue).not.toHaveBeenCalled();
    expect(query('events-revenue-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
