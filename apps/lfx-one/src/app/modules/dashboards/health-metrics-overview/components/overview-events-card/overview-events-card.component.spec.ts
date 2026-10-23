// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { OverviewEventTrendDialogComponent } from '../overview-event-trend-dialog/overview-event-trend-dialog.component';

import { OverviewEventsCardComponent } from './overview-events-card.component';

import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsSponsorship,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEvents,
} from '@lfx-one/shared/interfaces';

@Component({ selector: 'lfx-overview-event-trend-dialog', template: '<div data-testid="trend-stub">{{ event().eventId }}</div>' })
class TrendDialogStubComponent {
  public readonly event = input.required<HealthMetricsOverviewEvent>();
  public readonly closed = output<void>();
}

const RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'] as const;
const GLANCE: HealthMetricsEventsAtAGlance = {
  periods: RANGES.map((range) => ({
    range,
    registrations: null,
    attendees: null,
    organizations: null,
    speakers: null,
    countries: null,
    events: 11,
    pastEvents: 11,
    showUpRate: null,
    changes: null,
  })),
  upcomingEvents: 4,
  hasEvents: true,
};
const SPONSORSHIP: HealthMetricsEventsSponsorship = {
  periods: RANGES.map((range) => ({
    range,
    revenueUsd: 3000000,
    goalUsd: 3500000,
    tierPackages: null,
    addOns: null,
    progressToGoal: null,
    changes: null,
    tiers: [],
  })),
};

function event(eventId: string, overrides: Partial<HealthMetricsOverviewEvent> = {}): HealthMetricsOverviewEvent {
  return {
    eventId,
    eventName: `Event ${eventId}`,
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
    ...overrides,
  };
}

const EVENTS: HealthMetricsOverviewEvents = {
  upcoming: Array.from({ length: 7 }, (_, index) => event(`u${index}`)),
  past: [event('p1', { compScore: null, goalMet: true, paceStatus: 'healthy', registrationsGoal: 300, registrations: 320, ranges: ['COMPLETED_YEAR'] })],
  truncated: false,
};

describe('OverviewEventsCardComponent', () => {
  let fixture: ComponentFixture<OverviewEventsCardComponent>;

  async function render(failSponsorship = false): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewEventsCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        {
          provide: AnalyticsService,
          useValue: {
            getEventsAtAGlance: vi.fn().mockReturnValue(of(GLANCE)),
            getEventsSponsorship: vi.fn().mockReturnValue(failSponsorship ? throwError(() => new Error('down')) : of(SPONSORSHIP)),
            getOverviewEvents: vi.fn().mockReturnValue(of(EVENTS)),
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    })
      .overrideComponent(OverviewEventsCardComponent, {
        remove: { imports: [OverviewEventTrendDialogComponent] },
        add: { imports: [TrendDialogStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(OverviewEventsCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function rows(): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid="overview-events-list"] > [data-testid^="overview-events-row-"]')];
  }

  it('counts upcoming events into YTD and tracks sponsorship against its goal', async () => {
    await render();

    expect(query('overview-events-total')?.textContent).toContain('15');
    expect(query('overview-events-total')?.textContent).toContain('11 held · 4 upcoming');
    expect(query('overview-events-sponsorship')?.textContent).toContain('of $3.5M goal');
  });

  it('opens on five upcoming events and loads five more at a time', async () => {
    await render();
    expect(rows()).toHaveLength(5);

    query('overview-events-load-more')?.click();
    fixture.detectChanges();

    expect(rows()).toHaveLength(7);
    expect(query('overview-events-load-more')).toBeNull();
  });

  it('badges registrations and shows accepted talks against proposals', async () => {
    await render();

    const registrations = query('overview-events-row-u0-registrations');
    expect(registrations?.textContent).toContain('At risk');
    expect(registrations?.textContent?.replace(/\s+/g, ' ')).toContain('328 / 1,000 · 33%');
    expect(query('overview-events-row-u0-talks')?.textContent?.replace(/\s+/g, ' ')).toContain('0 / 185');
  });

  it('opens the registration trend for an upcoming event, by click or keyboard', async () => {
    await render();

    rows()[1].click();
    fixture.detectChanges();
    expect(query('trend-stub')?.textContent).toBe('u1');

    fixture.componentInstance['trendEvent'].set(null);
    fixture.detectChanges();
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(query('trend-stub')?.textContent).toBe('u2');
  });

  it("lists a past year's events, back on the first page, none of them opening the trend", async () => {
    await render();
    query('overview-events-load-more')?.click();
    fixture.detectChanges();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(query('overview-events-list')?.textContent).toContain(`Events in ${new Date().getFullYear() - 1}`);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute('role')).toBeNull();
    expect(query('overview-events-row-p1-registrations')?.textContent).toContain('Hit goal');
    rows()[0].click();
    fixture.detectChanges();
    expect(query('trend-stub')).toBeNull();
  });

  it('fails as a whole when any of its reads fails', async () => {
    await render(true);

    expect(query('overview-events-error')).not.toBeNull();
  });
});
