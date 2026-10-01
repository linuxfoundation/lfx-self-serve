// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { MembersDirectoryComponent } from './members-directory.component';

import type { HealthMetricsMembersDirectory, HealthMetricsMembersDirectoryMember } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function member(overrides: Partial<HealthMetricsMembersDirectoryMember> = {}): HealthMetricsMembersDirectoryMember {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    membershipTier: 'Gold Membership',
    annualDuesUsd: 89500,
    engagementLevel: 'Low',
    engagementScore: 2.26,
    npsCategory: 'Detractor',
    isAtRisk: true,
    renewalDate: '2027-01-11',
    renewalDuesUsd: 95000,
    lastEngagedDate: '2026-02-03',
    contributionCount: 12,
    sponsorshipUsd: null,
    trainingEnrollmentCount: 0,
    eventRegistrationCount: 3,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersDirectory> = {}): HealthMetricsMembersDirectory {
  return { rows: [member()], totalRecords: 1, scopeTotal: 1, atRiskCount: 1, ...overrides };
}

describe('MembersDirectoryComponent', () => {
  let fixture: ComponentFixture<MembersDirectoryComponent>;
  let getMembersDirectory: ReturnType<typeof vi.fn>;
  let getMembersDirectoryTiers: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsMembersDirectory = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersDirectory
  ): Promise<void> {
    getMembersDirectory = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersDirectoryComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getMembersDirectory, getMembersDirectoryTiers } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersDirectoryComponent);
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

  function tierLabels(): string[] {
    return fixture.componentInstance['tierOptions']().map((option) => option.label);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    getMembersDirectoryTiers = vi.fn().mockReturnValue(of({ tiers: ['Platinum Membership', 'Gold Membership'] }));
    counts = [];
    lifecycle = [];
  });

  it('reads the selected foundation and period, renders the page and summary, and settles', async () => {
    await render(response({ scopeTotal: 725, atRiskCount: 27 }));

    expect(getMembersDirectory).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', tier: '', nps: '', search: '', offset: 0, pageSize: 10 });
    expect(text(`members-directory-row-${ACCOUNT_ID}-name`)).toBe('Acme Motors');
    expect(text('members-directory-count')).toBe('725 members · 27 at risk · highest dues first');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts).toEqual([null, 725]);
  });

  it('renders a member row the way the design draws it', async () => {
    await render();
    const cell = (key: string) => text(`members-directory-row-${ACCOUNT_ID}-${key}`);

    expect(cell('nps')).toBe('Detractor');
    expect(cell('at-risk')).toBe('At risk');
    expect(cell('tier')).toBe('Gold Membership');
    expect(cell('dues')).toBe('$89.5K');
    expect(cell('engagement')).toBe('Low');
    expect(cell('score')).toBe('2.3');
    expect(cell('renews')).toBe('Jan 11, 2027');
    expect(cell('renewal-dues')).toBe('$95K');
    expect(cell('contribution')).toBe('12');
    expect(cell('training')).toBe('0');
    expect(cell('events')).toBe('3');
    expect(query(`members-directory-row-${ACCOUNT_ID}-last-engaged`)?.classList).toContain('text-amber-700');
  });

  it('renders an untracked activity count as a dash with the not-tracked hint, never 0', async () => {
    await render();
    const sponsorship = query(`members-directory-row-${ACCOUNT_ID}-sponsorship`);

    expect(sponsorship?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('—');
    expect(sponsorship?.querySelector('.sr-only')?.textContent?.trim()).toBe('Not tracked yet for this foundation');
    expect(sponsorship?.getAttribute('title')).toBe('Not tracked yet for this foundation');
    expect(query(`members-directory-row-${ACCOUNT_ID}-training`)?.getAttribute('title')).toBeNull();
  });

  it('leaves the badges off a member who is neither rated nor at risk', async () => {
    await render(response({ rows: [member({ npsCategory: null, isAtRisk: false })] }));

    expect(query(`members-directory-row-${ACCOUNT_ID}-nps`)).toBeNull();
    expect(query(`members-directory-row-${ACCOUNT_ID}-at-risk`)).toBeNull();
    expect(query(`members-directory-row-${ACCOUNT_ID}-last-engaged`)?.classList).not.toContain('text-amber-700');
  });

  it('lists the foundation tiers once, not per page, and keeps a URL tier the read does not list', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memTier: 'Associate Membership' });

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    await settle();

    expect(getMembersDirectoryTiers).toHaveBeenCalledTimes(1);
    expect(getMembersDirectoryTiers).toHaveBeenCalledWith('acme');
    expect(tierLabels()).toEqual(['All tiers', 'Platinum Membership', 'Gold Membership', 'Associate Membership']);
  });

  it('shows an unselectable "Tier list unavailable" notice when the tier read fails, and still reads the page', async () => {
    getMembersDirectoryTiers.mockReturnValue(throwError(() => new Error('gateway timeout')));
    await render(undefined, { memTier: 'Gold Membership' });

    expect(tierLabels()).toEqual(['All tiers', 'Tier list unavailable', 'Gold Membership']);
    expect(fixture.componentInstance['tierOptions']()[1].disabled).toBe(true);
    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ tier: 'Gold Membership' }));
    expect(query(`members-directory-row-${ACCOUNT_ID}`)).not.toBeNull();
  });

  it('shows no notice for a foundation whose tier read returns no tiers', async () => {
    getMembersDirectoryTiers.mockReturnValue(of({ tiers: [] }));
    await render();

    expect(tierLabels()).toEqual(['All tiers']);
  });

  it('re-reads from page 1 when the tier or NPS filter changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3' });
    getMembersDirectory.mockClear();

    fixture.componentInstance['filterForm'].controls.tier.setValue('Gold Membership');
    fixture.componentInstance['filterForm'].controls.nps.setValue('Promoter');
    await settle();

    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ tier: 'Gold Membership', nps: 'Promoter', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { memTier: 'Gold Membership', memNps: 'Promoter', memSearch: null, memPage: null },
        preserveFragment: true,
        replaceUrl: true,
      })
    );
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '2' });
    getMembersDirectory.mockClear();

    fixture.componentInstance['filterForm'].controls.search.setValue('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledTimes(1);
    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: 'acme', memPage: null } }));
  });

  it('shows the filtered count with a clear link that resets every filter', async () => {
    await render(response({ totalRecords: 16, scopeTotal: 725 }), { memNps: 'Detractor' });

    expect(text('members-directory-count')).toBe('16 of 725 members match · clear');

    getMembersDirectory.mockClear();
    query('members-directory-clear')?.click();
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledTimes(1);
    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ tier: '', nps: '', search: '' }));
  });

  it('clears a search in the same read as the other filters, not a debounce later', async () => {
    await render(response({ totalRecords: 3, scopeTotal: 725 }), { memTier: 'Gold Membership', memSearch: 'acme' });
    getMembersDirectory.mockClear();

    query('members-directory-clear')?.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledTimes(1);
    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ tier: '', nps: '', search: '' }));
  });

  it('keeps the sub-nav count through page turns and filters, blanking it only for a new period', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    counts.length = 0;

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    fixture.componentInstance['filterForm'].controls.nps.setValue('Promoter');
    await settle();
    expect(counts.every((count) => count === 80)).toBe(true);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();
    expect(counts.at(-2)).toBeNull();
    expect(counts.at(-1)).toBe(80);
  });

  it('offers a count-free search placeholder until the first read lands', async () => {
    selectedFoundation.set(null);
    await render();
    const search = () => (fixture.nativeElement.querySelector('#members-directory-search') as HTMLInputElement).placeholder;

    expect(search()).toBe('Search members…');

    selectedFoundation.set({ slug: 'acme' });
    await settle();
    expect(search()).toBe('Search 1 member…');
  });

  it('pages through the table, including a new page size, and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getMembersDirectory.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, pageSize: 25 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: null, memPage: 3 } }));
  });

  it('starts on the filters, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memTier: 'Gold Membership', memNps: 'Passive', memSearch: 'acme', memPage: '2' });

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ tier: 'Gold Membership', nps: 'Passive', search: 'acme', offset: 10 }));
    expect((fixture.nativeElement.querySelector('#members-directory-search') as HTMLInputElement).value).toBe('acme');
  });

  it('falls back to the defaults for URL values it cannot honour', async () => {
    await render(response(), { memNps: 'Neutral', memTier: 'x'.repeat(201), memPage: '-2' });

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ tier: '', nps: '', offset: 0 }));
  });

  it('re-reads from page 1 when the period changes', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3' });
    getMembersDirectory.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
  });

  it('re-reads the page and the tiers from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3' });
    getMembersDirectory.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
    expect(getMembersDirectoryTiers).toHaveBeenLastCalledWith('beta');
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { memPage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getMembersDirectory).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersDirectory).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getMembersDirectory).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(counts).toEqual([null, 34]);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: null, memPage: 4 } }));
  });

  it('shows the empty state when the foundation has no members', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0, atRiskCount: 0 }));

    expect(query('members-directory-empty')).not.toBeNull();
    expect(query('members-directory-table')).toBeNull();
  });

  it('keeps the controls and names the search when it matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { memSearch: 'zeta' });

    expect(text('members-directory-no-match')).toBe('No member matches “zeta”.');
    expect(query('members-directory-controls')).not.toBeNull();
  });

  it('says the filters match nothing when no search is set', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { memNps: 'Promoter' });

    expect(text('members-directory-no-match')).toBe('No member matches these filters.');
  });

  // A failed read must not render copy that asserts the foundation had no members.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render();
    counts.length = 0;
    lifecycle.length = 0;
    getMembersDirectory.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['filterForm'].controls.nps.setValue('Promoter');
    await settle();

    expect(query('members-directory-error')).not.toBeNull();
    expect(query('members-directory-empty')).toBeNull();
    expect(counts).toEqual([null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersDirectory).not.toHaveBeenCalled();
    expect(getMembersDirectoryTiers).not.toHaveBeenCalled();
    expect(counts.every((count) => count === null)).toBe(true);
    expect(lifecycle).not.toContain('settled');
    expect(text('members-directory-count')).toBe('—');
    expect(query('members-directory-empty')).toBeNull();
  });
});
