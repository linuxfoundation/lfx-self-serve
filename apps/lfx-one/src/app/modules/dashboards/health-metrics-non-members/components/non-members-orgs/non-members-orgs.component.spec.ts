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

import type { HealthMetricsNonMembersOrg, HealthMetricsNonMembersOrgs } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function org(overrides: Partial<HealthMetricsNonMembersOrg> = {}): HealthMetricsNonMembersOrg {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    lastEngagedDate: '2026-03-14',
    meetingsAttended: 42,
    distinctPeople: 9,
    contributions: 1840,
    isNew: true,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsNonMembersOrgs> = {}): HealthMetricsNonMembersOrgs {
  return { rows: [org()], totalRecords: 1, scopeTotal: 1, newCount: 1, ...overrides };
}

describe('NonMembersOrgsComponent', () => {
  let fixture: ComponentFixture<NonMembersOrgsComponent>;
  let getNonMembersOrgs: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsNonMembersOrgs = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsNonMembersOrgs
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

  it('reads the selected foundation and period, renders the page, summary and note, and settles', async () => {
    await render(response({ scopeTotal: 412, newCount: 37 }));

    expect(getNonMembersOrgs).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', filter: 'all', search: '', offset: 0, pageSize: 10 });
    expect(text(`non-members-orgs-row-${ACCOUNT_ID}-name`)).toBe('Acme Motors');
    expect(text('non-members-orgs-count')).toBe('412 organizations · 37 new this period');
    expect(text('non-members-orgs-provisional')).toContain('provisional');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts).toEqual([null, 412]);
  });

  it('renders an organization row with its active channels and counts', async () => {
    await render();
    const cell = (key: string) => text(`non-members-orgs-row-${ACCOUNT_ID}-${key}`);

    const chips = [...(query(`non-members-orgs-row-${ACCOUNT_ID}-channels`)?.children ?? [])].map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['Attends meetings', 'Contributes code']);
    expect(cell('meetings')).toBe('42');
    expect(cell('people')).toBe('9');
    expect(cell('contributions')).toBe('1,840');
    expect(cell('last-engaged')).toBe('Mar 14, 2026');
  });

  it('caps the search box at the length the read honours and marks Last engaged as all time', async () => {
    await render();
    const headers = [...(fixture.nativeElement as HTMLElement).querySelectorAll('th')].map((th) => th.textContent?.trim());

    expect((fixture.nativeElement.querySelector('#non-members-orgs-search') as HTMLInputElement).maxLength).toBe(100);
    expect(headers).toContain('Last engaged (all time)');
  });

  it('renders a contributions-only organization with dashes and only the code chip', async () => {
    await render(response({ rows: [org({ meetingsAttended: null, distinctPeople: null })] }));
    const meetings = query(`non-members-orgs-row-${ACCOUNT_ID}-meetings`);

    expect(text(`non-members-orgs-row-${ACCOUNT_ID}-channels`)).toBe('Contributes code');
    expect(meetings?.textContent?.trim()).toBe('—');
    expect(meetings?.classList).toContain('text-gray-400');
    expect(text(`non-members-orgs-row-${ACCOUNT_ID}-people`)).toBe('—');
  });

  it('re-reads from page 1 when the filter changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '3' });
    getNonMembersOrgs.mockClear();

    fixture.componentInstance['onFilterChange']('high-fit');
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

  it('ignores a filter id it does not know', async () => {
    await render(response(), { nonFit: 'meetings' });

    fixture.componentInstance['onFilterChange']('medium-fit');
    await settle();

    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'all' }));
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPage: '2' });
    getNonMembersOrgs.mockClear();

    fixture.componentInstance['searchForm'].controls.search.setValue('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledTimes(1);
    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: 'acme', nonPage: null } }));
  });

  it('shows the filtered count with a clear link that resets the filter and search in one read', async () => {
    await render(response({ totalRecords: 16, scopeTotal: 412 }), { nonFit: 'meetings', nonSearch: 'acme' });

    expect(text('non-members-orgs-count')).toBe('16 of 412 organizations match · clear');

    getNonMembersOrgs.mockClear();
    query('non-members-orgs-clear')?.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledTimes(1);
    expect(getNonMembersOrgs).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'all', search: '' }));
  });

  it('keeps the sub-nav count through page turns and filters, blanking it only for a new period', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    counts.length = 0;

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    fixture.componentInstance['onFilterChange']('meetings');
    await settle();
    expect(counts.every((count) => count === 80)).toBe(true);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();
    expect(counts.at(-2)).toBeNull();
    expect(counts.at(-1)).toBe(80);
  });

  it('pages through the table, including a new page size, and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getNonMembersOrgs.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, pageSize: 25 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: null, nonPage: 3 } }));
  });

  it('starts on the filter, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonFit: 'meetings', nonSearch: 'acme', nonPage: '2' });

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ filter: 'meetings', search: 'acme', offset: 10 }));
    expect((fixture.nativeElement.querySelector('#non-members-orgs-search') as HTMLInputElement).value).toBe('acme');
  });

  it('falls back to the defaults for URL values it cannot honour', async () => {
    await render(response(), { nonFit: 'medium-fit', nonPage: '-2' });

    expect(getNonMembersOrgs).toHaveBeenCalledWith(expect.objectContaining({ filter: 'all', offset: 0 }));
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
    expect(counts).toEqual([null, 34]);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonFit: null, nonSearch: null, nonPage: 4 } }));
  });

  it('shows the empty state when no non-member organization is active in the period', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0, newCount: 0 }));

    expect(query('non-members-orgs-empty')).not.toBeNull();
    expect(query('non-members-orgs-table')).toBeNull();
  });

  it('keeps the controls and names the search when it matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { nonSearch: 'zeta' });

    expect(text('non-members-orgs-no-match')).toBe('No organization matches “zeta”.');
    expect(query('non-members-orgs-controls')).not.toBeNull();
  });

  it('says the filter matches nothing when no search is set', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { nonFit: 'high-fit' });

    expect(text('non-members-orgs-no-match')).toBe('No organization matches this filter.');
  });

  // A failed read must not render copy that asserts the foundation had no active organizations.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render();
    counts.length = 0;
    lifecycle.length = 0;
    getNonMembersOrgs.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onFilterChange']('meetings');
    await settle();

    expect(query('non-members-orgs-error')).not.toBeNull();
    expect(query('non-members-orgs-empty')).toBeNull();
    expect(counts).toEqual([null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersOrgs).not.toHaveBeenCalled();
    expect(counts.every((count) => count === null)).toBe(true);
    expect(lifecycle).not.toContain('settled');
    expect(text('non-members-orgs-count')).toBe('—');
    expect(query('non-members-orgs-empty')).toBeNull();
  });
});
