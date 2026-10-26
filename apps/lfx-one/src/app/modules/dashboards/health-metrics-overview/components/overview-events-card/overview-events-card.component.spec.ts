// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
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
    changes: { registrations: null, attendees: null, organizations: null, speakers: null, countries: null, events: -0.24, showUpRatePts: null },
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
    acceptedTalks: 0,
    totalProposals: 185,
    cfpStatus: 'Review Complete',
    ranges: [],
    ...overrides,
  };
}

const EVENTS: HealthMetricsOverviewEvents = {
  upcoming: Array.from({ length: 7 }, (_, index) => event(`u${index}`)),
  past: [
    event('p1', { compScore: null, registrationsGoal: 300, registrations: 320, totalProposals: 96, acceptedTalks: 38, ranges: ['COMPLETED_YEAR'] }),
    event('p2', { compScore: null, registrationsGoal: 300, registrations: 250, ranges: ['COMPLETED_YEAR'] }),
  ],
  truncated: false,
};

describe('OverviewEventsCardComponent', () => {
  let fixture: ComponentFixture<OverviewEventsCardComponent>;
  let open: ReturnType<typeof vi.fn>;

  async function render(failSponsorship = false): Promise<void> {
    open = vi.fn().mockReturnValue({});
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
        set: { providers: [{ provide: DialogService, useValue: { open, dialogComponentRefMap: new Map() } }] },
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
    return [...fixture.nativeElement.querySelectorAll('[data-testid="overview-events-list"] [role="row"][data-testid^="overview-events-row-"]')];
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('splits the YTD total into past and upcoming events, with its change, and tracks sponsorship against its goal', async () => {
    await render();

    expect(text('overview-events-total-value')).toBe('15');
    expect(text('overview-events-total-delta')).toBe('Down24% vs last year');
    expect(text('overview-events-past-count')).toBe('Past 11');
    expect(text('overview-events-upcoming-count')).toBe('Upcoming 4');
    expect(query('overview-events-split')?.children).toHaveLength(2);
    expect(text('overview-events-sponsorship-goal')).toBe('Goal $3.5M');
    expect(text('overview-events-sponsorship-progress')).toBe('86% reached · $500K to goal');
  });

  it('opens on five upcoming events and shows the rest with View all', async () => {
    await render();
    expect(rows()).toHaveLength(5);
    expect(text('overview-events-view-all')).toBe('View all (7)');

    query('overview-events-view-all')?.click();
    fixture.detectChanges();

    expect(rows()).toHaveLength(7);
    expect(query('overview-events-view-all')).toBeNull();
  });

  it('colors the registrations bar by status, with no badge, beside a legend', async () => {
    await render();

    // The count and its goal sit apart in a flex row, so the text runs together.
    expect(text('overview-events-row-u0-registrations')).toBe('Registrations328of 1,000Status: At risk');
    expect(query('overview-events-row-u0-registrations-bar')?.className).toContain('bg-amber-400');
    expect(text('overview-events-row-u0-talks')).toBe('Accepted speaking proposals0of 185');
    expect(text('overview-events-legend')).toBe('On trackAt riskAction required');
    expect(text('overview-events-list-title')).toBe('Upcoming events');
  });

  it("opens an upcoming event's registration trend from its button", async () => {
    await render();

    query('overview-events-row-u1-trend')?.click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(OverviewEventTrendDialogComponent);
    expect(open.mock.calls[0][1]).toMatchObject({
      showHeader: false,
      modal: true,
      dismissableMask: true,
      data: { event: expect.objectContaining({ eventId: 'u1' }), isPast: false },
    });
  });

  it("lists a past year's events back on the first page, each opening its history", async () => {
    await render();
    query('overview-events-view-all')?.click();
    fixture.detectChanges();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(text('overview-events-list-title')).toBe('Past events');
    expect(rows()).toHaveLength(2);
    expect(query('overview-events-row-p1-registrations-bar')?.className).toContain('bg-emerald-500');
    expect(query('overview-events-row-p2-registrations-bar')?.className).toContain('bg-amber-400');
    expect(text('overview-events-row-p1-talks')).toContain('38of 96 submitted');

    query('overview-events-row-p2-trend')?.click();
    expect(open.mock.calls[0][1].data).toMatchObject({ event: expect.objectContaining({ eventId: 'p2' }), isPast: true });
  });

  it('fails as a whole when any of its reads fails', async () => {
    await render(true);

    expect(query('overview-events-error')).not.toBeNull();
  });
});
