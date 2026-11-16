// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementOrgParticipationComponent } from './engagement-org-participation.component';

import type { HealthMetricsEngagementOrgParticipation, HealthMetricsEngagementOrgRow } from '@lfx-one/shared/interfaces';

function orgRow(overrides: Partial<HealthMetricsEngagementOrgRow> = {}): HealthMetricsEngagementOrgRow {
  return {
    accountId: 'a-1',
    accountName: 'Acme Motors',
    membershipTier: 'Platinum',
    isMember: true,
    lastEngagedDate: '2026-08-14',
    daysSinceLastEngaged: 39,
    lapsed: false,
    logoUrl: '',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 18, attendancePct: 0.67, avgReps: 1.4, sortRank: 3 },
      { range: 'COMPLETED_YEAR_2', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 19, attendancePct: 0.7, avgReps: 1.5, sortRank: 3 },
      { range: 'COMPLETED_YEAR', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 20, attendancePct: 0.74, avgReps: 1.6, sortRank: 2 },
      { range: 'YTD', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 21, attendancePct: 0.78, avgReps: 1.75, sortRank: 1 },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsEngagementOrgParticipation> = {}): HealthMetricsEngagementOrgParticipation {
  return { rows: [orgRow()], counts: { orgs: 1, lapsedOrgs: 0 }, ...overrides };
}

describe('EngagementOrgParticipationComponent', () => {
  let fixture: ComponentFixture<EngagementOrgParticipationComponent>;
  let getEngagementOrgParticipation: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let verdicts: boolean[];

  async function render(
    payload: HealthMetricsEngagementOrgParticipation | Error = response(),
    onCounts?: (counts: unknown) => void,
    queryParams: Record<string, string> = {},
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementOrgParticipation = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementOrgParticipationComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementOrgParticipation } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The component writes its activity cut back to the URL.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementOrgParticipationComponent);
    // The page parses the cut off the URL and binds it in, before the first read.
    if (queryParams['orgFilter']) fixture.componentRef.setInput('filter', queryParams['orgFilter']);
    if (onCounts) fixture.componentInstance.countsChange.subscribe(onCounts);
    fixture.componentInstance.settled.subscribe((empty) => verdicts.push(empty));
    // Subscribed before the first change detection, so the initial read's own pair is recorded.
    if (lifecycle) {
      fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
      fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    verdicts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function setFilter(filter: string): void {
    fixture.componentRef.setInput('filter', filter);
    fixture.detectChanges();
  }

  /** The search box is debounced, so a keystroke only reaches the filter once the pause elapses. */
  function typeSearch(term: string): void {
    vi.useFakeTimers();
    fixture.componentInstance['searchText'].set(term);
    // The search reaches its debounce through `toObservable`, which emits as effects flush.
    TestBed.tick();
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
  }

  it('reads the selected foundation and renders the returned rows', async () => {
    await render();

    expect(getEngagementOrgParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]');
    const cells = row.querySelectorAll('td');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-text"]')?.textContent).toBe('Acme Motors');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(cells[1].textContent?.trim()).toBe('Platinum');
    expect(cells[1].querySelector('[data-testid="health-metrics-cell-tier"]')).not.toBeNull();
    expect(cells[2].querySelector('[data-testid="health-metrics-progress-value"]')?.textContent?.trim()).toBe('21 of 27 (78%)');
    expect((cells[2].querySelector('[data-testid="health-metrics-progress-fill"]') as HTMLElement).style.width).toBe('78%');
    expect(cells[2].querySelector('[data-testid="health-metrics-progress-fill"]')?.className).toContain('bg-blue-500');
    expect(cells[3].textContent?.trim()).toBe('1.8');
    expect(cells[4].textContent?.trim()).toBe('Aug 14, 2026');
    expect(query('engagement-org-participation-count')).toBeNull();
    expect(verdicts).toEqual([false]);
  });

  it('searches with the small search field named for its company search', async () => {
    await render();

    const search = query('engagement-org-participation-search') as HTMLElement;
    expect(search.tagName).toBe('LFX-UI-SEARCH-INPUT');
    expect(search.querySelector('input')?.getAttribute('placeholder')).toBe('Search company...');
    expect(search.querySelector('input')?.getAttribute('aria-label')).toBe('Search company');
  });

  it('reads a non-member as "Non-member" in neutral-500, and dashes a company no meeting concerned with no bar', async () => {
    const vendor = orgRow({ accountId: 'a-2', accountName: 'Vendor Corp', membershipTier: 'Non-Member', isMember: false });
    vendor.periods[3] = { ...vendor.periods[3], meetingsTotal: 0, attendedCount: 0, attendancePct: null, avgReps: null };
    await render(response({ rows: [vendor] }));

    const cells = (query('engagement-org-participation-row-a-2') as HTMLElement).querySelectorAll('td');
    expect(cells[1].textContent?.trim()).toBe('Non-member');
    expect(cells[1].className).toContain('text-gray-500');
    expect(cells[1].querySelector('[data-testid="health-metrics-cell-tier"]')).toBeNull();
    expect(cells[2].textContent?.trim()).toBe('—');
    expect(cells[2].querySelector('[data-testid="health-metrics-progress-fill"]')).toBeNull();
    expect(cells[3].textContent?.trim()).toBe('—');
  });

  it('pages ten companies at a time with the numbered pager', async () => {
    const rows = Array.from({ length: 23 }, (_, index) => orgRow({ accountId: `a-${index}`, accountName: `Company ${index}` }));
    await render(response({ rows, counts: { orgs: 23, lapsedOrgs: 0 } }));

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="engagement-org-participation-row-"]')).toHaveLength(10);
    expect(query('ui-pagination-info')?.textContent?.trim()).toBe('Showing 1 to 10 of 23');
  });

  // The period pill projects the loaded rows, so switching it must not cost another request.
  it('re-projects the loaded rows when the period changes, without re-reading', async () => {
    await render();
    getEngagementOrgParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]').textContent).toContain('20 of 27 (74%)');
  });

  // The note counts the whole foundation, not the filtered cut, so it comes off the response.
  it('emits the scope counts for the sub-nav note, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { orgs: 136, lapsedOrgs: 54 } }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, { orgs: 136, lapsedOrgs: 54 }]);
  });

  // A view that reports no scope count has not measured zero companies.
  it('reports no note counts for an unmeasured scope rather than a confident zero', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, null]);
  });

  // Missing caption counts must not hide organizations the view did return.
  it('still renders the returned rows when only the caption counts are unmeasured', async () => {
    await render(response({ counts: null }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).toBeNull();
  });

  it('settles empty, with no body, when the view returns no rows for the scope', async () => {
    await render(response({ rows: [], counts: null }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-table"]')).toBeNull();
    // The filter-miss card is not the scope's empty state.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).toBeNull();
  });

  // Two foundations can hold the same number of orgs, so the row count cannot stand in for identity.
  it('restarts paging when the foundation changes, not merely when the row count does', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => orgRow({ accountId: `a-${index}`, accountName: `Org ${index}` }));
    await render(response({ rows, counts: { orgs: 60, lapsedOrgs: 0 } }));

    fixture.componentInstance['page'].set(5);
    selectedFoundation.set({ slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['page']()).toBe(0);
  });

  it('narrows to lapsed companies on the bound cut, using the view flag rather than a date sum', async () => {
    const lapsed = orgRow({ accountId: 'a-2', accountName: 'Vendor Corp', lapsed: true, lastEngagedDate: '2025-01-09' });
    await render(response({ rows: [orgRow(), lapsed], counts: { orgs: 2, lapsedOrgs: 1 } }));

    setFilter('lapsed');

    expect(query('engagement-org-participation-row-a-1')).toBeNull();
    expect(query('engagement-org-participation-row-a-2')).not.toBeNull();
  });

  it('starts on the cut the page binds in from the URL', async () => {
    const lapsed = orgRow({ accountId: 'a-2', lapsed: true });
    await render(response({ rows: [orgRow(), lapsed], counts: { orgs: 2, lapsedOrgs: 1 } }), undefined, { orgFilter: 'lapsed' });

    expect(fixture.componentInstance['filter']()).toBe('lapsed');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).toBeNull();
  });

  it('filters on the search box client-side, without another request', async () => {
    await render(response({ rows: [orgRow(), orgRow({ accountId: 'a-2', accountName: 'Vendor Corp' })], counts: { orgs: 2, lapsedOrgs: 0 } }));
    getEngagementOrgParticipation.mockClear();

    typeSearch('vendor');

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-2"]')).not.toBeNull();
  });

  // The filter runs over the whole loaded scope, so the cut must wait for the typing to pause.
  it('holds the cut until the search pause elapses rather than re-sorting on every character', async () => {
    await render(response({ rows: [orgRow(), orgRow({ accountId: 'a-2', accountName: 'Vendor Corp' })], counts: { orgs: 2, lapsedOrgs: 0 } }));

    vi.useFakeTimers();
    fixture.componentInstance['searchText'].set('vendor');
    TestBed.tick();
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS - 1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).not.toBeNull();

    vi.advanceTimersByTime(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).toBeNull();
  });

  // The segment is shareable state, so it belongs in the URL — and the default belongs out of it.
  it('writes the lapsed segment to the URL and clears the param on the way back to all', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    setFilter('lapsed');
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { orgFilter: 'lapsed' }, preserveFragment: true, replaceUrl: true }));

    setFilter('all');
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgFilter: null } }));
  });

  // A search and cut with no match offer to reset both, rather than leaving an empty table.
  it('shows the no-match state with Reset filters, which clears the search and the cut', async () => {
    await render(response({ rows: [orgRow()] }));
    setFilter('lapsed');

    const empty = query('engagement-org-participation-empty') as HTMLElement;
    expect(empty.textContent).toContain('No companies match this filter');
    expect(empty.textContent).toContain('No company in this scope matches the current search and activity filter.');

    fixture.componentInstance['searchText'].set('acme');
    (empty.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    expect(fixture.componentInstance.filter()).toBe('all');
    expect(fixture.componentInstance['searchText']()).toBe('');
  });

  // A failed read renders no rows, and "no organizations" would state that absence as measured fact.
  it('shows the error state rather than the empty state when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (counts) => emitted.push(counts));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-error"]')).not.toBeNull();
    expect(verdicts).toEqual([false]);
    expect(emitted).toEqual([null, null]);
  });

  it('settles even when the read fails, or the container holds a deep link forever', async () => {
    const lifecycle: string[] = [];
    await render(new Error('snowflake down'), undefined, {}, lifecycle);

    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('reports no counts and withholds the settle when no foundation is selected', async () => {
    const emitted: unknown[] = [];
    const lifecycle: string[] = [];
    selectedFoundation = signal<{ slug: string } | null>(null);
    await render(response(), (counts) => emitted.push(counts), {}, lifecycle);

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(emitted).toEqual([null, null]);
    // Settling here would release the container's pending deep link before any read has reflowed
    // the pane, and no later read can re-arm a fragment that is already gone.
    expect(lifecycle).toEqual(['reading']);
    // An unresolved foundation is not a measured empty scope — no read happened to call it empty,
    // so the table holds its loading state rather than the section rendering empty or errored.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-table"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-error"]')).toBeNull();
    expect(fixture.componentInstance['loading']()).toBe(true);
  });

  it('settles a foundation cleared after a read, rather than wedging on the skeleton', async () => {
    await render();
    expect(fixture.componentInstance['loading']()).toBe(false);

    selectedFoundation.set(null);
    await fixture.whenStable();
    fixture.detectChanges();

    // Unlike "none selected yet", this scope was read once — holding the skeleton here would leave
    // the section loading forever with nothing left to resolve it.
    expect(fixture.componentInstance['loading']()).toBe(false);
    expect(verdicts).toEqual([false, true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-table"]')).toBeNull();
  });
});
