// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementRepresentativesComponent } from './engagement-representatives.component';

import type { HealthMetricsEngagementRepPeriodCounts, HealthMetricsEngagementRepresentatives, HealthMetricsEngagementRepRow } from '@lfx-one/shared/interfaces';

function repRow(overrides: Partial<HealthMetricsEngagementRepRow> = {}): HealthMetricsEngagementRepRow {
  return {
    key: 'r-1',
    personName: 'Dana Fields',
    accountName: 'Acme Motors',
    committeeName: 'Technical Steering Committee',
    lastAttendedDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true },
      { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false },
      { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 3, neverAttended: false, lapsed: false },
      { range: 'YTD', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false },
    ],
    ...overrides,
  };
}

/** The view counts its scope per period, so a fixture has to carry one pair per period. */
function counts(reps: number, neverAttendedReps: number): HealthMetricsEngagementRepPeriodCounts[] {
  return [
    { range: 'COMPLETED_YEAR_3', reps, neverAttendedReps },
    { range: 'COMPLETED_YEAR_2', reps, neverAttendedReps },
    { range: 'COMPLETED_YEAR', reps: reps + 1, neverAttendedReps },
    { range: 'YTD', reps, neverAttendedReps },
  ];
}

function response(overrides: Partial<HealthMetricsEngagementRepresentatives> = {}): HealthMetricsEngagementRepresentatives {
  return { rows: [repRow()], counts: counts(1, 0), ...overrides };
}

describe('EngagementRepresentativesComponent', () => {
  let fixture: ComponentFixture<EngagementRepresentativesComponent>;
  let getEngagementRepresentatives: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  async function render(
    payload: HealthMetricsEngagementRepresentatives | Error = response(),
    onCounts?: (counts: unknown) => void,
    queryParams: Record<string, string> = {},
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementRepresentatives = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementRepresentativesComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEngagementRepresentatives } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The component reads its initial segment off the URL, and writes it back.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementRepresentativesComponent);
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

    expect(getEngagementRepresentatives).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]');
    expect(row.textContent).toContain('Dana Fields');
    expect(row.textContent).toContain('Acme Motors');
    expect(row.textContent).toContain('Technical Steering Committee');
    expect(row.textContent).toContain('2 / 6');
    expect(row.textContent).toContain('Aug 14, 2026');
  });

  // The placeholder and the icon give the box no accessible name, so the label has to.
  it('names the search box for assistive tech', async () => {
    await render();

    const label: HTMLLabelElement | null = fixture.nativeElement.querySelector('label[for="engagement-representatives-search"]');
    expect(label?.textContent?.trim()).toBe('Search person or organization');
    expect(fixture.nativeElement.querySelector('input#engagement-representatives-search')).not.toBeNull();
  });

  // The period pill projects the loaded rows, so switching it must not cost another request.
  it('re-projects the loaded rows when the period changes, without re-reading', async () => {
    await render();
    getEngagementRepresentatives.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementRepresentatives).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]').textContent).toContain('3 / 6');
  });

  // Unlike the org and non-member captions, this view counts its scope per period, so the badge and
  // the caption both have to follow the pill off the already-loaded response.
  it('re-reports the badge counts for the newly selected period, off the loaded response', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: counts(48, 12) }), (value) => emitted.push(value));
    getEngagementRepresentatives.mockClear();

    expect(emitted).toEqual([null, { range: 'YTD', reps: 48, neverAttendedReps: 12 }]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-count"]').textContent.trim()).toBe(
      '48 representatives · 12 never attended'
    );

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementRepresentatives).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toEqual({ range: 'COMPLETED_YEAR', reps: 49, neverAttendedReps: 12 });
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-count"]').textContent.trim()).toBe(
      '49 representatives · 12 never attended'
    );
  });

  // A view that reports no scope count has not measured zero representatives, and the table says so.
  it('captions an unmeasured scope with an em dash rather than a confident zero', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (value) => emitted.push(value));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-count"]').textContent.trim()).toBe('—');
    expect(emitted).toEqual([null, null]);
  });

  // The caption counts the period's invited population, so a row invited in another period is not
  // part of the table the caption describes.
  it('drops rows that were not invited in the selected period', async () => {
    const other = repRow({
      key: 'r-2',
      personName: 'Sam Rivera',
      periods: [
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false },
        { range: 'COMPLETED_YEAR', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false },
        { range: 'YTD', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false },
      ],
    });
    await render(response({ rows: [repRow(), other], counts: counts(2, 1) }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).toBeNull();
  });

  it('narrows to the never-attended cut on the view flag rather than an absent date', async () => {
    const never = repRow({
      key: 'r-2',
      personName: 'Sam Rivera',
      lastAttendedDate: null,
      periods: [
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false },
      ],
    });
    await render(response({ rows: [repRow(), never], counts: counts(2, 1) }));

    fixture.componentInstance['onFilterChange']('never');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]');
    expect(row).not.toBeNull();
    // Never attended has no date to show, and "0 / 6" is the whole story next to it.
    expect(row.textContent).toContain('0 / 6');
    expect(row.textContent).toContain('—');
  });

  it('narrows to the lapsed cut on the selected period flag', async () => {
    const lapsed = repRow({
      key: 'r-2',
      periods: [
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false },
        { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true },
      ],
    });
    await render(response({ rows: [repRow(), lapsed], counts: counts(2, 0) }));

    fixture.componentInstance['onFilterChange']('lapsed');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).not.toBeNull();
    // The caption still counts the period's whole population, not the cut.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-count"]').textContent.trim()).toBe(
      '2 representatives · 0 never attended'
    );
  });

  it('restores the cut from the URL, so a deep link lands on the segment it named', async () => {
    const never = repRow({
      key: 'r-2',
      periods: [{ range: 'YTD', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false }],
    });
    await render(response({ rows: [repRow(), never], counts: counts(2, 1) }), undefined, { repFilter: 'never' });

    expect(fixture.componentInstance['filter']()).toBe('never');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).not.toBeNull();
  });

  // The segment is shareable state, so it belongs in the URL — and the default belongs out of it.
  it('writes the cut to the URL and clears the param on the way back to all', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onFilterChange']('never');
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { repFilter: 'never' }, preserveFragment: true, replaceUrl: true }));

    fixture.componentInstance['onFilterChange']('all');
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { repFilter: null } }));
  });

  // An unknown segment in the URL is not a segment — it must land on the default, not an empty table.
  it('falls back to the all segment for a repFilter value the table does not have', async () => {
    await render(response(), undefined, { repFilter: 'bogus' });

    expect(fixture.componentInstance['filter']()).toBe('all');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).not.toBeNull();
  });

  it('searches the person and the organization together, without another request', async () => {
    const other = repRow({ key: 'r-2', personName: 'Sam Rivera', accountName: 'Vendor Corp' });
    await render(response({ rows: [repRow(), other], counts: counts(2, 0) }));
    getEngagementRepresentatives.mockClear();

    typeSearch('vendor');

    expect(getEngagementRepresentatives).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).not.toBeNull();

    typeSearch('dana');

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).toBeNull();
  });

  // A zero-row read is an unmeasured scope; the "no match" copy would claim a measured absence.
  it('renders the not-available state for a scope with no representatives rows', async () => {
    await render(response({ rows: [], counts: null }));

    const empty: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]');
    expect(empty?.textContent).toContain('Representatives data is not available yet');
  });

  it('keeps the no-match state for a search that filters a measured scope down to nothing', async () => {
    await render();

    typeSearch('nobody-matches-this');

    const empty: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]');
    expect(empty?.textContent).toContain('No representatives match this filter');
    expect(empty?.textContent).not.toContain('not available yet');
  });

  // Two foundations can hold the same number of reps, so the row count cannot stand in for identity.
  it('restarts paging when the foundation changes, not merely when the row count does', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => repRow({ key: `r-${index}`, personName: `Person ${index}` }));
    await render(response({ rows, counts: counts(60, 0) }));

    fixture.componentInstance['first'].set(50);
    selectedFoundation.set({ slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['first']()).toBe(0);
  });

  // A failed read renders no rows, and "no representatives" would state that absence as measured fact.
  it('shows the error state rather than the empty state when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (value) => emitted.push(value));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]')).toBeNull();
    expect(emitted).toEqual([null, null]);
  });

  // The pill re-reports off the loaded response, and a failed read has none to report.
  it('keeps the badge empty when the period changes after a failed read', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (value) => emitted.push(value));

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(emitted).toEqual([null, null]);
  });

  // A read in flight still holds the previous foundation's payload, so the pill must not republish it.
  it('keeps the badge empty when the period changes while the next foundation is still loading', async () => {
    const emitted: unknown[] = [];
    await render(response(), (value) => emitted.push(value));
    emitted.length = 0;

    getEngagementRepresentatives.mockReturnValue(NEVER);
    selectedFoundation.set({ slug: 'other' });
    fixture.detectChanges();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(emitted).toEqual([null]);
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
    await render(response(), (value) => emitted.push(value), {}, lifecycle);

    expect(getEngagementRepresentatives).not.toHaveBeenCalled();
    expect(emitted).toEqual([null, null]);
    // Settling here would release the container's pending deep link before any read has reflowed
    // the pane, and no later read can re-arm a fragment that is already gone.
    expect(lifecycle).toEqual(['reading']);
    // An unresolved foundation is not a measured empty scope — no read happened to call it empty,
    // so the table holds its loading state rather than the section rendering empty or errored.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-table"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-error"]')).toBeNull();
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
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]')).not.toBeNull();
  });
});
