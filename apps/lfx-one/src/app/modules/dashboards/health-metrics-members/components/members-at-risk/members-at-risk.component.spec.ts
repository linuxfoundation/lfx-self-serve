// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersAtRiskComponent } from './members-at-risk.component';

import type { HealthMetricsMembersAtRisk, HealthMetricsMembersAtRiskMember } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function member(overrides: Partial<HealthMetricsMembersAtRiskMember> = {}): HealthMetricsMembersAtRiskMember {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    membershipTier: 'Gold Membership',
    outstandingBalanceUsd: 20000,
    daysOverdue: 71,
    lastEngagedDate: '2026-02-03',
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersAtRisk> = {}): HealthMetricsMembersAtRisk {
  return {
    rows: [member()],
    totalRecords: 3,
    summary: { outstandingBalanceUsd: 120000, highRiskBalanceUsd: 90000, mediumRiskBalanceUsd: 30000, memberCount: 3 },
    aging: [
      { bucket: '60_89_days', memberCount: 2, balanceUsd: 30000 },
      { bucket: '90_plus_days', memberCount: 1, balanceUsd: 90000 },
    ],
    ...overrides,
  };
}

const NONE_AT_RISK = response({
  rows: [],
  totalRecords: 0,
  summary: { outstandingBalanceUsd: 0, highRiskBalanceUsd: 0, mediumRiskBalanceUsd: 0, memberCount: 0 },
  aging: [
    { bucket: '60_89_days', memberCount: 0, balanceUsd: 0 },
    { bucket: '90_plus_days', memberCount: 0, balanceUsd: 0 },
  ],
});

describe('MembersAtRiskComponent', () => {
  let fixture: ComponentFixture<MembersAtRiskComponent>;
  let getMembersAtRisk: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let notes: string[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` (a value or a stream) every read after it.
  async function render(
    payload: HealthMetricsMembersAtRisk = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersAtRisk | Observable<HealthMetricsMembersAtRisk>
  ): Promise<void> {
    const followUp = followUpPayload ?? payload;
    getMembersAtRisk = vi
      .fn()
      .mockReturnValue(isObservable(followUp) ? followUp : of(followUp))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersAtRiskComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getMembersAtRisk } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersAtRiskComponent);
    fixture.componentInstance.noteChange.subscribe((note) => notes.push(note));
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
    notes = [];
    lifecycle = [];
  });

  it('reads the selected foundation, renders the hero, aging and count, and settles with the note', async () => {
    await render();

    expect(getMembersAtRisk).toHaveBeenCalledWith({ foundationSlug: 'acme', bucket: 'all', offset: 0, pageSize: 10 });
    expect(text('members-at-risk-outstanding')).toBe('$120K');
    expect(text('members-at-risk-high')).toBe('$90K');
    expect(text('members-at-risk-medium')).toBe('$30K');
    expect(text('members-at-risk-members')).toBe('3');
    expect(text('members-at-risk-count')).toBe('3 members');
    expect(text('members-at-risk-aging-60_89_days')).toContain('60–89 days · 2 members');
    expect(text('members-at-risk-aging-90_plus_days-value')).toBe('$90K');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(notes).toEqual(['', '3 overdue · $120K']);
  });

  it('renders an at-risk row the way the design draws it', async () => {
    await render();

    expect(text(`members-at-risk-row-${ACCOUNT_ID}-name`)).toBe('Acme Motors');
    expect(text(`members-at-risk-row-${ACCOUNT_ID}-tier`)).toBe('Gold Membership');
    expect(text(`members-at-risk-row-${ACCOUNT_ID}-overdue`)).toBe('$20K');
    expect(text(`members-at-risk-row-${ACCOUNT_ID}-age`)).toBe('71 days');
    expect(query(`members-at-risk-row-${ACCOUNT_ID}-age`)?.classList).toContain('text-red-600');
    expect(query(`members-at-risk-row-${ACCOUNT_ID}-last-engaged`)?.classList).toContain('text-amber-700');
  });

  it('re-reads one bucket from page 1, keeping the note, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 30 }), { riskPage: '2' });
    getMembersAtRisk.mockClear();
    notes.length = 0;

    fixture.componentInstance['onBucketChange']('90_plus_days');
    await settle();

    expect(getMembersAtRisk).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: '90_plus_days', offset: 0 }));
    expect(notes.every((note) => note === '3 overdue · $120K')).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { riskBucket: '90_plus_days', riskPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('ignores a pill id it does not know', async () => {
    await render();

    fixture.componentInstance['onBucketChange']('under_60_days');
    await settle();

    expect(getMembersAtRisk).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'all' }));
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 30 }));
    getMembersAtRisk.mockClear();

    fixture.componentInstance['onTablePage']({ first: 20, rows: 10 });
    await settle();

    expect(getMembersAtRisk).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { riskBucket: null, riskPage: 3 } }));
  });

  it('starts on the bucket and page the URL carries, and falls back for values it cannot honour', async () => {
    await render(response({ totalRecords: 30 }), { riskBucket: '60_89_days', riskPage: '2' });
    expect(getMembersAtRisk).toHaveBeenCalledWith(expect.objectContaining({ bucket: '60_89_days', offset: 10 }));

    TestBed.resetTestingModule();
    await render(response(), { riskBucket: 'under_60_days', riskPage: '-2' });
    expect(getMembersAtRisk).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'all', offset: 0 }));
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 12 }), { riskPage: '9' }, response({ totalRecords: 12 }));

    expect(getMembersAtRisk).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersAtRisk).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 10 }));
    expect(getMembersAtRisk).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { riskBucket: null, riskPage: 2 } }));
  });

  it('re-reads from page 1 and blanks the note for a newly selected foundation', async () => {
    await render(response({ totalRecords: 30 }), { riskPage: '3' });
    getMembersAtRisk.mockClear();
    notes.length = 0;

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getMembersAtRisk).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
    expect(notes).toEqual(['', '3 overdue · $120K']);
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersAtRisk.mockReturnValue(new Subject<HealthMetricsMembersAtRisk>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-at-risk-loading')).not.toBeNull();
    expect(query('members-at-risk-outstanding')).toBeNull();
  });

  it('moves a URL page back to page 1 when the bucket it names holds no one', async () => {
    const empty = response({ rows: [], totalRecords: 0 });
    await render(empty, { riskBucket: '60_89_days', riskPage: '3' }, empty);

    expect(getMembersAtRisk).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 20 }));
    expect(getMembersAtRisk).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 0 }));
    expect(getMembersAtRisk).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { riskBucket: '60_89_days', riskPage: null } }));
  });

  it('holds the skeleton, not a $0 hero, while a URL page past an empty foundation moves back', async () => {
    await render(NONE_AT_RISK, { riskPage: '3' }, new Subject<HealthMetricsMembersAtRisk>());

    expect(getMembersAtRisk).toHaveBeenCalledTimes(2);
    expect(query('members-at-risk-loading')).not.toBeNull();
    expect(query('members-at-risk-outstanding')).toBeNull();
  });

  it('shows the empty state and no note when no member is at risk', async () => {
    await render(NONE_AT_RISK);

    expect(query('members-at-risk-empty')).not.toBeNull();
    expect(query('members-at-risk-table')).toBeNull();
    expect(notes.at(-1)).toBe('');
  });

  it('shows the rows with a dashed hero, not the empty state, when the model leaves the totals unset', async () => {
    await render(
      response({
        summary: { outstandingBalanceUsd: null, highRiskBalanceUsd: null, mediumRiskBalanceUsd: null, memberCount: null },
        aging: [
          { bucket: '60_89_days', memberCount: null, balanceUsd: null },
          { bucket: '90_plus_days', memberCount: null, balanceUsd: null },
        ],
      })
    );

    expect(query('members-at-risk-empty')).toBeNull();
    expect(query(`members-at-risk-row-${ACCOUNT_ID}`)).not.toBeNull();
    expect(text('members-at-risk-outstanding')).toBe('—');
    expect(text('members-at-risk-members')).toBe('—');
    expect(notes.at(-1)).toBe('');
  });

  it('keeps the hero and says so when the picked bucket holds no one', async () => {
    await render(response(), {}, response({ rows: [], totalRecords: 0 }));

    fixture.componentInstance['onBucketChange']('60_89_days');
    await settle();

    expect(text('members-at-risk-outstanding')).toBe('$120K');
    expect(text('members-at-risk-no-match')).toBe('No member is in this aging bucket.');
  });

  // A failed read must not render copy that asserts no member is at risk.
  it('separates a failed read from an empty one, settling it without a note', async () => {
    await render();
    notes.length = 0;
    lifecycle.length = 0;
    getMembersAtRisk.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onBucketChange']('90_plus_days');
    await settle();

    expect(query('members-at-risk-error')).not.toBeNull();
    expect(query('members-at-risk-empty')).toBeNull();
    expect(notes).toEqual(['']);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersAtRisk).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-at-risk-loading')).not.toBeNull();
    expect(query('members-at-risk-empty')).toBeNull();
  });
});
