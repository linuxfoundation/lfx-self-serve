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

import { MembersBreakdownComponent } from './members-breakdown.component';

import type { HealthMetricsMembersTiers, HealthMetricsMembersTierYear, HealthMetricsRange } from '@lfx-one/shared/interfaces';

/** One tier's rows from 2023 to 2026; revenue is a thousand dollars a member. */
function tier(name: string, sortRank: number, counts: [number, number, number, number]): HealthMetricsMembersTierYear[] {
  return counts.map((count, index) => ({
    year: 2023 + index,
    tier: name,
    sortRank,
    memberCount: count,
    revenueUsd: count * 1000,
  }));
}

const TIERS: HealthMetricsMembersTiers = {
  rows: [
    ...tier('Platinum Membership', 1, [5, 5, 6, 7]),
    ...tier('Gold Membership', 2, [10, 12, 15, 16]),
    ...tier('Silver Membership', 3, [30, 33, 40, 44]),
    ...tier('Associate Membership', 4, [8, 9, 10, 12]),
    ...tier('End User Supporter', 5, [2, 3, 4, 5]),
  ],
};

describe('MembersBreakdownComponent', () => {
  let fixture: ComponentFixture<MembersBreakdownComponent>;
  let getMembersTiers: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];
  let counts: (number | null)[];

  async function render(payload: HealthMetricsMembersTiers | Error = TIERS): Promise<void> {
    getMembersTiers = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [MembersBreakdownComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getMembersTiers } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersBreakdownComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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

  async function pickRange(range: HealthMetricsRange): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // Only the clock is faked, so the year the range maps to is pinned without stalling whenStable.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
    counts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the foundation once, settles, and reports the running year for the sub-nav', async () => {
    await render();

    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(getMembersTiers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(counts).toEqual([null, 84]);
  });

  it('re-counts the sub-nav for a period change without a re-read', async () => {
    await render();

    await pickRange('COMPLETED_YEAR');

    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(counts.at(-1)).toBe(75);
  });

  it('tables every tier in rank order, then the totals, striped and washed as the design draws them', async () => {
    await render();

    const cells = (key: string): string[] =>
      [...(query(`members-breakdown-row-${key}`)?.querySelectorAll('[role="rowheader"], [role="cell"]') ?? [])].map((cell) => cell.textContent?.trim() ?? '');
    const rows = [...fixture.nativeElement.querySelectorAll('[data-testid^="members-breakdown-row-"]')] as HTMLElement[];

    expect(rows.map((row) => row.getAttribute('data-testid')?.replace('members-breakdown-row-', ''))).toEqual([
      'tier-Platinum',
      'tier-Gold',
      'tier-Silver',
      'tier-Associate',
      'tier-End User Supporter',
      'members',
      'revenue',
    ]);
    expect([...(query('members-breakdown-table')?.querySelectorAll('[role="columnheader"]') ?? [])].map((cell) => cell.textContent?.trim())).toEqual([
      'Tier',
      '2023',
      '2024',
      '2025',
      '2026 YTD',
    ]);
    expect(cells('tier-Platinum')).toEqual(['Platinum', '5', '5', '6', '7']);
    expect(query('members-breakdown-row-tier-Platinum')?.querySelector('lfx-health-metrics-tier-icon')).not.toBeNull();
    expect(query('members-breakdown-row-tier-Associate')?.querySelector('lfx-health-metrics-tier-icon')).toBeNull();
    expect(cells('members')).toEqual(['Total members', '55', '62', '75', '84']);
    expect(cells('revenue')).toEqual(['Total revenue', '$55K', '$62K', '$75K', '$84K']);
    expect(rows.map((row) => row.className.includes('bg-gray-50'))).toEqual([false, true, false, true, false, false, false]);
    expect(query('members-breakdown-row-members')?.className).toContain('border-t');
    expect(query('members-breakdown-row-members')?.className).toContain('bg-blue-100');
    expect(query('members-breakdown-row-revenue')?.className).not.toContain('border-t');
    expect(query('members-breakdown-row-tier-End User Supporter')?.className).not.toContain('border-b');
    expect(query('members-breakdown-row-tier-Others')).toBeNull();
    expect(query('members-breakdown-chart')).toBeNull();
  });

  it('settles empty, with no body, for a foundation with no tier rows', async () => {
    await render({ rows: [] });

    expect(query('members-breakdown-chart')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(counts).toEqual([null, null]);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('warehouse down'));

    expect(query('members-breakdown-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(counts).toEqual([null, null]);
  });

  it('holds the skeleton and never settles until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(query('members-breakdown-loading')).not.toBeNull();
    expect(getMembersTiers).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['reading']);

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getMembersTiers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });
});
