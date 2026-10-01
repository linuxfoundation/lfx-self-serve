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
        // The component reads its initial segment off the URL, and writes it back.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementOrgParticipationComponent);
    if (onCounts) fixture.componentInstance.countsChange.subscribe(onCounts);
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The search box is debounced, so a keystroke only reaches the filter once the pause elapses. */
  function typeSearch(term: string): void {
    vi.useFakeTimers();
    fixture.componentInstance['searchForm'].controls.search.setValue(term);
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
  }

  it('reads the selected foundation and renders the returned rows', async () => {
    await render();

    expect(getEngagementOrgParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]');
    expect(row.textContent).toContain('Acme Motors');
    expect(row.textContent).toContain('21 / 27');
    expect(row.textContent).toContain('1.8');
    expect(row.textContent).toContain('Aug 14, 2026');
  });

  // The placeholder and the icon give the box no accessible name, so the label has to.
  it('names the search box for assistive tech', async () => {
    await render();

    const label: HTMLLabelElement | null = fixture.nativeElement.querySelector('label[for="engagement-org-participation-search"]');
    expect(label?.textContent?.trim()).toBe('Search organization');
    expect(fixture.nativeElement.querySelector('input#engagement-org-participation-search')).not.toBeNull();
  });

  // The period pill projects the loaded rows, so switching it must not cost another request.
  it('re-projects the loaded rows when the period changes, without re-reading', async () => {
    await render();
    getEngagementOrgParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]').textContent).toContain('20 / 27');
  });

  // The caption counts the whole foundation, not the filtered cut, so it comes off the response.
  it('emits the scope counts for the sub-nav badge, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { orgs: 136, lapsedOrgs: 54 } }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, { orgs: 136, lapsedOrgs: 54 }]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-count"]').textContent.trim()).toBe('136 organizations · 54 lapsed');
  });

  // A view that reports no scope count has not measured zero organizations, and the table says so.
  it('captions an unmeasured scope with an em dash rather than a confident zero', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (counts) => emitted.push(counts));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-count"]').textContent.trim()).toBe('\u2014');
    expect(emitted).toEqual([null, null]);
  });

  // Missing caption counts must not hide organizations the view did return.
  it('still renders the returned rows when only the caption counts are unmeasured', async () => {
    await render(response({ counts: null }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).toBeNull();
  });

  it('shows the not-available state when the view returns no rows for the scope', async () => {
    await render(response({ rows: [], counts: null }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]').textContent).toContain(
      'No organizations recorded for this foundation'
    );
  });

  // Two foundations can hold the same number of orgs, so the row count cannot stand in for identity.
  it('restarts paging when the foundation changes, not merely when the row count does', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => orgRow({ accountId: `a-${index}`, accountName: `Org ${index}` }));
    await render(response({ rows, counts: { orgs: 60, lapsedOrgs: 0 } }));

    fixture.componentInstance['first'].set(50);
    selectedFoundation.set({ slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['first']()).toBe(0);
  });

  it('narrows to lapsed organizations on the segment, using the view flag rather than a date sum', async () => {
    const lapsed = orgRow({ accountId: 'a-2', accountName: 'Vendor Corp', lapsed: true, lastEngagedDate: '2025-01-09' });
    await render(response({ rows: [orgRow(), lapsed], counts: { orgs: 2, lapsedOrgs: 1 } }));

    fixture.componentInstance['onFilterChange']('lapsed');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-2"]')).not.toBeNull();
    // The caption still counts the foundation, not the cut — the segment narrows the table only.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-count"]').textContent.trim()).toBe('2 organizations · 1 lapsed');
  });

  it('restores the lapsed segment from the URL, so a deep link lands on the cut it named', async () => {
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
    fixture.componentInstance['searchForm'].controls.search.setValue('vendor');
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

    fixture.componentInstance['onFilterChange']('lapsed');
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { orgFilter: 'lapsed' }, preserveFragment: true, replaceUrl: true }));

    fixture.componentInstance['onFilterChange']('all');
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgFilter: null } }));
  });

  // An unknown segment in the URL is not a segment — it must land on the default, not an empty table.
  it('falls back to the all segment for an orgFilter value the table does not have', async () => {
    await render(response(), undefined, { orgFilter: 'bogus' });

    expect(fixture.componentInstance['filter']()).toBe('all');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).not.toBeNull();
  });

  // A failed read renders no rows, and "no organizations" would state that absence as measured fact.
  it('shows the error state rather than the empty state when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (counts) => emitted.push(counts));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).toBeNull();
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
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-empty"]')).not.toBeNull();
  });
});
