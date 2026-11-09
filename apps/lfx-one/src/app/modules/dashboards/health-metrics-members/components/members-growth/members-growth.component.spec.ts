// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersGrowthComponent } from './members-growth.component';

import type { HealthMetricsMembersGrowth } from '@lfx-one/shared/interfaces';

/** Running totals from January; 2026 runs through November. */
const YEARS: Record<number, number[]> = {
  2018: [40, 82, 125, 163, 189, 215, 252, 301, 344, 376, 404, 433],
  2024: [45, 85, 120, 160, 190, 225, 262, 300, 350, 385, 420, 453],
  2025: [38, 70, 105, 150, 175, 215, 287, 306, 340, 375, 410, 480],
  2026: [74, 123, 184, 244, 293, 350, 408, 458, 523, 725, 801],
};

const GROWTH: HealthMetricsMembersGrowth = {
  months: Object.entries(YEARS).flatMap(([year, values]) => values.map((cumulative, index) => ({ year: Number(year), month: index + 1, cumulative }))),
};

describe('MembersGrowthComponent', () => {
  let fixture: ComponentFixture<MembersGrowthComponent>;
  let getMembersGrowth: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsMembersGrowth | Error = GROWTH): Promise<void> {
    getMembersGrowth = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [MembersGrowthComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getMembersGrowth } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersGrowthComponent);
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

  function query(testId: string, root: ParentNode = fixture.nativeElement): HTMLElement | null {
    return root.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string, root?: ParentNode): string {
    return query(testId, root)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function lines(): Element[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid^="members-growth-line-"]')];
  }

  function years(): string[] {
    return lines().map((line) => (line.getAttribute('data-testid') ?? '').replace('members-growth-line-', ''));
  }

  function solid(): string[] {
    return lines()
      .filter((line) => !line.hasAttribute('stroke-dasharray'))
      .map((line) => (line.getAttribute('data-testid') ?? '').replace('members-growth-line-', ''));
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // Only the clock is faked, so this year's month is pinned without stalling whenStable.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the foundation once and settles', async () => {
    await render();

    expect(getMembersGrowth).toHaveBeenCalledTimes(1);
    expect(getMembersGrowth).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('draws one line per year, oldest first, with the period’s year solid and the rest dashed', async () => {
    await render();

    expect(years()).toEqual(['2018', '2024', '2025', '2026']);
    expect(solid()).toEqual(['2026']);
    expect(text('members-growth-y-max')).toBe('1,000');
    expect([...(query('members-growth-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual(['2018', '2024', '2025', '2026']);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(solid()).toEqual(['2025']);
    expect(getMembersGrowth).toHaveBeenCalledTimes(1);
  });

  it('fades every other year while a legend item is hovered', async () => {
    await render();
    const legend = query('members-growth-legend-2025')!;

    legend.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(lines().map((line) => line.getAttribute('stroke-opacity'))).toEqual(['0.15', '0.15', '1', '0.15']);
    expect(query('members-growth-legend-2026')?.style.opacity).toBe('0.15');

    legend.dispatchEvent(new Event('mouseleave'));
    await settle();
    expect(lines().every((line) => line.getAttribute('stroke-opacity') === '1')).toBe(true);
  });

  it('shows a month’s popup while it is hovered or focused', async () => {
    await render();
    const month = query('members-growth-month-11')!;

    month.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(text('health-metrics-chart-tip-title', month)).toBe('November');
    expect(
      [...month.querySelectorAll('[data-testid="health-metrics-chart-tip-row"]')].map((row) =>
        [...row.children].map((side) => side.textContent?.trim()).join(' ')
      )
    ).toEqual(['2026 801', '2025 410', '2024 420', '2018 404']);
    expect(month.getAttribute('aria-label')).toBe('November. 2026: 801, 2025: 410, 2024: 420, 2018: 404');

    month.dispatchEvent(new Event('mouseleave'));
    await settle();
    expect(query('health-metrics-chart-tip', month)).toBeNull();

    month.dispatchEvent(new Event('focus'));
    await settle();
    expect(query('health-metrics-chart-tip', month)).not.toBeNull();
    month.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(query('health-metrics-chart-tip', month)).toBeNull();
  });

  it('settles empty, with no body, for a foundation with no month rows', async () => {
    await render({ months: [] });

    expect(query('members-growth-chart')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('warehouse down'));

    expect(query('members-growth-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton and never settles until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(query('members-growth-loading')).not.toBeNull();
    expect(getMembersGrowth).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['reading']);

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getMembersGrowth).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });
});
