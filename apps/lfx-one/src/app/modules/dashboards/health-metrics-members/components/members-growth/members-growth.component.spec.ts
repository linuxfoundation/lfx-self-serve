// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  function lines(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid^="members-growth-line-"]')].map((line: Element) =>
      (line.getAttribute('data-testid') ?? '').replace('members-growth-line-', '')
    );
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

  it('leads with the metrics row, the projection carrying its tooltip', async () => {
    await render();

    expect(text('members-growth-kpis-new')).toContain('New members in 2026 so far');
    expect(text('members-growth-kpis-new-value')).toBe('801');
    expect(text('members-growth-kpis-change-value')).toBe('+391');
    expect(text('members-growth-kpis-change-delta')).toContain('+95%');
    expect(text('members-growth-kpis-since-value')).toBe('—');
    expect(text('members-growth-kpis-projected-value')).toBe('~874');
  });

  it('draws Highlights with the range, then each earlier year in All years without a re-read', async () => {
    await render();

    expect(lines()).toEqual(['projected', '2025', '2026']);
    expect(query('members-growth-band')).not.toBeNull();
    expect(text('members-growth-today')).toBe('Today');
    expect(text('members-growth-label-current')).toBe('2026: 801');
    expect(text('members-growth-label-projected')).toBe('~874 projected');
    expect([...(query('members-growth-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual([
      '2026',
      '2026 projected',
      '2025',
      '2018–2024 range',
    ]);

    query('members-growth-view')?.querySelector<HTMLInputElement>('input[value="all"]')?.click();
    await settle();

    expect(lines()).toEqual(['2018', '2024', 'projected', '2025', '2026']);
    expect(query('members-growth-band')).toBeNull();
    expect(getMembersGrowth).toHaveBeenCalledTimes(1);
  });

  it('shows a month’s popup while it is hovered or focused', async () => {
    await render();
    const month = query('members-growth-month-12')!;

    month.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(text('health-metrics-chart-tip-title', month)).toBe('Dec · cumulative new members');
    expect(
      [...month.querySelectorAll('[data-testid="health-metrics-chart-tip-row"]')].map((row) =>
        [...row.children].map((side) => side.textContent?.trim()).join(' ')
      )
    ).toEqual(['2026 projected ~874', '2025 480', '2024 453', '2018 433']);
    expect(month.getAttribute('aria-label')).toContain('Dec · cumulative new members. 2026 projected: ~874');

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
