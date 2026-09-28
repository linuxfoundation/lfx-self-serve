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
    ranges: ['YTD'],
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
  });

  it('reads the foundation once and settles once the revenue lands', async () => {
    await render();

    expect(getEventsRevenue).toHaveBeenCalledTimes(1);
    expect(getEventsRevenue).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('events-revenue-loading')).toBeNull();
  });

  it("renders the period's headline, side stats and the pending note", async () => {
    await render();

    expect(text('events-revenue-pending')).toBe('All figures pending validation');
    expect(text('events-revenue-headline-value')).toBe('$258K');
    expect(text('events-revenue-headline-delta')).toBe('+6%');
    expect(text('events-revenue-side-registration-value')).toBe('$180K');
    expect(query('events-revenue-side-registration-delta')).not.toBeNull();
    expect(text('events-revenue-side-sponsorship-delta')).toBe('−9%');
    expect(text('events-revenue-side-split-value')).toBe('70 / 30');
    expect(query('events-revenue-side-split-delta')).toBeNull();
  });

  it('lists the events in the period with their goals, leaving an unset goal out', async () => {
    await render();

    expect(query('events-revenue-row-rev-1')).not.toBeNull();
    expect(query('events-revenue-row-rev-2')).toBeNull();
    expect(text('events-revenue-registration-value-rev-1')).toBe('$180K');
    expect(text('events-revenue-registration-goal-rev-1')).toBe('/ $200K');
    expect(query('events-revenue-sponsorship-goal-rev-1')).toBeNull();
    expect(query('events-revenue-unconverted-rev-1')).toBeNull();
    expect(query('events-revenue-unconverted-note')).toBeNull();
    expect(query('events-revenue-headline-unconverted')).toBeNull();
    expect(query('events-revenue-side-registration-unconverted')).toBeNull();
  });

  it('re-projects a period change off the loaded response, marking unconverted revenue', async () => {
    await render();

    await pickRange('COMPLETED_YEAR');

    expect(getEventsRevenue).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(query('events-revenue-row-rev-1')).toBeNull();
    expect(text('events-revenue-unconverted-rev-2')).toBe('*');
    expect(query('events-revenue-registration-goal-rev-2')).toBeNull();
    expect(text('events-revenue-sponsorship-goal-rev-2')).toBe('/ $50K');
    expect(text('events-revenue-side-split-value')).toBe('not available');
    expect(text('events-revenue-unconverted-note')).toContain('leave out registration revenue not yet converted to USD');
    expect(text('events-revenue-headline-unconverted')).toBe('*');
    expect(text('events-revenue-side-registration-unconverted')).toBe('*');
    expect(query('events-revenue-side-sponsorship-unconverted')).toBeNull();
  });

  it('says a goal is withheld for its currency without marking the revenue', async () => {
    await render(revenue({ events: [revenueEvent({ registrationGoal: null, registrationGoalWithheld: true })] }));

    expect(text('events-revenue-registration-goal-rev-1')).toBe('/ goal not in USD');
    expect(query('events-revenue-sponsorship-goal-rev-1')).toBeNull();
    expect(query('events-revenue-unconverted-rev-1')).toBeNull();
    expect(query('events-revenue-unconverted-note')).toBeNull();
  });

  it('shows the empty table note for a measured period with no events', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(text('events-revenue-headline-value')).toBe('$0');
    expect(query('events-revenue-empty')).not.toBeNull();
    expect(query('events-revenue-table')).toBeNull();
  });

  it('says per-event figures are missing, not that no event ran, when only the totals were read', async () => {
    await render(revenue({ events: [], eventsMeasured: false }));

    expect(text('events-revenue-headline-value')).toBe('$258K');
    expect(query('events-revenue-events-unmeasured')).not.toBeNull();
    expect(query('events-revenue-empty')).toBeNull();
  });

  it('shows the unavailable state for a period the response does not carry', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_3');

    expect(query('events-revenue-unmeasured')).not.toBeNull();
    expect(query('events-revenue-foundation-unmeasured')).toBeNull();
    expect(query('events-revenue-hero')).toBeNull();
  });

  it('says the foundation has no revenue recorded, not to pick another period, when no period was read', async () => {
    await render(revenue({ periods: [], events: [], eventsMeasured: false }));

    expect(text('events-revenue-foundation-unmeasured')).toContain('No event revenue has been recorded for this foundation yet.');
    expect(query('events-revenue-unmeasured')).toBeNull();
    expect(query('events-revenue-hero')).toBeNull();
  });

  it('shows the error state and does not re-settle on a period change after a failed read', async () => {
    await render(new Error('warehouse down'));

    expect(query('events-revenue-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);

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
