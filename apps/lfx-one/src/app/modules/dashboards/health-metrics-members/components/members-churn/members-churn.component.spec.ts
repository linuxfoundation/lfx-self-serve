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
    revenueNotRenewedRate: 16,
    logoChurnRate: 10,
    ...overrides,
  };
}

function tier(year: number, name: string, rank: number, lost: number, dues: number, share: number, rate: number): HealthMetricsMembersChurnTier {
  return { year, tier: name, tierSortRank: rank, lostCount: lost, churnRate: rate, duesLostUsd: dues, shareOfLossPct: share };
}

function departure(overrides: Partial<HealthMetricsMembersChurnDeparture> = {}): HealthMetricsMembersChurnDeparture {
  return {
    key: 'term-1',
    accountId: 'acct-1',
    accountName: 'Acme Motors',
    logoUrl: 'https://logos.example/acme.png',
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
    churnYear(2025, { logoChurnRate: 12.5, revenueNotRenewedRate: 11.4 }),
    churnYear(2024, { revenueNotRenewedRate: 8 }),
    churnYear(2023, { revenueNotRenewedRate: 6 }),
  ],
  tiers: [tier(2026, 'Gold', 1, 2, 1_000_000, 66.7, 40), tier(2026, 'Silver', 2, 10, 500_000, 33.3, 10)],
};

const DEPARTURES: HealthMetricsMembersChurnDepartures = {
  rows: [departure(), departure({ key: 'term-2', accountId: 'acct-2', accountName: 'Vendor Corp', membershipTier: 'Silver', duesLostUsd: 50_000 })],
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
  let verdicts: boolean[];

  // `departures` answers the first departures read; `followUp` (a value or a stream) every one after it.
  async function render(
    churn: HealthMetricsMembersChurn | Observable<HealthMetricsMembersChurn> = CHURN,
    departures: HealthMetricsMembersChurnDepartures | Observable<HealthMetricsMembersChurnDepartures> = DEPARTURES,
    queryParams: Record<string, string> = {},
    followUp?: HealthMetricsMembersChurnDepartures | Observable<HealthMetricsMembersChurnDepartures>
  ): Promise<void> {
    const next = followUp ?? departures;
    getMembersChurn = vi.fn().mockReturnValue(isObservable(churn) ? churn : of(churn));
    getMembersChurnDepartures = vi
      .fn()
      .mockReturnValue(isObservable(next) ? next : of(next))
      .mockReturnValueOnce(isObservable(departures) ? departures : of(departures));
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
    verdicts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function section(id: string): void {
    (query(`members-churn-section-${id}`)?.querySelector('input') as HTMLInputElement).click();
  }

  it("reads the foundation's churn and the year's members lost, renders the metrics, and settles once both land", async () => {
    await render();

    expect(getMembersChurn).toHaveBeenCalledWith('acme');
    expect(getMembersChurnDepartures).toHaveBeenCalledWith({ foundationSlug: 'acme', year: 2026, offset: 0, pageSize: 10, sort: null });
    expect(text('members-churn-metrics-revenue-value')).toBe('16.0%');
    expect(text('members-churn-metrics-revenue-description')).toBe('+4.6pp vs 2025');
    expect(query('members-churn-metrics-revenue-description')?.querySelector('.text-red-600')?.textContent).toBe('+4.6pp');
    expect(text('members-churn-metrics-logo-description')).toBe('12 of 120 memberships');
    expect(text('members-churn-metrics-dues-label')).toContain('Dues lost this year');
    expect(lifecycle.filter((event) => event === 'settled')).toHaveLength(1);
    expect(verdicts).toEqual([false]);
  });

  it("opens on Members lost, the design's columns with Dues lost marked as the default order", async () => {
    await render();

    const headers = [...(query('members-churn-departures-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Company', 'Membership', 'Dues lost', 'Lapsed', 'Last engaged']);
    expect(query('members-churn-departures-sort-dues')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
    const name = query('members-churn-departure-term-1-name');
    expect(name?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(query('members-churn-departure-term-1-membership')?.querySelector('[data-testid="health-metrics-cell-tier"]')).not.toBeNull();
    expect(text('members-churn-departure-term-1-dues')).toBe('$250K');
    expect(text('members-churn-departure-term-1-lapsed')).toBe('Mar 31, 2026');
    expect(text('members-churn-departure-term-1-engaged')).toBe('—');
  });

  it('sorts Members lost on the server from page 1, keeping the churn read', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 }, { churnPage: '3' });
    getMembersChurn.mockClear();

    (query('members-churn-departures-sort-lapsed')?.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, sort: { key: 'lapsed', direction: 'desc' } }));
  });

  it('pages through Members lost and writes the page to the URL, keeping the churn read', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 });
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { churnView: null, churnPage: 3 }, preserveFragment: true }));
  });

  it('switches to By tier and to the trend without a re-read, writing the view to the URL', async () => {
    await render();
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    section('tiers');
    await settle();
    expect(query('members-churn-tiers-table')).not.toBeNull();
    expect(query('members-churn-departures')).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { churnView: 'tiers', churnPage: null } }));

    section('trend');
    await settle();
    expect(query('members-churn-trend')).not.toBeNull();
    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).not.toHaveBeenCalled();
  });

  it('starts on the view and page the URL carries, and falls back for values it cannot honour', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 }, { churnView: 'tiers', churnPage: '2' });
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 10 }));
    expect(query('members-churn-tiers-table')).not.toBeNull();

    TestBed.resetTestingModule();
    await render(CHURN, DEPARTURES, { churnView: 'toString', churnPage: 'x' });
    expect(getMembersChurnDepartures).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
    expect(query('members-churn-departures-table')).not.toBeNull();
  });

  it('lands on the last page holding departures, settling once and rewriting the URL', async () => {
    await render(CHURN, { rows: [], totalRecords: 30 }, { churnPage: '9' }, { ...DEPARTURES, totalRecords: 30 });

    expect(getMembersChurnDepartures).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersChurnDepartures).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 20 }));
    expect(getMembersChurnDepartures).toHaveBeenCalledTimes(2);
    expect(lifecycle.filter((event) => event === 'settled')).toHaveLength(1);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { churnView: null, churnPage: 3 } }));
  });

  it('re-projects a new period from the same read and re-reads only its members lost, from page 1', async () => {
    await render(CHURN, { ...DEPARTURES, totalRecords: 60 }, { churnPage: '2' });
    getMembersChurn.mockClear();
    getMembersChurnDepartures.mockClear();

    selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getMembersChurn).not.toHaveBeenCalled();
    expect(getMembersChurnDepartures).toHaveBeenCalledWith({ foundationSlug: 'acme', year: 2025, offset: 0, pageSize: 10, sort: null });
    expect(text('members-churn-metrics-dues-label')).toContain('Dues lost in 2025');
  });

  it("shows the loss by tier with each tier's icon, a high rate as a danger badge, and sorts in the browser", async () => {
    await render(CHURN, DEPARTURES, { churnView: 'tiers' });

    expect(query('members-churn-tier-Gold-rate')?.querySelector('lfx-ui-badge')?.textContent?.trim()).toBe('40%');
    expect(query('members-churn-tier-Silver-rate')?.querySelector('lfx-ui-badge')).toBeNull();
    expect(text('members-churn-tier-Silver-share')).toBe('33%');
    const rows = () => [...fixture.nativeElement.querySelectorAll('[data-testid^="members-churn-tier-"][data-testid$="-rate"]')].length;
    expect(rows()).toBe(2);

    (query('members-churn-tiers-sort-lost')?.querySelector('button') as HTMLButtonElement).click();
    await settle();
    const order = [...fixture.nativeElement.querySelectorAll('tr[data-testid^="members-churn-tier-"]')].map((row: Element) => row.getAttribute('data-testid'));
    expect(order).toEqual(['members-churn-tier-Silver', 'members-churn-tier-Gold']);
  });

  it('draws the trend ending at the selected year, red when churn rose, with a screen-reader table', async () => {
    await render(CHURN, DEPARTURES, { churnView: 'trend' });

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
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('shows the Members lost error in place of the table, keeping the metrics', async () => {
    await render(
      CHURN,
      DEPARTURES,
      {},
      throwError(() => new Error('gateway timeout'))
    );
    fixture.componentInstance['page'].set(1);
    await settle();

    expect(query('members-churn-departures-error')).not.toBeNull();
    expect(query('members-churn-departures-table')).toBeNull();
    expect(query('members-churn-metrics')).not.toBeNull();
  });

  it('settles empty for a year never measured, and shows a year that lost nothing at 0% with nothing to list', async () => {
    await render({ years: [churnYear(2025)], tiers: [] });
    expect(verdicts).toEqual([true]);
    expect(query('members-churn-metrics')).toBeNull();

    TestBed.resetTestingModule();
    await render(
      {
        years: [churnYear(2026, { lostCount: 0, revenueNotRenewedRate: 0, logoChurnRate: 0, duesLostUsd: 0 })],
        tiers: [tier(2026, 'Gold', 1, 0, 0, 0, 0)],
      },
      { rows: [], totalRecords: 0 }
    );
    expect(verdicts).toEqual([true, false]);
    expect(text('members-churn-metrics-revenue-value')).toBe('0%');
    expect(text('members-churn-departures-empty')).toBe('Nothing matches this view.');

    section('tiers');
    await settle();
    expect(text('members-churn-tiers-empty')).toBe('Nothing matches this view.');

    // One measured year leaves nothing to trend.
    section('trend');
    await settle();
    expect(text('members-churn-trend-empty')).toBe('Nothing matches this view.');
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersChurn.mockReturnValue(new Subject<HealthMetricsMembersChurn>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-churn-loading')).not.toBeNull();
    expect(query('members-churn-metrics')).toBeNull();
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
