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
import { OverviewEventDialogComponent } from '../overview-event-dialog/overview-event-dialog.component';

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

  function squashed(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, '') ?? '';
  }

  /** The row's two action pairs, the short "Trend" one first; container queries show one at a time. */
  function actionPairs(eventId: string): HTMLElement[] {
    return [...(query(`overview-events-row-${eventId}-actions`)?.querySelectorAll<HTMLElement>('lfx-ui-split-button') ?? [])];
  }

  function setTableWidth(width: number): void {
    fixture.componentInstance['tableWidth'].set(width);
    fixture.detectChanges();
  }

  it('shows registrations as a ring for a narrow table and a bar from 1000px, both coloured by status, with a legend in the footer', async () => {
    await render();

    expect(squashed('overview-events-row-u0-registrations-ring')).toBe('328Goal:1,000');
    const gauge = query('overview-events-row-u0-registrations-ring')?.querySelector('lfx-ui-gauge');
    expect(gauge?.getAttribute('aria-valuenow')).toBe('33');
    expect(gauge?.querySelector('[data-testid="ui-gauge-arc"]')?.getAttribute('class')).toContain('stroke-ui-warning-500');
    expect(query('overview-events-row-u0-registrations-ring')?.className).toContain('@[1000px]/evtbl:hidden');
    expect(query('overview-events-row-u0-registrations-bar')?.className).toContain('bg-amber-400');
    expect(squashed('overview-events-row-u0-registrations')).toContain('Status:Atrisk');
    expect(squashed('overview-events-row-u0-talks-ring')).toBe('0Received:185');
    expect(query('overview-events-footer')?.contains(query('overview-events-legend'))).toBe(true);
    expect(text('overview-events-legend')).toBe('On trackAt riskAction required');
    expect(text('overview-events-list-title')).toBe('Upcoming events');
  });

  it('stacks each row by default, with a status line, a label and a dark value per cell, and the table from 561px', async () => {
    await render();

    const header = query('overview-events-table')?.querySelector('[role="row"]');
    expect(header?.className).toContain('hidden');
    expect(header?.className).toContain('@[561px]/evtbl:grid');
    const registrations = query('overview-events-row-u0-registrations');
    expect(registrations?.className).toContain('border-l-[3px]');
    // The line follows the status alone: at risk is amber, and upcoming proposals have no status, so stay grey.
    expect(registrations?.className).toContain('border-l-amber-400');
    expect(query('overview-events-row-u0-talks')?.className).toContain('border-l-gray-200');
    expect(registrations?.firstElementChild?.textContent?.trim()).toBe('Registrations');
    expect(query('overview-events-row-u0-registrations-compact')?.textContent?.trim()).toBe('328 (Goal: 1,000)');
    expect(query('overview-events-row-u0-registrations-compact')?.className).toContain('text-gray-900');
    expect(query('overview-events-row-u0-talks-compact')?.textContent?.trim()).toBe('0 (Received: 185)');
    expect(query('overview-events-row-u0-registrations-ring')?.className).toContain('hidden');
    expect(query('overview-events-row-u0-registrations-ring')?.className).toContain('@[561px]/evtbl:flex');
  });

  it('moves the legend above the list on a phone', async () => {
    await render();

    expect(query('overview-events-legend-top')?.className).toContain('max-[640px]:flex');
    expect(text('overview-events-legend-top')).toBe('On trackAt riskAction required');
    expect(query('overview-events-legend')?.className).toContain('max-[640px]:hidden');
  });

  it('draws an empty ring and an unfilled outlined track, in the quiet colour, for an event without a goal', async () => {
    EVENTS.upcoming[0] = event('u0', { registrationsGoal: null });
    try {
      await render();
    } finally {
      EVENTS.upcoming[0] = event('u0');
    }

    expect(squashed('overview-events-row-u0-registrations-ring')).toBe('328Nogoalset');
    expect(query('overview-events-row-u0-registrations-ring')?.querySelector('lfx-ui-gauge')?.getAttribute('role')).toBe('img');
    expect(query('overview-events-row-u0-registrations-ring')?.querySelector('.text-gray-400')?.textContent?.trim()).toBe('No goal set');
    expect(query('overview-events-row-u0-registrations-track')?.className).toContain('bg-white');
    expect(query('overview-events-row-u0-registrations-bar')?.style.width).toBe('0%');
  });

  it('keeps the ring of an unknown count out of the accessibility tree, so it never reads as a measured 0%', async () => {
    EVENTS.upcoming[0] = event('u0', { registrations: null });
    try {
      await render();
    } finally {
      EVENTS.upcoming[0] = event('u0');
    }

    expect(query('overview-events-row-u0-registrations-ring')?.querySelector('lfx-ui-gauge')?.getAttribute('aria-hidden')).toBe('true');
    expect(query('overview-events-row-u1-registrations-ring')?.querySelector('lfx-ui-gauge')?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('lays the table out by its own width with no sideways scroll, and shortens the first action below 961px', async () => {
    await render();

    expect(query('overview-events-table')?.className).toContain('@container/evtbl');
    expect(fixture.nativeElement.querySelector('.overflow-x-auto, [class*="min-w-[820px]"]')).toBeNull();
    const [short, long] = actionPairs('u0');
    expect(short.querySelector('[data-testid="ui-split-button-main"]')?.textContent?.trim()).toBe('Trend');
    expect(short.className).toContain('@[961px]/evtbl:hidden');
    expect(long.querySelector('[data-testid="ui-split-button-main"]')?.textContent?.trim()).toBe('Registration trend');
    expect(long.querySelector('[data-testid="ui-split-button-secondary-label"]')?.textContent?.trim()).toBe('Snapshot');
    expect(long.getAttribute('aria-label')).toBe('Event u0');
    expect(query('overview-events-row-u0-actions')?.className).toContain('@[912px]/evtbl:flex');
  });

  it("opens an upcoming event's dialog on the matching tab from either half, anchored to the top", async () => {
    await render();
    const [, long] = actionPairs('u1');

    long.querySelector<HTMLButtonElement>('[data-testid="ui-split-button-main"] button')?.click();
    long.querySelector<HTMLButtonElement>('[data-testid="ui-split-button-secondary"]')?.click();

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][0]).toBe(OverviewEventDialogComponent);
    expect(open.mock.calls[0][1]).toMatchObject({
      showHeader: false,
      position: 'top',
      modal: true,
      dismissableMask: true,
      data: { event: expect.objectContaining({ eventId: 'u1' }), isPast: false, tab: 'trend' },
    });
    expect(open.mock.calls[1][1].data.tab).toBe('snapshot');
  });

  it('turns the event name into a button covering the row, opening the trend, only when the table is too narrow for the actions', async () => {
    await render();
    const nameButton = (): HTMLButtonElement | null => query('overview-events-row-u2-open') as HTMLButtonElement | null;

    setTableWidth(1200);
    expect(nameButton()).toBeNull();
    query('overview-events-row-u2')?.click();
    expect(open).not.toHaveBeenCalled();

    setTableWidth(800);
    expect(nameButton()?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(nameButton()?.className).toContain('after:inset-0');
    nameButton()?.click();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data).toMatchObject({ event: expect.objectContaining({ eventId: 'u2' }), tab: 'trend' });
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
    expect(squashed('overview-events-row-p1-talks-ring')).toBe('38Received:96');
    expect(query('overview-events-row-p1-talks-ring')?.querySelector('[data-testid="ui-gauge-arc"]')?.getAttribute('class')).toContain('stroke-ui-success-600');

    actionPairs('p2')[1].querySelector<HTMLButtonElement>('[data-testid="ui-split-button-main"] button')?.click();
    expect(open.mock.calls[0][1].data).toMatchObject({ event: expect.objectContaining({ eventId: 'p2' }), isPast: true });
  });

  it('fails as a whole when any of its reads fails', async () => {
    await render(true);

    expect(query('overview-events-error')).not.toBeNull();
  });
});
