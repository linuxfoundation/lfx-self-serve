// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersRenewalsComponent } from './members-renewals.component';

import type { HealthMetricsMembersRenewal, HealthMetricsMembersRenewals } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function renewal(overrides: Partial<HealthMetricsMembersRenewal> = {}): HealthMetricsMembersRenewal {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    logoUrl: 'https://logos.example/acme.png',
    membershipTier: 'Gold Membership',
    renewalDate: '2026-11-18',
    duesUsd: 20000,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersRenewals> = {}): HealthMetricsMembersRenewals {
  return {
    rows: [renewal()],
    totalRecords: 3,
    summary: { renewalCount: 3, valueUsd: 185000 },
    ...overrides,
  };
}

const NONE_DUE = response({ rows: [], totalRecords: 0, summary: { renewalCount: 0, valueUsd: 0 } });

describe('MembersRenewalsComponent', () => {
  let fixture: ComponentFixture<MembersRenewalsComponent>;
  let getMembersRenewals: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` (a value or a stream) every read after it.
  async function render(
    payload: HealthMetricsMembersRenewals = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersRenewals | Observable<HealthMetricsMembersRenewals>
  ): Promise<void> {
    const followUp = followUpPayload ?? payload;
    getMembersRenewals = vi
      .fn()
      .mockReturnValue(isObservable(followUp) ? followUp : of(followUp))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersRenewalsComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getMembersRenewals } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersRenewalsComponent);
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
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
  });

  it('reads the selected foundation in the default order, renders the metrics, and settles', async () => {
    await render();

    expect(getMembersRenewals).toHaveBeenCalledWith({ foundationSlug: 'acme', window: '90_days', offset: 0, pageSize: 10, sort: null });
    expect(text('members-renewals-metrics-value-label')).toContain('Value up for renewal');
    expect(text('members-renewals-metrics-value-value')).toBe('$185K');
    expect(text('members-renewals-metrics-due-value')).toBe('3');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('renders a renewal row the way the design draws it, with Dues marked as the default order', async () => {
    await render();

    const cell = (column: string) => query(`members-renewals-row-${ACCOUNT_ID}-${column}`);
    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Acme Motors');
    expect(cell('membership')?.querySelector('[data-testid="health-metrics-cell-tier"]')).not.toBeNull();
    expect(cell('membership')?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Gold');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-date`)).toBe('Nov 18, 2026');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-dues`)).toBe('$20K');
    expect([...fixture.nativeElement.querySelectorAll('th')].map((th: HTMLElement) => th.textContent?.trim())).toEqual([
      'Company',
      'Membership',
      'Renewal date',
      'Dues',
    ]);
    expect(query('members-renewals-sort-dues')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts on the server from page 1, and keeps the sort when the window changes', async () => {
    await render(response({ totalRecords: 30 }), { renewalsPage: '2' });

    (query('members-renewals-sort-date')?.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(getMembersRenewals).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, sort: { key: 'date', direction: 'desc' } }));

    fixture.componentInstance.window.set('this_year');
    await settle();
    expect(getMembersRenewals).toHaveBeenLastCalledWith(expect.objectContaining({ window: 'this_year', sort: { key: 'date', direction: 'desc' } }));
  });

  it('pages through the table and writes the page to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 30, summary: { renewalCount: 30, valueUsd: 600000 } }));
    getMembersRenewals.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { renewalsWindow: null, renewalsPage: 3 }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('starts on the page the URL carries, and falls back for a value it cannot honour', async () => {
    await render(response({ totalRecords: 30 }), { renewalsPage: '2' });
    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ offset: 10 }));

    TestBed.resetTestingModule();
    await render(response(), { renewalsPage: 'x' });
    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('re-reads a newly picked window from page 1 and writes it to the URL', async () => {
    await render(response({ totalRecords: 30 }), { renewalsPage: '3' });
    getMembersRenewals.mockClear();

    fixture.componentInstance.window.set('180_days');
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ window: '180_days', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { renewalsWindow: '180_days', renewalsPage: null } }));
  });

  it("holds a skeleton, not the old window's figures, while a newly picked window reads", async () => {
    await render();
    getMembersRenewals.mockReturnValue(new Subject<HealthMetricsMembersRenewals>());

    fixture.componentInstance.window.set('180_days');
    await settle();

    expect(query('members-renewals-loading')).not.toBeNull();
    expect(query('members-renewals-metrics')).toBeNull();
  });

  it('shows the error for a failed window read, and the next window reads again', async () => {
    await render();
    getMembersRenewals.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance.window.set('180_days');
    await settle();
    expect(query('members-renewals-error')).not.toBeNull();

    getMembersRenewals.mockReturnValue(of(response()));
    fixture.componentInstance.window.set('this_year');
    await settle();

    expect(getMembersRenewals).toHaveBeenLastCalledWith(expect.objectContaining({ window: 'this_year' }));
    expect(query('members-renewals-error')).toBeNull();
    expect(text('members-renewals-metrics-value-value')).toBe('$185K');
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 12 }), { renewalsPage: '9' }, response({ totalRecords: 12 }));

    expect(getMembersRenewals).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersRenewals).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 10 }));
    expect(getMembersRenewals).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { renewalsWindow: null, renewalsPage: 2 } }));
  });

  it('re-reads from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 30 }), { renewalsPage: '3' });
    getMembersRenewals.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersRenewals.mockReturnValue(new Subject<HealthMetricsMembersRenewals>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-renewals-loading')).not.toBeNull();
    expect(query('members-renewals-metrics')).toBeNull();
  });

  it("keeps the card's empty state, naming the window, when nothing is due", async () => {
    await render(NONE_DUE);

    expect(text('members-renewals-empty')).toContain('No renewals in the next 90 days');
    expect(query('members-renewals-table')).toBeNull();

    fixture.componentInstance.window.set('this_year');
    await settle();
    expect(text('members-renewals-empty')).toContain('No renewals this year');
  });

  it('shows the rows with dashed metrics, not the empty state, when the model leaves the totals unset', async () => {
    await render(response({ summary: { renewalCount: null, valueUsd: null } }));

    expect(query('members-renewals-empty')).toBeNull();
    expect(query(`members-renewals-row-${ACCOUNT_ID}`)).not.toBeNull();
    expect(text('members-renewals-metrics-value-value')).toBe('—');
    expect(text('members-renewals-metrics-due-value')).toBe('—');
  });

  it('shows the matched rows, not the empty state, when the model count reads zero', async () => {
    await render(response({ summary: { renewalCount: 0, valueUsd: 0 } }));

    expect(query('members-renewals-empty')).toBeNull();
    expect(query(`members-renewals-row-${ACCOUNT_ID}`)).not.toBeNull();
  });

  // A failed read must not render copy that asserts nothing is due.
  it('separates a failed read from an empty one, settling it', async () => {
    await render(response({ totalRecords: 30 }));
    lifecycle.length = 0;
    getMembersRenewals.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['page'].set(1);
    await settle();

    expect(query('members-renewals-error')).not.toBeNull();
    expect(query('members-renewals-empty')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersRenewals).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-renewals-loading')).not.toBeNull();
    expect(query('members-renewals-empty')).toBeNull();
  });
});
