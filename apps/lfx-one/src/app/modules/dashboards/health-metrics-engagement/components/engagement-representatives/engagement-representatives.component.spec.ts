// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementRepresentativesComponent } from './engagement-representatives.component';

import type { HealthMetricsEngagementRepPeriodCounts, HealthMetricsEngagementRepresentatives, HealthMetricsEngagementRepRow } from '@lfx-one/shared/interfaces';

function repRow(overrides: Partial<HealthMetricsEngagementRepRow> = {}): HealthMetricsEngagementRepRow {
  return {
    key: 'r-1',
    personName: 'Dana Fields',
    identityUnresolved: false,
    accountName: 'Acme Motors',
    jobTitle: 'Head of OSPO',
    committeeName: 'Technical Steering Committee',
    lastAttendedDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true, sortRank: 1 },
      { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false, sortRank: 1 },
      { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 3, neverAttended: false, lapsed: false, sortRank: 1 },
      { range: 'YTD', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false, sortRank: 1 },
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
  let verdicts: boolean[];
  let queryParamMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function render(
    payload: HealthMetricsEngagementRepresentatives | Error = response(),
    onCounts?: (counts: unknown) => void,
    queryParams: Record<string, string> = {},
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementRepresentatives = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));
    queryParamMap = new BehaviorSubject(convertToParamMap(queryParams));

    await TestBed.configureTestingModule({
      imports: [EngagementRepresentativesComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementRepresentatives } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The component writes its cut back to the URL, and follows later changes to it.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) }, queryParamMap } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementRepresentativesComponent);
    // The page parses the cut off the URL and binds it in, before the first read.
    if (queryParams['repFilter']) fixture.componentRef.setInput('filter', queryParams['repFilter']);
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

    expect(getEngagementRepresentatives).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]');
    expect(row.textContent).toContain('Dana Fields');
    expect(row.textContent).toContain('Technical Steering Committee');
    expect(row.textContent).toContain('2 / 6');
    expect(row.textContent).toContain('Aug 14, 2026');
    expect(verdicts).toEqual([false]);
  });

  it('shows the person with their avatar, and the company and job title under the name', async () => {
    await render();

    const headers = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="engagement-representatives-table"] th')) as HTMLElement[];
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Representative', 'Group', 'Attended', 'Last attended']);
    const cells = (query('engagement-representatives-row-r-1') as HTMLElement).querySelectorAll('td');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-text"]')?.textContent).toBe('Dana Fields');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-person"]')).not.toBeNull();
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Acme Motors・Head of OSPO');
    expect(cells[1].textContent?.trim()).toBe('Technical Steering Committee');
    expect(cells[2].textContent?.trim()).toBe('2 / 6');
    expect(cells[3].textContent?.trim()).toBe('Aug 14, 2026');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-text"]')?.className).not.toContain('italic');
  });

  // A never-attended rep shows a danger badge and no date; lapsed and active reps read as plain text.
  it('badges a never-attended count in danger and dashes its date, leaving lapsed reps plain', async () => {
    const periodsWith = (flags: { neverAttended: boolean; lapsed: boolean }) =>
      repRow().periods.map((period) => (period.range === 'YTD' ? { ...period, ...flags, meetingsAttended: flags.neverAttended ? 0 : 1 } : period));
    await render(
      response({
        rows: [
          repRow({ key: 'r-never', periods: periodsWith({ neverAttended: true, lapsed: false }) }),
          repRow({ key: 'r-lapsed', periods: periodsWith({ neverAttended: false, lapsed: true }) }),
        ],
        counts: counts(2, 1),
      })
    );

    const badge = query('engagement-representatives-row-r-never-never') as HTMLElement;
    expect(badge.tagName).toBe('LFX-UI-BADGE');
    expect(badge.textContent?.trim()).toBe('0 / 6 — never attended');
    expect(badge.querySelector('.sr-only')?.textContent).toBe(' — never attended');
    const never = (query('engagement-representatives-row-r-never') as HTMLElement).querySelectorAll('td');
    expect(never[3].querySelector('[data-testid="health-metrics-cell-text"]')?.className).toContain('text-gray-400');
    expect(never[3].textContent?.trim()).toBe('—');
    const lapsed = (query('engagement-representatives-row-r-lapsed') as HTMLElement).querySelectorAll('td');
    expect(query('engagement-representatives-row-r-lapsed-never')).toBeNull();
    expect(lapsed[2].textContent?.trim()).toBe('1 / 6');
    expect(lapsed[3].textContent?.trim()).toBe('Aug 14, 2026');
    expect(lapsed[3].querySelector('.text-amber-600, .text-red-600')).toBeNull();
  });

  // Two unresolved rows must not read as one person listed twice.
  it('renders an unresolved identity in italic neutral-500 behind a "?" avatar, with the company alone', async () => {
    await render(response({ rows: [repRow({ identityUnresolved: true, personName: 'Dana Fields' })] }));

    const cell = (query('engagement-representatives-row-r-1') as HTMLElement).querySelector('td') as HTMLElement;
    expect(cell.textContent).toContain('Unresolved identity');
    expect(cell.textContent).not.toContain('Dana Fields');
    // On the name alone: the table's td rule would override a colour on the cell, and the company and avatar stay upright.
    const name = cell.querySelector('[data-testid="health-metrics-cell-text"]') as HTMLElement;
    expect(name.className).toContain('italic');
    expect(name.className).toContain('text-gray-500');
    expect(cell.querySelector('[data-testid="health-metrics-cell-description"]')?.className).not.toContain('italic');
    expect(cell.querySelector('[data-testid="health-metrics-cell-person"]')?.textContent?.trim()).toBe('?');
    expect(cell.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Acme Motors');
  });

  it('searches with the small search field named for its person or company search', async () => {
    await render();

    const search = query('engagement-representatives-search') as HTMLElement;
    expect(search.tagName).toBe('LFX-UI-SEARCH-INPUT');
    expect(search.querySelector('input')?.getAttribute('placeholder')).toBe('Search person or company...');
  });

  it('pages ten representatives at a time with the numbered pager', async () => {
    const rows = Array.from({ length: 23 }, (_, index) => repRow({ key: `r-${index}`, personName: `Person ${index}` }));
    await render(response({ rows, counts: counts(23, 0) }));

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="engagement-representatives-row-"]:not([data-testid$="-never"])')).toHaveLength(10);
    expect(query('ui-pagination-info')?.textContent?.trim()).toBe('Showing 1 to 10 of 23');
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

  // This view counts its scope per period, so the note has to follow the period off the loaded response.
  it('re-reports the note counts for the newly selected period, off the loaded response', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: counts(48, 12) }), (value) => emitted.push(value));
    getEngagementRepresentatives.mockClear();

    expect(emitted).toEqual([null, { range: 'YTD', reps: 48, neverAttendedReps: 12 }]);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementRepresentatives).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toEqual({ range: 'COMPLETED_YEAR', reps: 49, neverAttendedReps: 12 });
    // The period re-settles too, since whether it has any representative moves the section's height.
    expect(verdicts).toEqual([false, false]);
  });

  // A view that reports no scope count has not measured zero representatives.
  it('reports no note counts for an unmeasured scope, keeping its rows', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (value) => emitted.push(value));

    expect(emitted).toEqual([null, null]);
    // Unmeasured counts only caption the rows; the table still has them, so the section is not empty.
    expect(verdicts).toEqual([false]);
  });

  // The caption counts the period's invited population, so a row invited in another period is not
  // part of the table the caption describes.
  it('drops rows that were not invited in the selected period', async () => {
    const other = repRow({
      key: 'r-2',
      personName: 'Sam Rivera',
      periods: [
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'YTD', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false, sortRank: 1 },
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
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 },
      ],
    });
    await render(response({ rows: [repRow(), never], counts: counts(2, 1) }));

    setFilter('never');

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
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR_2', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'COMPLETED_YEAR', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true, sortRank: 1 },
      ],
    });
    await render(response({ rows: [repRow(), lapsed], counts: counts(2, 0) }));

    setFilter('lapsed');

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).not.toBeNull();
  });

  it('starts on the cut the page binds in from the URL', async () => {
    const never = repRow({
      key: 'r-2',
      periods: [{ range: 'YTD', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 }],
    });
    await render(response({ rows: [repRow(), never], counts: counts(2, 1) }), undefined, { repFilter: 'never' });

    expect(fixture.componentInstance['filter']()).toBe('never');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-2"]')).not.toBeNull();
  });

  it('follows a later URL change to the cut, as when the Never attended stat links here', async () => {
    const never = repRow({
      key: 'r-2',
      periods: [{ range: 'YTD', meetingsInvited: 6, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: 1 }],
    });
    await render(response({ rows: [repRow(), never], counts: counts(2, 1) }));
    expect(fixture.componentInstance['filter']()).toBe('all');

    queryParamMap.next(convertToParamMap({ repFilter: 'never' }));
    fixture.detectChanges();

    expect(fixture.componentInstance['filter']()).toBe('never');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).toBeNull();
  });

  // The segment is shareable state, so it belongs in the URL — and the default belongs out of it.
  it('writes the cut to the URL and clears the param on the way back to all', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    setFilter('never');
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { repFilter: 'never' }, preserveFragment: true, replaceUrl: true }));

    setFilter('all');
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { repFilter: null } }));
  });

  it('searches the person and the company together, without another request', async () => {
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

  // A zero-row read settles empty for the shell; the "no match" copy would blame the filter.
  it('settles empty, with no body, for a scope with no representatives rows', async () => {
    await render(response({ rows: [], counts: null }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-table"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]')).toBeNull();
  });

  it('settles empty, with no body, when every row was invited only in another period, and re-settles on that period', async () => {
    const earlier = repRow({
      periods: [
        { range: 'COMPLETED_YEAR_3', meetingsInvited: 4, meetingsAttended: 2, neverAttended: false, lapsed: false, sortRank: 1 },
        { range: 'YTD', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false, sortRank: 1 },
      ],
    });
    await render(response({ rows: [earlier] }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-table"]')).toBeNull();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_3');
    fixture.detectChanges();

    expect(verdicts).toEqual([true, false]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-row-r-1"]')).not.toBeNull();
  });

  it('keeps the no-match state for a search that filters a measured scope down to nothing', async () => {
    await render();

    typeSearch('nobody-matches-this');

    const empty: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="engagement-representatives-empty"]');
    expect(empty?.textContent).toContain('No representatives match this filter');
    expect(empty?.textContent).toContain('Nobody in this scope falls into this group right now.');

    setFilter('never');
    (empty?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    expect(fixture.componentInstance.filter()).toBe('all');
    expect(fixture.componentInstance['searchText']()).toBe('');
    // A cleared search skips the debounce, so the rows come back at once.
    TestBed.tick();
    fixture.detectChanges();
    expect(query('engagement-representatives-row-r-1')).not.toBeNull();
  });

  // Two foundations can hold the same number of reps, so the row count cannot stand in for identity.
  it('restarts paging when the foundation changes, not merely when the row count does', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => repRow({ key: `r-${index}`, personName: `Person ${index}` }));
    await render(response({ rows, counts: counts(60, 0) }));

    fixture.componentInstance['page'].set(5);
    selectedFoundation.set({ slug: 'other' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['page']()).toBe(0);
  });

  // A failed read renders no rows, and "no representatives" would state that absence as measured fact.
  it('shows the error state rather than the empty state when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (value) => emitted.push(value));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-error"]')).not.toBeNull();
    expect(verdicts).toEqual([false]);
    expect(emitted).toEqual([null, null]);
  });

  // The pill re-reports off the loaded response, and a failed read has none to report.
  it('keeps the note empty when the period changes after a failed read', async () => {
    const emitted: unknown[] = [];
    await render(new Error('snowflake down'), (value) => emitted.push(value));

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(emitted).toEqual([null, null]);
  });

  // A read in flight still holds the previous foundation's payload, so the pill must not republish it.
  it('keeps the note empty when the period changes while the next foundation is still loading', async () => {
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
    expect(verdicts).toEqual([false, true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-representatives-table"]')).toBeNull();
  });
});
