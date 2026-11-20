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

import { NonMembersOrgsComponent } from './non-members-orgs.component';

import type { HealthMetricsNonMembersOrg, HealthMetricsNonMembersOrgs, HealthMetricsNonMembersOrgsFilter } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function org(overrides: Partial<HealthMetricsNonMembersOrg> = {}): HealthMetricsNonMembersOrg {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    logoUrl: 'https://logos.example/acme.png',
    lastEngagedDate: '2026-03-14',
    meetingsAttended: 42,
    distinctPeople: 9,
    contributions: 1840,
    fitBand: 'High',
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsNonMembersOrgs> = {}): HealthMetricsNonMembersOrgs {
  return { rows: [org()], totalRecords: 1, scopeTotal: 1, ...overrides };
}

describe('NonMembersOrgsComponent', () => {
  let fixture: ComponentFixture<NonMembersOrgsComponent>;
  let getNonMembersOrgs: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsNonMembersOrgs = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsNonMembersOrgs,
    initialFilter?: HealthMetricsNonMembersOrgsFilter
  ): Promise<void> {
    getNonMembersOrgs = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [NonMembersOrgsComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getNonMembersOrgs } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NonMembersOrgsComponent);
    // The page binds the cut it read from the URL before the section's first read.
    if (initialFilter) fixture.componentRef.setInput('filter', initialFilter);
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
    return query(`non-members-orgs-row-${ACCOUNT_ID}-${column}`);
  }

  function cellText(column: string): string | undefined {
    return cell(column)?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim();
  }

  function cellDescription(column: string): string | undefined {
    return cell(column)?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim();
  }

  function sortBy(key: string): void {
    (query(`non-members-orgs-sort-${key}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the selected foundation and period in the default order, renders the page and settles', async () => {
    await render(response({ scopeTotal: 412, totalRecords: 412 }));

    expect(getNonMembersOrgs).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      range: 'YTD',
      filter: 'all',
      search: '',
      offset: 0,
      pageSize: 10,
      sort: null,
    });
    expect(cellText('name')).toBe('Acme Motors');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('draws the four columns, Meetings attended marked as the default order and Contributions with its tip', async () => {
    await render();

    const headers = [...(query('non-members-orgs-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.replace(/\s+/g, ' ').trim());
    expect(headers).toEqual(['Company', 'Meetings attended', 'Contributions', 'Fit']);
    expect(query('non-members-orgs-sort-meetings')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
    expect(fixture.componentInstance['contributionsTip']).toBe(
      "Code contributions (commits and pull requests) this company made to the foundation's projects in the selected period."
    );
  });

  it('renders a company the way the design draws it', async () => {
    await render();

    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(cellDescription('name')).toBe('Last engaged Mar 14, 2026');
    expect(cellText('meetings')).toBe('42');
    expect(cellDescription('meetings')).toBe('9 people');
    expect(cellText('contributions')).toBe('1,840');
    const badge = cell('fit')?.querySelector('span');
    expect(badge?.textContent?.trim()).toBe('High');
    expect(badge?.className).toContain('bg-emerald-50');
    expect(badge?.className).toContain('text-emerald-700');
    expect(badge?.className).toContain('h-[24px]');
  });

  it('dashes a company with no meetings, contributions or score, with no people or date line', async () => {
    await render(response({ rows: [org({ meetingsAttended: 0, contributions: null, fitBand: null, lastEngagedDate: null })] }));

    expect(cellText('meetings')).toBe('—');
    expect(cellDescription('meetings')).toBeUndefined();
    expect(cellText('contributions')).toBe('—');
    expect(cellDescription('name')).toBeUndefined();
    expect(text(`non-members-orgs-row-${ACCOUNT_ID}-fit`)).toBe('—');
    expect(cell('fit')?.querySelector('[data-testid="health-metrics-cell-text"]')?.classList).toContain('text-gray-400');
  });

  it('searches company names from a box that fills the row, with no count line, footnote or rows-per-page choice', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    const search = query('non-members-orgs-search');
    expect(search?.classList).toContain('w-full');
    expect(search?.querySelector('input')?.placeholder).toBe('Search company…');
    expect(search?.querySelector('input')?.maxLength).toBe(100);
    expect(query('non-members-orgs-count')).toBeNull();
    expect(query('non-members-orgs-provisional')).toBeNull();
    expect(query('non-members-orgs-low-confidence')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-ui-pagination')).not.toBeNull();
  });

  it('sorts on the server from page 1, keeping the cut', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '3' });
    fixture.componentRef.setInput('filter', 'meetings');
    await settle();
    getNonMembersOrgs.mockClear();

    sortBy('fit');
    await settle();

    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'meetings', offset: 0, sort: { key: 'fit', direction: 'desc' } }));
    expect(query('non-members-orgs-sort-fit')?.parentElement?.getAttribute('aria-sort')).toBe('descending');

    sortBy('company');
    await settle();
    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'company', direction: 'asc' } }));
  });

  it('reverses the default on Meetings attended, and returns to the default order a click later', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    sortBy('meetings');
    await settle();
    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'meetings', direction: 'asc' } }));

    sortBy('meetings');
    await settle();
    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null }));
  });

  it('re-reads from page 1 when the header switch changes the cut, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '3' });
    getNonMembersOrgs.mockClear();

    fixture.componentRef.setInput('filter', 'high-fit');
    await settle();

    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'high-fit', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { nonFit: 'high-fit', nonSearch: null, nonPage: null },
        preserveFragment: true,
        replaceUrl: true,
      })
    );
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '2' });
    getNonMembersOrgs.mockClear();

    fixture.componentInstance['searchText'].set('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledTimes(1);
    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: 'acme', nonPage: null } }));
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getNonMembersOrgs.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, pageSize: 10 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: null, nonPage: 3 } }));
  });

  it('starts on the cut the page binds and the search and page the URL carries, in one read', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonFit: 'meetings', nonSearch: 'acme', nonPage: '2' }, undefined, 'meetings');

    expect(getNonMembersOrgs).toHaveBeenCalledTimes(1);
    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ filter: 'meetings', search: 'acme', offset: 10 }));
  });

  it('falls back to the first page for a URL page it cannot honour', async () => {
    await render(response(), { nonPage: '-2' });

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('re-reads from page 1 when the period changes', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '3' });
    getNonMembersOrgs.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
  });

  it('re-reads from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '3' });
    getNonMembersOrgs.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { nonPage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getNonMembersOrgs).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getNonMembersOrgs).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getNonMembersOrgs).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: null, nonPage: 4 } }));
  });

  it('settles empty, with no body, when no non-member company is active in the period', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('non-members-orgs-search')).toBeNull();
    expect(query('non-members-orgs-table')).toBeNull();
  });

  it('keeps the search when the cut matches nothing, and Reset filters clears the search, the switch and the page, not the sort', async () => {
    const noMatch = response({ rows: [], totalRecords: 0, scopeTotal: 40 });
    await render(response({ totalRecords: 40, scopeTotal: 40 }), { nonSearch: 'zeta', nonPage: '2' }, noMatch);
    fixture.componentRef.setInput('filter', 'high-fit');
    sortBy('contributions');
    await settle();

    expect(text('non-members-orgs-no-match')).toContain('No matching companies');
    expect(text('non-members-orgs-no-match')).toContain('No company matches this search or filter.');
    expect(query('non-members-orgs-search')).not.toBeNull();
    // A filter miss is not an empty period, so the shell must not take the section over.
    expect(verdicts.every((empty) => !empty)).toBe(true);

    getNonMembersOrgs.mockClear();
    (query('non-members-orgs-no-match')?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledTimes(1);
    expect(getNonMembersOrgs).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'all', search: '', offset: 0, sort: { key: 'contributions', direction: 'desc' } })
    );
    expect(fixture.componentInstance.filter()).toBe('all');
  });

  // A failed read must not render copy that asserts the foundation had no active companies.
  it('separates a failed read from an empty one, settling it', async () => {
    await render();
    lifecycle.length = 0;
    getNonMembersOrgs.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentRef.setInput('filter', 'meetings');
    await settle();

    expect(query('non-members-orgs-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersOrgs).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
  });
});
