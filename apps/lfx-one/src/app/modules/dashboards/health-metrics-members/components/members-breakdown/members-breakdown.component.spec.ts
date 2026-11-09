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

  function text(testId: string, root?: ParentNode): string {
    return query(testId, root)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function pickRange(range: HealthMetricsRange): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  async function pickView(value: 'chart' | 'table'): Promise<void> {
    query('members-breakdown-view')?.querySelector<HTMLInputElement>(`input[value="${value}"]`)?.click();
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

  it('leads with the metrics row for the selected year, re-settling a period change without a re-read', async () => {
    await render();
    expect(text('members-breakdown-kpis-members')).toContain('Members in 2026 so far');
    expect(text('members-breakdown-kpis-members-value')).toBe('84');
    expect(text('members-breakdown-kpis-change-delta')).toContain('+12.0%');

    await pickRange('COMPLETED_YEAR');

    expect(text('members-breakdown-kpis-members')).toContain('Members in 2025');
    expect(getMembersTiers).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'settled', 'settled']);
    expect(counts.at(-1)).toBe(75);
  });

  it('stacks Platinum, Gold, Silver and a grey Others in each year, with a divided legend', async () => {
    await render();

    const column = query('members-breakdown-column-2026')!;
    expect([...column.querySelectorAll('[data-testid^="members-breakdown-segment-2026-"]')].map((segment) => segment.getAttribute('data-testid'))).toEqual([
      'members-breakdown-segment-2026-Platinum',
      'members-breakdown-segment-2026-Gold',
      'members-breakdown-segment-2026-Silver',
      'members-breakdown-segment-2026-Others',
    ]);
    expect(column.getAttribute('aria-label')).toContain('2026 · 84 members. Platinum: 7 · 8%');
    expect([...(query('members-breakdown-legend')?.children ?? [])].map((item) => item.textContent?.trim() || '|')).toEqual([
      'Platinum',
      'Gold',
      'Silver',
      '|',
      'Others',
    ]);
    expect(query('members-breakdown-legend-divider')).not.toBeNull();
  });

  it('shows a column’s popup while it is hovered or focused', async () => {
    await render();
    const column = query('members-breakdown-column-2026')!;

    column.dispatchEvent(new Event('mouseenter'));
    await settle();
    expect(text('health-metrics-chart-tip-title', column)).toBe('2026 · 84 members');
    expect(
      [...column.querySelectorAll('[data-testid="health-metrics-chart-tip-row"]')].map((row) =>
        [...row.children].map((side) => side.textContent?.trim()).join(' ')
      )
    ).toEqual(['Platinum 7 · 8%', 'Gold 16 · 19%', 'Silver 44 · 52%', 'Others 17 · 20%', 'Associate 12', 'End User Supporter 5', 'Revenue $84K']);
    expect(query('health-metrics-chart-tip-rule', column)).not.toBeNull();

    column.dispatchEvent(new Event('mouseleave'));
    await settle();
    expect(query('health-metrics-chart-tip', column)).toBeNull();

    // Escape dismisses a popup opened by focus, without moving focus off the column.
    column.dispatchEvent(new Event('focus'));
    await settle();
    expect(query('health-metrics-chart-tip', column)).not.toBeNull();
    column.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(query('health-metrics-chart-tip', column)).toBeNull();
  });

  it('switches to a table of every real tier, totals and their changes', async () => {
    await render();
    await pickView('table');

    expect(query('members-breakdown-chart')).toBeNull();
    const cells = (key: string): string[] =>
      [...(query(`members-breakdown-row-${key}`)?.querySelectorAll('[role="rowheader"], [role="cell"]') ?? [])].map((cell) => cell.textContent?.trim() ?? '');
    expect(cells('tier-Platinum')).toEqual(['Platinum', '5', '5', '6', '7']);
    expect(query('members-breakdown-row-tier-Platinum')?.querySelector('lfx-health-metrics-tier-icon')).not.toBeNull();
    expect(cells('tier-Associate')).toEqual(['Associate', '8', '9', '10', '12']);
    expect(query('members-breakdown-row-tier-Associate')?.querySelector('lfx-health-metrics-tier-icon')).toBeNull();
    expect(query('members-breakdown-row-tier-Others')).toBeNull();
    expect(cells('members')).toEqual(['Total members', '55', '62', '75', '84']);
    expect(cells('members-change')).toEqual(['Change vs. previous year', '—', '+12.7%', '+21.0%', '+12.0%']);
    expect(query('members-breakdown-row-members')?.className).toContain('border-t');
    expect([...(query('members-breakdown-row-members')?.querySelectorAll('[role="cell"]') ?? [])].at(-1)?.className).toContain('bg-blue-100');
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
