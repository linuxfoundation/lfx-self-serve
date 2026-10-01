// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersChurnComponent } from './members-churn.component';

import type {
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDeparture,
  HealthMetricsMembersChurnDepartures,
  HealthMetricsMembersChurnTier,
  HealthMetricsMembersChurnYear,
} from '@lfx-one/shared/interfaces';

function churnYear(year: number, overrides: Partial<HealthMetricsMembersChurnYear> = {}): HealthMetricsMembersChurnYear {
  return {
    year,
    isPartialYear: year === 2026,
    lostCount: 12,
    openingCount: 120,
    duesLostUsd: 1_500_000,
    duesLostPriorUsd: 900_000,
    revenueChurnRate: 16,
    revenueChurnRatePrior: 11.4,
    revenueChurnRateChangePp: 4.6,
    logoChurnRate: 10,
    ...overrides,
  };
}

function tier(year: number, name: string, rank: number, lost: number, dues: number, share: number, rate: number): HealthMetricsMembersChurnTier {
  return { year, tier: name, tierSortRank: rank, lostCount: lost, churnRate: rate, duesLostUsd: dues, shareOfLossPct: share };
}

function departure(overrides: Partial<HealthMetricsMembersChurnDeparture> = {}): HealthMetricsMembersChurnDeparture {
  return {
    accountId: 'acct-1',
    accountName: 'Acme Motors',
    membershipTier: 'Gold',
    duesLostUsd: 250_000,
    lapsedDate: '2026-03-31',
    lastEngagedDate: null,
    ...overrides,
  };
}

const CHURN: HealthMetricsMembersChurn = {
  years: [
    churnYear(2026),
    churnYear(2025, { logoChurnRate: 12.5, revenueChurnRate: 11.4 }),
    churnYear(2024, { revenueChurnRate: 8 }),
    churnYear(2023, { revenueChurnRate: 6 }),
  ],
  tiers: [tier(2026, 'Gold', 1, 2, 1_000_000, 66.7, 40), tier(2026, 'Silver', 2, 10, 500_000, 33.3, 10)],
};

const DEPARTURES: HealthMetricsMembersChurnDepartures = {
  rows: [departure(), departure({ accountId: 'acct-2', accountName: 'Vendor Corp', membershipTier: 'Silver', duesLostUsd: 50_000 })],
  totalRecords: 12,
};

describe('MembersChurnComponent', () => {
  let fixture: ComponentFixture<MembersChurnComponent>;
  let getMembersChurn: ReturnType<typeof vi.fn>;
  let getMembersChurnDepartures: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let selectedRange: ReturnType<typeof signal<string>>;
  let lifecycle: string[];

  // `departures` answers the first departures read; `followUp` (a value or a stream) every one after it.
  async function render(
    churn: HealthMetricsMembersChurn | Observable<HealthMetricsMembersChurn> = CHURN,
    departures: HealthMetricsMembersChurnDepartures = DEPARTURES,
    queryParams: Record<string, string> = {},
    followUp?: HealthMetricsMembersChurnDepartures | Observable<HealthMetricsMembersChurnDepartures>
  ): Promise<void> {
    const next = followUp ?? departures;
    getMembersChurn = vi.fn().mockReturnValue(isObservable(churn) ? churn : of(churn));
    getMembersChurnDepartures = vi
      .fn()
      .mockReturnValue(isObservable(next) ? next : of(next))
      .mockReturnValueOnce(of(departures));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersChurnComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getMembersChurn, getMembersChurnDepartures } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: HealthMetricsChromeService, useValue: { selectedRange } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersChurnComponent);
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

  function text(testId: string): string | undefined {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    selectedRange = signal<string>('YTD');
    lifecycle = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the foundation's churn and the year's departures, renders the hero, and settles once both land", async () => {
    await render();

    expect(getMembersChurn).toHaveBeenCalledWith('acme');
    expect(getMembersChurnDepartures).toHaveBeenCalledWith({ foundationSlug: 'acme', year: 2026, offset: 0, pageSize: 25 });
    expect(text('members-churn-meta')).toBe('12 of 120 memberships lost');
    expect(text('members-churn-rate')).toBe('16%');
    expect(text('members-churn-change')).toBe('+4.6pp vs 2025');
    expect(query('members-churn-change')?.classList).toContain('text-red-600');
    expect(text('members-churn-caption')).toBe("of last year's dues did not renew");
    expect(text('members-churn-side-dues-lost')).toBe('$1.5M');
    expect(query('members-churn-side-dues-lost')?.classList).toContain('text-red-600');
    expect(text('members-churn-side-logo')).toBe('10% (12 of 120)');
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });

  it('switches to logo churn without a re-read and writes the mode to the URL', async () => {
    await render();
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    fixture.componentInstance['onModeChange']('logo');
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).not.toHaveBeenCalled();
    expect(text('members-churn-rate')).toBe('10%');
    expect(text('members-churn-change')).toBe('−2.5pp vs 2025');
    expect(query('members-churn-change')?.classList).toContain('text-emerald-600');
    expect(text('members-churn-side-revenue')).toBe('16%');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { churnMode: 'logo', churnPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('ignores a mode it does not know', async () => {
    await render();
    navigate.mockClear();

    fixture.componentInstance['onModeChange']('seats');
    await settle();

    expect(text('members-churn-rate')).toBe('16%');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lists who left, claiming the churn count only when the list matches it', async () => {
    await render();

    expect(text('members-churn-departure-acct-1')).toContain('Acme Motors');
    expect(text('members-churn-departure-acct-1-dues')).toBe('$250K');
    expect(text('members-churn-departure-acct-2-dues')).toBe('$50K');
    expect(text('members-churn-departures-subtitle')).toBe('largest dues lost first · the same 12 as lost above');
    expect(query('members-churn-count-note')).toBeNull();
  });

  it('notes the difference when the list and the churn count disagree', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 11 });

    expect(text('members-churn-departures-subtitle')).toBe('largest dues lost first');
    expect(text('members-churn-count-note')).toContain('11 organizations listed, while churn counts 12 lost');
  });

  it('pages through who left and writes the page to the URL, keeping the churn read', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 });
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { churnMode: null, churnPage: 3 }, preserveFragment: true }));
  });

  it('starts on the mode and page the URL carries, and falls back for values it cannot honour', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 }, { churnMode: 'logo', churnPage: '2' });
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 25 }));
    expect(text('members-churn-rate')).toBe('10%');

    TestBed.resetTestingModule();
    await render(CHURN, DEPARTURES, { churnMode: 'toString', churnPage: 'x' });
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
    expect(text('members-churn-rate')).toBe('16%');
  });

  it('lands on the last page holding departures, settling once and rewriting the URL', async () => {
    await render(CHURN, { rows: [], totalRecords: 30 }, { churnPage: '9' }, { ...DEPARTURES, totalRecords: 30 });

    expect(getMembersChurnDepartures).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 200 }));
    expect(getMembersChurnDepartures).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 25 }));
    expect(getMembersChurnDepartures).toHaveBeenCalledTimes(2);
    expect(lifecycle.filter((event) => event === 'settled')).toHaveLength(1);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { churnMode: null, churnPage: 2 } }));
  });

  it('re-projects a new period from the same read and re-reads only its departures, from page 1', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 }, { churnPage: '2' });
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).toHaveBeenCalledWith({ foundationSlug: 'acme', year: 2025, offset: 0, pageSize: 25 });
    expect(text('members-churn-caption')).toBe("of 2024's dues did not renew");
  });

  it('shows where the loss sits by tier, flagging high rates and the count-versus-dues inversion', async () => {
    await render();

    expect(text('members-churn-tier-Gold-rate')).toBe('40%');
    expect(query('members-churn-tier-Gold-rate')?.classList).toContain('text-red-600');
    expect(query('members-churn-tier-Silver-rate')?.classList).not.toContain('text-red-600');
    expect(text('members-churn-inversion')).toContain('Silver lost 10 memberships, but Gold lost the money');
  });

  it('draws the trend ending at the selected year, red when churn rose, with a screen-reader table', async () => {
    await render();

    const rows = [...(query('members-churn-chart-table')?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim())
    );
    expect(rows).toEqual([
      ['2023', '6%'],
      ['2024', '8%'],
      ['2025', '11%'],
      ['2026', '16%'],
    ]);
    expect(fixture.componentInstance['chartData']().datasets[0].backgroundColor).toEqual([
      lfxColors.blue[200],
      lfxColors.blue[200],
      lfxColors.blue[200],
      lfxColors.red[600],
    ]);
  });

  it('separates a failed churn read from a year without churn', async () => {
    await render(throwError(() => new Error('gateway timeout')));

    expect(query('members-churn-error')).not.toBeNull();
    expect(query('members-churn-empty')).toBeNull();
    expect(text('members-churn-meta')).toBe('—');
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });

  it('shows the departures error in place of the table, without a count note', async () => {
    await render(
      CHURN,
      DEPARTURES,
      {},
      throwError(() => new Error('gateway timeout'))
    );
    fixture.componentInstance['onTablePage']({ first: 25, rows: 25 });
    await settle();

    expect(query('members-churn-departures-error')).not.toBeNull();
    expect(query('members-churn-departures-table')).toBeNull();
    expect(query('members-churn-count-note')).toBeNull();
    expect(query('members-churn-hero')).not.toBeNull();
  });

  it('shows a year the views have not measured apart from one that lost nothing', async () => {
    await render({ years: [churnYear(2025)], tiers: [] });
    expect(query('members-churn-unmeasured')).not.toBeNull();
    expect(text('members-churn-meta')).toBe('—');

    TestBed.resetTestingModule();
    await render({ years: [churnYear(2026, { lostCount: 0 })], tiers: [] }, { rows: [], totalRecords: 0 });
    expect(query('members-churn-empty')).not.toBeNull();
    expect(query('members-churn-unmeasured')).toBeNull();
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersChurn.mockReturnValue(new Subject<HealthMetricsMembersChurn>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-churn-loading')).not.toBeNull();
    expect(query('members-churn-rate')).toBeNull();
    expect(text('members-churn-meta')).toBe('—');
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-churn-loading')).not.toBeNull();
  });
});
