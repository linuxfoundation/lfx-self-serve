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
      { name: 'Gold Sponsor', packages: 20 },
      { name: 'Silver Sponsor', packages: 10 },
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

  it("renders the period's revenue, delta, side stats and packages pill", async () => {
    await render();

    expect(text('events-sponsorship-headline-value')).toBe('$750K');
    // The hero sits flush in the section, as the design draws it, not inside a card.
    expect(query('events-sponsorship-hero')?.classList).not.toContain('border');
    expect(text('events-sponsorship-headline-delta')).toBe('+20%');
    expect(query('events-sponsorship-headline-delta')?.className).toContain('text-emerald-600');
    expect(text('events-sponsorship-side-goal-value')).toBe('$1M');
    expect(text('events-sponsorship-side-tier-packages-value')).toBe('30');
    expect(text('events-sponsorship-side-add-ons-value')).toBe('12');
    expect(text('events-sponsorship-packages')).toBe('30 packages sold');
  });

  it('shows progress to the goal and ranks the tiers', async () => {
    await render();

    expect(text('events-sponsorship-progress-value')).toBe('75%');
    expect(query('events-sponsorship-no-goal')).toBeNull();
    expect(text('events-sponsorship-tier-0')).toContain('Gold Sponsor');
    expect(text('events-sponsorship-tier-0-value')).toBe('20');
    expect(text('events-sponsorship-tier-1-value')).toBe('10');
  });

  it('draws the progress as a short bar with the bold percent beside it, under a vtitle', async () => {
    await render();
    const progress = query('events-sponsorship-progress');
    const bar = progress?.querySelector('[role="progressbar"]');

    expect(progress?.querySelector('h4')?.textContent?.trim()).toBe('Progress to goal');
    expect(bar?.classList).toContain('w-[62px]');
    expect(bar?.classList).toContain('h-[6px]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('75');
    expect((bar?.firstElementChild as HTMLElement | null)?.style.width).toBe('75%');
    expect(bar?.firstElementChild?.classList).toContain('bg-blue-500');
    expect(query('events-sponsorship-progress-value')?.tagName).toBe('B');
  });

  it('shows the missing goal as an amber low-confidence banner with a decorative glyph', async () => {
    await render(sponsorship([period({ goalUsd: null, progressToGoal: null })]));
    const banner = query('events-sponsorship-no-goal');

    expect(banner?.classList).toContain('bg-amber-50');
    expect(banner?.classList).toContain('text-amber-700');
    expect(banner?.querySelector('[aria-hidden="true"]')?.textContent).toBe('◐');
    expect(text('events-sponsorship-no-goal')).toBe('◐ No sponsorship goal is set for this period, so no progress bar is shown.');
  });

  it('re-projects a period change without re-reading, and shows the callout when no goal is set', async () => {
    await render();
    lifecycle = [];

    await pickRange('COMPLETED_YEAR');

    expect(getEventsSponsorship).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['settled']);
    expect(text('events-sponsorship-headline-value')).toBe('$500K');
    expect(query('events-sponsorship-headline-delta')).toBeNull();
    expect(text('events-sponsorship-side-goal-value')).toBe('not set');
    expect(query('events-sponsorship-progress')).toBeNull();
    expect(query('events-sponsorship-no-goal')).not.toBeNull();
  });

  it('never renders a bar for a $0 goal', async () => {
    await render(sponsorship([period({ goalUsd: 0, progressToGoal: null })]));

    expect(query('events-sponsorship-progress')).toBeNull();
    expect(query('events-sponsorship-no-goal')).not.toBeNull();
  });

  it('draws no bar and no callout for a goal the view models no progress for', async () => {
    await render(sponsorship([period({ range: 'COMPLETED_YEAR_2', progressToGoal: null })]));

    await pickRange('COMPLETED_YEAR_2');

    expect(text('events-sponsorship-side-goal-value')).toBe('$1M');
    expect(query('events-sponsorship-progress')).toBeNull();
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
    expect(query('events-sponsorship-hero')).toBeNull();
  });

  it('settles empty, with no body, when the read carries no period', async () => {
    await render(sponsorship([]));

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(query('events-sponsorship-hero')).toBeNull();
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
