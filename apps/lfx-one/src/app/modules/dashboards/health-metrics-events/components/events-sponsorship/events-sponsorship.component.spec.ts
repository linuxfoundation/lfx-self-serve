// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsSponsorshipComponent } from './events-sponsorship.component';

import type { HealthMetricsEventsSponsorship, HealthMetricsEventsSponsorshipPeriod } from '@lfx-one/shared/interfaces';

function period(overrides: Partial<HealthMetricsEventsSponsorshipPeriod> = {}): HealthMetricsEventsSponsorshipPeriod {
  return {
    range: 'YTD',
    revenueUsd: 750000,
    goalUsd: 1000000,
    tierPackages: 30,
    addOns: 12,
    progressToGoal: 0.75,
    changes: { revenue: 0.2 },
    tiers: [
      { name: 'Gold', packages: 20 },
      { name: 'Startup', packages: 10 },
    ],
    ...overrides,
  };
}

function sponsorship(
  periods: HealthMetricsEventsSponsorshipPeriod[] = [
    period(),
    period({ range: 'COMPLETED_YEAR', revenueUsd: 500000, goalUsd: null, progressToGoal: null, changes: null }),
  ]
): HealthMetricsEventsSponsorship {
  return { periods };
}

describe('EventsSponsorshipComponent', () => {
  let fixture: ComponentFixture<EventsSponsorshipComponent>;
  let getEventsSponsorship: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEventsSponsorship | Error = sponsorship()): Promise<void> {
    getEventsSponsorship = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsSponsorshipComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsSponsorship } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsSponsorshipComponent);
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

  async function pickRange(range: HealthMetricsEventsSponsorshipPeriod['range']): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation once and settles', async () => {
    await render();

    expect(getEventsSponsorship).toHaveBeenCalledTimes(1);
    expect(getEventsSponsorship).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('events-sponsorship-loading')).toBeNull();
  });

  it("lays out the period's metrics row: revenue with its change, the goal reached, packages and add-ons", async () => {
    await render();

    expect(text('events-sponsorship-metrics-revenue-value')).toBe('$750K');
    expect(text('events-sponsorship-metrics-revenue-trend')).toBe('+20%');
    expect(text('events-sponsorship-metrics-goal-value')).toBe('$1M');
    expect(text('events-sponsorship-metrics-goal-description')).toBe('75% reached');
    expect(text('events-sponsorship-metrics-tier-packages-value')).toBe('30');
    expect(text('events-sponsorship-metrics-add-ons-value')).toBe('12');
    expect(query('events-sponsorship-packages')).toBeNull();
    expect(query('events-sponsorship-progress')).toBeNull();
  });

  it('draws the tier packages as bars, most sold first, with the tier icon or the ticket', async () => {
    await render();

    expect(text('events-sponsorship-tiers-heading')).toBe('Tier packages');
    expect([...(query('events-sponsorship-tiers-row-Gold')?.children ?? [])].map((cell) => cell.textContent?.trim())).toEqual(['Gold', '', '20']);
    expect(query('events-sponsorship-tiers-row-Gold')?.querySelector('lfx-health-metrics-tier-icon')).not.toBeNull();
    expect(query('events-sponsorship-tiers-row-Startup')?.querySelector('.fa-ticket')).not.toBeNull();
  });

  it('re-projects a period change without re-reading, reading Goal as "—" when none is set', async () => {
    await render();
    lifecycle = [];

    await pickRange('COMPLETED_YEAR');

    expect(getEventsSponsorship).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['settled']);
    expect(text('events-sponsorship-metrics-revenue-value')).toBe('$500K');
    expect(query('events-sponsorship-metrics-revenue-trend')).toBeNull();
    expect(text('events-sponsorship-metrics-goal-value')).toBe('—');
    expect(query('events-sponsorship-metrics-goal-description')).toBeNull();
    expect(query('events-sponsorship-no-goal')).toBeNull();
  });

  it('says nothing was sold when the period has no tier packages', async () => {
    await render(sponsorship([period({ tiers: [] })]));

    expect(query('events-sponsorship-tiers-empty')).not.toBeNull();
  });

  it('settles empty, with no body, for a period the read carries no figures for', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(verdicts).toEqual([false, true]);
    expect(query('events-sponsorship-metrics')).toBeNull();
  });

  it('settles empty, with no body, when the read carries no period', async () => {
    await render(sponsorship([]));

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(query('events-sponsorship-metrics')).toBeNull();
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('events-sponsorship-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsSponsorship).not.toHaveBeenCalled();
    expect(query('events-sponsorship-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
