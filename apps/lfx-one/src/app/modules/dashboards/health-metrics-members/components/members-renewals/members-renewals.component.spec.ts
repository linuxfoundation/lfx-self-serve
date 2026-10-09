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
    membershipTier: 'Gold Membership',
    renewalDate: '2026-11-18',
    duesUsd: 20000,
    hasOutstandingBalance: false,
    daysUntilRenewal: 40,
    hasRenewed: false,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersRenewals> = {}): HealthMetricsMembersRenewals {
  return {
    rows: [renewal()],
    totalRecords: 3,
    summary: { renewalCount: 3, valueUsd: 185000, withoutDuesCount: 0 },
    ...overrides,
  };
}

const NONE_DUE = response({ rows: [], totalRecords: 0, summary: { renewalCount: 0, valueUsd: 0, withoutDuesCount: 0 } });

describe('MembersRenewalsComponent', () => {
  let fixture: ComponentFixture<MembersRenewalsComponent>;
  let getMembersRenewals: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
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
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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
    counts = [];
    lifecycle = [];
  });

  it('reads the selected foundation, renders the hero and count, and settles with the count', async () => {
    await render();

    expect(getMembersRenewals).toHaveBeenCalledWith({ foundationSlug: 'acme', window: '90_days', offset: 0, pageSize: 10 });
    expect(text('members-renewals-window')).toBe('Next 90 days Next 180 days This year');
    expect(text('members-renewals-value')).toBe('$185K');
    expect(text('members-renewals-due')).toBe('3');
    expect(text('members-renewals-count')).toBe('3 renewals');
    expect(query('members-renewals-coverage')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts).toEqual([null, 3]);
  });

  it('renders a renewal row the way the design draws it, without a status column', async () => {
    await render();

    expect(text(`members-renewals-row-${ACCOUNT_ID}-name`)).toBe('Acme Motors');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-tier`)).toBe('Gold Membership');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-date`)).toBe('Nov 18, 2026');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-days`)).toBe('In 40 days');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-dues`)).toBe('$20K');
    expect(query(`members-renewals-row-${ACCOUNT_ID}-balance`)).toBeNull();
    expect(query(`members-renewals-row-${ACCOUNT_ID}-renewed`)).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('th')).toHaveLength(5);
  });

  it('marks a renewed membership and drops its countdown', async () => {
    await render(response({ rows: [renewal({ hasRenewed: true, daysUntilRenewal: 12 })] }));

    const marker = query(`members-renewals-row-${ACCOUNT_ID}-renewed`);
    expect(marker?.textContent?.trim()).toBe('Renewed');
    expect(marker?.classList).toContain('text-emerald-700');
    expect(marker?.querySelector('i')?.classList).toContain('fa-circle-check');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-days`)).toBe('—');
  });

  it('marks a renewing member that carries an outstanding balance', async () => {
    await render(response({ rows: [renewal({ hasOutstandingBalance: true })] }));

    const marker = query(`members-renewals-row-${ACCOUNT_ID}-balance`);
    expect(marker?.textContent?.trim()).toBe('Balance outstanding');
    expect(marker?.classList).toContain('text-red-600');
    expect(marker?.querySelector('i')?.classList).toContain('fa-circle-exclamation');
  });

  it('says the value counts only known dues when some renewals have none on record', async () => {
    await render(response({ rows: [renewal({ duesUsd: null })], summary: { renewalCount: 3, valueUsd: 40000, withoutDuesCount: 1 } }));

    expect(text('members-renewals-value')).toBe('$40K');
    expect(text('members-renewals-coverage')).toBe('1 renewal without dues on record, so the value counts only the known dues.');
    expect(text(`members-renewals-row-${ACCOUNT_ID}-dues`)).toBe('—');
  });

  it('pages through the table, keeping the count, and writes the page to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 30, summary: { renewalCount: 30, valueUsd: 600000, withoutDuesCount: 0 } }));
    getMembersRenewals.mockClear();
    counts.length = 0;

    fixture.componentInstance['onTablePage']({ first: 20, rows: 10 });
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(counts.every((count) => count === 30)).toBe(true);
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

    fixture.nativeElement.querySelector('[data-testid="filter-pill-180_days"]').click();
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ window: '180_days', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { renewalsWindow: '180_days', renewalsPage: null } }));
  });

  it("holds a skeleton under the pills, not the old window's figures, while a newly picked window reads", async () => {
    await render();
    getMembersRenewals.mockReturnValue(new Subject<HealthMetricsMembersRenewals>());

    fixture.nativeElement.querySelector('[data-testid="filter-pill-180_days"]').click();
    await settle();

    expect(query('members-renewals-window')).not.toBeNull();
    expect(query('members-renewals-loading')).not.toBeNull();
    expect(query('members-renewals-value')).toBeNull();
    expect(text('members-renewals-count')).toBe('—');
  });

  it('keeps the pills on a failed window read, so another window can still be picked', async () => {
    await render();
    getMembersRenewals.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.nativeElement.querySelector('[data-testid="filter-pill-180_days"]').click();
    await settle();

    expect(query('members-renewals-error')).not.toBeNull();
    expect(query('members-renewals-window')).not.toBeNull();
    expect(text('members-renewals-count')).toBe('—');

    getMembersRenewals.mockReturnValue(of(response()));
    fixture.nativeElement.querySelector('[data-testid="filter-pill-this_year"]').click();
    await settle();

    expect(getMembersRenewals).toHaveBeenLastCalledWith(expect.objectContaining({ window: 'this_year' }));
    expect(query('members-renewals-error')).toBeNull();
    expect(text('members-renewals-value')).toBe('$185K');
  });

  it('starts on the window the URL carries, and falls back for one it does not know', async () => {
    await render(response(), { renewalsWindow: 'this_year' });
    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ window: 'this_year' }));

    TestBed.resetTestingModule();
    await render(response(), { renewalsWindow: '30_days' });
    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ window: '90_days' }));
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

  it('re-reads from page 1 and blanks the count for a newly selected foundation', async () => {
    await render(response({ totalRecords: 30 }), { renewalsPage: '3' });
    getMembersRenewals.mockClear();
    counts.length = 0;

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getMembersRenewals).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
    expect(counts).toEqual([null, 3]);
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersRenewals.mockReturnValue(new Subject<HealthMetricsMembersRenewals>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-renewals-loading')).not.toBeNull();
    expect(query('members-renewals-value')).toBeNull();
  });

  it('shows the empty state with a measured zero count when nothing is due', async () => {
    await render(NONE_DUE);

    expect(text('members-renewals-empty')).toContain('No renewals in the next 90 days');
    expect(query('members-renewals-table')).toBeNull();
    // The window pills stay, so an empty window is not a dead end.
    expect(query('members-renewals-window')).not.toBeNull();
    expect(text('members-renewals-count')).toBe('0 renewals');
    expect(counts.at(-1)).toBe(0);
  });

  it('shows the rows with a dashed hero, not the empty state, when the model leaves the totals unset', async () => {
    await render(response({ summary: { renewalCount: null, valueUsd: null, withoutDuesCount: null } }));

    expect(query('members-renewals-empty')).toBeNull();
    expect(query(`members-renewals-row-${ACCOUNT_ID}`)).not.toBeNull();
    expect(text('members-renewals-value')).toBe('—');
    expect(text('members-renewals-due')).toBe('—');
    expect(counts.at(-1)).toBeNull();
  });

  it('shows the matched rows, not the empty state, when the model count reads zero', async () => {
    await render(response({ summary: { renewalCount: 0, valueUsd: 0, withoutDuesCount: 0 } }));

    expect(query('members-renewals-empty')).toBeNull();
    expect(query(`members-renewals-row-${ACCOUNT_ID}`)).not.toBeNull();
  });

  // A failed read must not render copy that asserts nothing is due.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render(response({ totalRecords: 30 }));
    counts.length = 0;
    lifecycle.length = 0;
    getMembersRenewals.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    await settle();

    expect(query('members-renewals-error')).not.toBeNull();
    expect(query('members-renewals-empty')).toBeNull();
    expect(counts).toEqual([null]);
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
