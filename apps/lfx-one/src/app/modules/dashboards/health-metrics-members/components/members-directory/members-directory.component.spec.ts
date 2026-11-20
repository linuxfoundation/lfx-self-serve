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
    logoUrl: 'https://logos.example/acme.png',
    membershipTier: 'Gold Membership',
    annualDuesUsd: 89500,
    engagementLevel: 'Low',
    engagementScore: 2.26,
    npsCategory: 'Detractor',
    npsScore: 4,
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
  return { rows: [member()], totalRecords: 1, scopeTotal: 1, ...overrides };
}

describe('MembersDirectoryComponent', () => {
  let fixture: ComponentFixture<MembersDirectoryComponent>;
  let getMembersDirectory: ReturnType<typeof vi.fn>;
  let getMembersDirectoryTiers: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

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

  function cell(column: string): HTMLElement | null {
    return query(`members-directory-row-${ACCOUNT_ID}-${column}`);
  }

  function tierLabels(): string[] {
    return fixture.componentInstance['tierOptions']().map((option) => option.label);
  }

  function sortBy(key: string): void {
    (query(`members-directory-sort-${key}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    getMembersDirectoryTiers = vi.fn().mockReturnValue(of({ tiers: ['Platinum Membership', 'Gold Membership'] }));
    lifecycle = [];
    verdicts = [];
  });

  it('reads the selected foundation and period in the default order, renders the page and settles', async () => {
    await render(response({ scopeTotal: 725, totalRecords: 725 }));

    expect(getMembersDirectory).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      range: 'YTD',
      tier: '',
      nps: '',
      search: '',
      offset: 0,
      pageSize: 10,
      sort: null,
    });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('draws the five columns, with Membership marked as the default order', async () => {
    await render();

    const headers = [...(query('members-directory-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Name', 'Membership', 'Renewal', 'Sponsorship', 'Engagement']);
    expect(query('members-directory-sort-membership')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
  });

  it('renders a member the way the design draws it', async () => {
    await render();

    const name = cell('name');
    expect(name?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(name?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Acme Motors');
    expect(text(`members-directory-row-${ACCOUNT_ID}-at-risk`)).toBe('At risk');
    expect(name?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Detractor · NPS 4');
    expect(name?.querySelector('[data-testid="health-metrics-cell-description"] i')?.className).toContain('text-red-400');
    expect(cell('membership')?.querySelector('[data-testid="health-metrics-cell-tier"]')).not.toBeNull();
    expect(cell('membership')?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Gold');
    expect(cell('renewal')?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Jan 11, 2027');
    expect(cell('renewal')?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('$95K dues');
    expect(text(`members-directory-row-${ACCOUNT_ID}-sponsorship`)).toBe('—');
    expect(cell('engagement')?.querySelector('[data-testid="members-engagement-badge"]')?.textContent?.trim()).toBe('Low 2.3');
  });

  it('leaves the at-risk chip and the badge off a member without them', async () => {
    await render(response({ rows: [member({ isAtRisk: false, engagementLevel: null, npsCategory: null, npsScore: null })] }));

    expect(query(`members-directory-row-${ACCOUNT_ID}-at-risk`)).toBeNull();
    expect(cell('engagement')?.querySelector('[data-testid="members-engagement-badge"]')).toBeNull();
    expect(text(`members-directory-row-${ACCOUNT_ID}-engagement`)).toBe('—');
    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('No NPS response');
  });

  it('sorts on the server from page 1, keeping the filters', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3', memNps: 'Promoter' });
    getMembersDirectory.mockClear();

    sortBy('engagement');
    await settle();

    expect(getMembersDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ nps: 'Promoter', offset: 0, sort: { key: 'engagement', direction: 'desc' } })
    );
    expect(query('members-directory-sort-engagement')?.parentElement?.getAttribute('aria-sort')).toBe('descending');

    sortBy('name');
    await settle();
    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'name', direction: 'asc' } }));
  });

  it('reverses the default on Membership, and returns to the default order a click later', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    sortBy('membership');
    await settle();
    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'membership', direction: 'asc' } }));

    sortBy('membership');
    await settle();
    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null }));
  });

  it('lists the foundation tiers once, not per page, and keeps a URL tier the read does not list', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memTier: 'Associate Membership' });

    fixture.componentInstance['page'].set(1);
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
  });

  it('re-reads from page 1 when the tier or NPS filter changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3' });
    getMembersDirectory.mockClear();

    fixture.componentInstance['tierValue'].set('Gold Membership');
    fixture.componentInstance['npsValue'].set('Promoter');
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

    fixture.componentInstance['searchText'].set('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledTimes(1);
    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: 'acme', memPage: null } }));
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getMembersDirectory.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, pageSize: 10 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: null, memPage: 3 } }));
  });

  it('starts on the filters, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memTier: 'Gold Membership', memNps: 'Passive', memSearch: 'acme', memPage: '2' });

    expect(getMembersDirectory).toHaveBeenCalledWith(expect.objectContaining({ tier: 'Gold Membership', nps: 'Passive', search: 'acme', offset: 10 }));
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

  it('re-reads the page and the tiers from page 1, back in the default order, for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { memPage: '3' });
    sortBy('name');
    await settle();
    getMembersDirectory.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getMembersDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0, sort: null }));
    expect(getMembersDirectoryTiers).toHaveBeenLastCalledWith('beta');
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { memPage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getMembersDirectory).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersDirectory).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getMembersDirectory).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { memTier: null, memNps: null, memSearch: null, memPage: 4 } }));
  });

  it('settles empty, with no body, when the foundation has no members', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('members-directory-controls')).toBeNull();
    expect(query('members-directory-table')).toBeNull();
  });

  it('keeps the controls when the cut matches nothing, and Reset filters clears the search, both selects and the page, not the sort', async () => {
    const noMatch = response({ rows: [], totalRecords: 0, scopeTotal: 40 });
    await render(response({ totalRecords: 40, scopeTotal: 40 }), { memSearch: 'zeta', memNps: 'Promoter', memTier: 'Gold Membership' }, noMatch);
    sortBy('renewal');
    await settle();

    expect(text('members-directory-no-match')).toContain('No matching members');
    expect(text('members-directory-no-match')).toContain('No member matches this search or filter. Clear the search or pick another tier.');
    expect(query('members-directory-controls')).not.toBeNull();
    // A filter miss is not an empty period, so the shell must not take the section over.
    expect(verdicts.every((empty) => !empty)).toBe(true);

    getMembersDirectory.mockClear();
    (query('members-directory-no-match')?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    await settle();

    expect(getMembersDirectory).toHaveBeenCalledTimes(1);
    expect(getMembersDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ tier: '', nps: '', search: '', offset: 0, sort: { key: 'renewal', direction: 'desc' } })
    );
  });

  // A failed read must not render copy that asserts the foundation had no members.
  it('separates a failed read from an empty one, settling it', async () => {
    await render();
    lifecycle.length = 0;
    getMembersDirectory.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['npsValue'].set('Promoter');
    await settle();

    expect(query('members-directory-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersDirectory).not.toHaveBeenCalled();
    expect(getMembersDirectoryTiers).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
  });
});
