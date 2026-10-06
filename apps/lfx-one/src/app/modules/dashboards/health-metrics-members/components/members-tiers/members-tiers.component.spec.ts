// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { MembersTiersComponent } from './members-tiers.component';

import type { ChartData } from 'chart.js';
import type { HealthMetricsMembersTiers, HealthMetricsMembersTierYear, HealthMetricsRange } from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '<div data-testid="chart-stub"></div>' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'bar'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

function row(
  year: number,
  tier: string,
  sortRank: number,
  memberCount: number | null,
  revenueUsd: number | null,
  newMemberCount = 0
): HealthMetricsMembersTierYear {
  return { year, tier, sortRank, memberCount, newMemberCount, revenueUsd, isPartialYear: year === 2026 };
}

const TIERS: HealthMetricsMembersTiers = {
  rows: [
    row(2024, 'Gold', 2, 10, 500_000),
    row(2024, 'Platinum', 1, 5, 1_000_000),
    row(2025, 'Gold', 2, 15, 750_000, 6),
    row(2025, 'Platinum', 1, 5, 1_000_000, 1),
    row(2025, 'Silver', 3, 0, 0),
    row(2026, 'Gold', 2, 16, 800_000, 2),
    row(2026, 'Platinum', 1, 6, 1_200_000, 1),
  ],
  foundationRevenue: [
    { range: 'YTD', totalUsd: 4_000_000 },
    { range: 'COMPLETED_YEAR', totalUsd: 3_500_000 },
  ],
};

describe('MembersTiersComponent', () => {
  let fixture: ComponentFixture<MembersTiersComponent>;
  let getMembersTiers: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];

  async function render(payload: HealthMetricsMembersTiers | Error = TIERS): Promise<void> {
    getMembersTiers = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [MembersTiersComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getMembersTiers } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    })
      .overrideComponent(MembersTiersComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(MembersTiersComponent);
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

  async function pickRange(range: HealthMetricsRange): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  function chartData(): ChartData<'bar'> | null {
    return fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance.data();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // Only the clock is faked, so the year the range maps to is pinned without stalling whenStable.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the foundation once and settles once the tiers land', async () => {
    await render();

    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(getMembersTiers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('members-tiers-loading')).toBeNull();
  });

  it('leads with members for the partial year, whose delta is not available', async () => {
    await render();

    expect(text('members-tiers-meta')).toBe('3 tiers · 3 years');
    expect(text('members-tiers-headline-value')).toBe('22');
    expect(text('members-tiers-headline-delta')).toBe('not available');
    expect(query('members-tiers-headline-baseline')).toBeNull();
    expect(text('members-tiers-headline-label')).toBe('Members');
    expect(text('members-tiers-side-revenue-value')).toBe('$2M');
    expect(text('members-tiers-side-new')).toContain('New this year');
    expect(query('members-tiers-side-new-value')?.className).toContain('text-emerald-600');
    expect(text('members-tiers-side-share-value')).toBe('50%');
  });

  it('swaps the hero to revenue without re-reading', async () => {
    await render();
    await pickRange('COMPLETED_YEAR');

    fixture.nativeElement.querySelector('[data-testid="filter-pill-revenue"]').click();
    await settle();

    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(text('members-tiers-headline-value')).toBe('$1.8M');
    expect(text('members-tiers-headline-delta')).toBe('+17%');
    expect(query('members-tiers-headline-delta')?.className).toContain('text-emerald-600');
    expect(text('members-tiers-side-members-value')).toBe('20');
  });

  it('re-settles a period change off the loaded response', async () => {
    await render();

    await pickRange('COMPLETED_YEAR');

    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(text('members-tiers-headline-value')).toBe('20');
    expect(text('members-tiers-headline-delta')).toBe('+33%');
    expect(text('members-tiers-headline-baseline')).toBe('vs 2024');
    expect(text('members-tiers-side-new')).toContain('New in 2025');
  });

  it('renders the matrix with dashes for zero, the current column shaded and both totals', async () => {
    await render();

    expect(text('members-tiers-row-0')).toContain('Platinum');
    expect(text('members-tiers-cell-2-2025')).toBe('—');
    expect(query('members-tiers-cell-2-2025')?.className).toContain('text-gray-300');
    expect(text('members-tiers-cell-1-2025')).toBe('15');
    expect(query('members-tiers-year-2026')?.className).toContain('bg-gray-50');
    expect(query('members-tiers-year-2025')?.className).not.toContain('bg-gray-50');
    const totals = [...(query('members-tiers-total-members')?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim());
    expect(totals).toEqual(['15', '20', '22']);
    expect(text('members-tiers-total-revenue')).toContain('$1.8M');
  });

  it('charts each tier as its share of the year, with the total under each year', async () => {
    await render();
    const data = chartData();

    expect(data?.labels).toEqual([
      ['2024', '15'],
      ['2025', '20'],
      ['2026', '22'],
    ]);
    expect(data?.datasets.map((dataset) => dataset.label)).toEqual(['Platinum', 'Gold', 'Silver']);
    expect(data?.datasets[1].data).toEqual([(10 / 15) * 100, 75, (16 / 22) * 100]);
    expect(text('members-tiers-legend')).toBe('Platinum Gold Silver');
  });

  it('says the period has no figures while still showing the other years', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_3');

    expect(query('members-tiers-hero')).toBeNull();
    expect(query('members-tiers-year-unmeasured')).not.toBeNull();
    expect(query('members-tiers-table')).not.toBeNull();
  });

  it('shows the empty state for a foundation with no tier rows', async () => {
    await render({ rows: [], foundationRevenue: [] });

    expect(query('members-tiers-empty')).not.toBeNull();
    expect(query('members-tiers-table')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('members-tiers-error')).not.toBeNull();
    expect(query('members-tiers-loading')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);

    await pickRange('COMPLETED_YEAR');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton and never settles until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersTiers).not.toHaveBeenCalled();
    expect(query('members-tiers-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getMembersTiers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });

  it('re-reads when the foundation changes', async () => {
    await render();

    selectedFoundation.set({ slug: 'globex' });
    await settle();

    expect(getMembersTiers).toHaveBeenCalledTimes(2);
    expect(getMembersTiers).toHaveBeenLastCalledWith({ foundationSlug: 'globex' });
  });
});
