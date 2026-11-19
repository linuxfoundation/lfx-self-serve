// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementGroupAttendanceComponent } from './engagement-group-attendance.component';

import type { HealthMetricsEngagementGroupAttendance, HealthMetricsEngagementGroupRow } from '@lfx-one/shared/interfaces';

function groupRow(overrides: Partial<HealthMetricsEngagementGroupRow> = {}): HealthMetricsEngagementGroupRow {
  return {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
    projectId: 'p-1',
    projectSlug: 'acme-core',
    projectName: 'Acme Core',
    groupTypeLabel: 'Governance',
    meetingTypeGroup: 'Technical',
    lastMetDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsHeld: 10, invitedCount: 100, attendedCount: 54, attendancePct: 0.54, dormant: false },
      { range: 'COMPLETED_YEAR_2', meetingsHeld: 11, invitedCount: 110, attendedCount: 64, attendancePct: 0.58, dormant: false },
      { range: 'COMPLETED_YEAR', meetingsHeld: 12, invitedCount: 120, attendedCount: 71, attendancePct: 0.59, dormant: false },
      { range: 'YTD', meetingsHeld: 8, invitedCount: 80, attendedCount: 50, attendancePct: 0.62, dormant: false },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsEngagementGroupAttendance> = {}): HealthMetricsEngagementGroupAttendance {
  return {
    rows: [groupRow()],
    totalRecords: 1,
    counts: { groups: 1, dormantGroups: 0, lowAttendanceGroups: 0 },
    typeCounts: [
      { groupType: 'all', groups: 1, dormantGroups: 0 },
      { groupType: 'gov', groups: 1, dormantGroups: 0 },
      { groupType: 'sigtag', groups: 0, dormantGroups: 0 },
      { groupType: 'wg', groups: 0, dormantGroups: 0 },
    ],
    ...overrides,
  };
}

describe('EngagementGroupAttendanceComponent', () => {
  let fixture: ComponentFixture<EngagementGroupAttendanceComponent>;
  let getEngagementGroupAttendance: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let verdicts: boolean[];

  async function render(
    payload: HealthMetricsEngagementGroupAttendance = response(),
    onCounts?: (counts: unknown) => void,
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsEngagementGroupAttendance,
    lifecycle?: string[]
  ): Promise<void> {
    // `payload` answers the first read; `followUpPayload` every read after it, so a clamp or filter
    // change can resolve to a different page than the one that triggered it.
    getEngagementGroupAttendance = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementGroupAttendanceComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementGroupAttendance } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The component reads its initial page off the URL, and writes the page and type back.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementGroupAttendanceComponent);
    // The page parses the type off the URL and binds it in, before the first read.
    if (queryParams['groupType']) fixture.componentRef.setInput('groupType', queryParams['groupType']);
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

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function setType(groupType: string): Promise<void> {
    fixture.componentRef.setInput('groupType', groupType);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    verdicts = [];
  });

  it('reads the selected foundation and period, and renders the returned page', async () => {
    await render();

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      groupType: 'all',
      range: 'YTD',
      page: 1,
      size: 10,
    });
    expect(query('engagement-group-attendance-row-c-1')).not.toBeNull();
    expect(query('engagement-group-attendance-count')).toBeNull();
    expect(verdicts).toEqual([false]);
  });

  // The counts cover the whole filtered set, so they must come from the response, not the page rows.
  it('emits the whole-set counts for the sub-nav note, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 }]);

    emitted.length = 0;
    await setType('wg');

    // The in-flight null clears the note rather than leaving the previous cut's number under a
    // table that is being replaced.
    expect(emitted).toEqual([null, { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 }]);
  });

  it('re-reads from page 1 when the type filter changes, because the rank is per-cut', async () => {
    // `totalRecords` has to cover page 3, or the out-of-range clamp resets the page for us.
    await render(response({ totalRecords: 80 }));
    getEngagementGroupAttendance.mockClear();

    fixture.componentInstance['page'].set(3);
    await setType('wg');

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'wg', page: 1 }));
  });

  it('re-reads from page 1 when the period changes, since the page came from the wider scope', async () => {
    await render(response({ totalRecords: 80 }));
    fixture.componentInstance['page'].set(3);
    fixture.detectChanges();
    await fixture.whenStable();
    getEngagementGroupAttendance.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', page: 1 }));
  });

  it('draws each group with its kind under the name, its meetings, last meeting and attendance bar', async () => {
    await render(
      response({
        rows: [
          groupRow(),
          groupRow({ committeeId: 'c-4', groupTypeLabel: 'Governance', meetingTypeGroup: 'Board' }),
          groupRow({ committeeId: 'c-5', groupTypeLabel: 'SIG / TAG' }),
        ],
      })
    );

    const cells = (query('engagement-group-attendance-row-c-1') as HTMLElement).querySelectorAll('td');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-text"]')?.textContent).toBe('Technical Steering Committee');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Oversight committee');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-description"] i')?.className).toContain('fa-shield-check');
    expect(cells[1].textContent?.trim()).toBe('8');
    expect(cells[2].textContent?.trim()).toBe('Aug 14, 2026');
    expect(cells[3].textContent).toContain('62%');
    expect(cells[3].querySelector('[data-testid="health-metrics-value-bar-fill"]')?.className).toContain('bg-blue-500');
    expect(query('engagement-group-attendance-row-c-4')?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Board');
    expect(query('engagement-group-attendance-row-c-5')?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe(
      'SIG / TAG'
    );
  });

  it('shows a dash for a group with no meetings and no rate', async () => {
    const quiet = groupRow({
      committeeId: 'c-6',
      periods: [{ range: 'YTD', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: false }],
    });
    await render(response({ rows: [quiet] }));

    const cells = (query('engagement-group-attendance-row-c-6') as HTMLElement).querySelectorAll('td');
    expect(cells[1].textContent?.trim()).toBe('—');
    expect(cells[3].textContent?.trim()).toBe('—');
    expect(cells[3].querySelector('[data-testid="health-metrics-value-bar-fill"]')).toBeNull();
  });

  // A `DatePipe` render of the date-only value reads a day early west of UTC, so the label is
  // precomputed against a UTC-anchored parse instead.
  it('renders the last-met date on its own calendar day, and an em dash when a group never met', async () => {
    await render(response({ rows: [groupRow(), groupRow({ committeeId: 'c-3', lastMetDate: null })] }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]').textContent).toContain('Aug 14, 2026');
    expect(fixture.componentInstance['rowViews']()[1]?.lastMetLabel).toBe('\u2014');
  });

  it('shows the Dormant badge with its tooltip instead of a bar, since a group that never met has no rate to draw', async () => {
    const dormant = groupRow({
      committeeId: 'c-2',
      periods: [{ range: 'YTD', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: true }],
    });
    await render(response({ rows: [dormant], counts: { groups: 1, dormantGroups: 1, lowAttendanceGroups: 0 } }));

    const row = query('engagement-group-attendance-row-c-2') as HTMLElement;
    const badge = row.querySelector('[data-testid="engagement-group-attendance-dormant-c-2"]') as HTMLElement;
    expect(badge.tagName).toBe('LFX-UI-BADGE');
    expect(badge.textContent?.trim()).toBe('Dormant');
    expect(badge.getAttribute('tabindex')).toBe('0');
    // The name is the label alone; the tooltip supplies the explanation as the description, so it is read once.
    expect(badge.getAttribute('aria-label')).toBe('Dormant');
    expect(row.querySelector('[data-testid="health-metrics-value-bar-fill"]')).toBeNull();
    expect(row.textContent).not.toContain('No meetings this period');
  });

  // The design drops the drawer: rows carry no click, focus or hover.
  it('keeps rows plain, with no drawer to open', async () => {
    await render();

    const row = query('engagement-group-attendance-row-c-1') as HTMLElement;
    expect(row.getAttribute('tabindex')).toBeNull();
    expect(row.classList).not.toContain('cursor-pointer');
    expect(fixture.nativeElement.querySelector('lfx-engagement-group-attendance-drawer')).toBeNull();
  });

  it('pages ten groups at a time with the numbered pager', async () => {
    await render(response({ totalRecords: 34 }));

    expect(query('ui-pagination-info')?.textContent?.trim()).toBe('Showing 1 to 10 of 34');
    getEngagementGroupAttendance.mockClear();

    (fixture.nativeElement.querySelectorAll('[data-testid="ui-pagination-page"]')[2] as HTMLElement).querySelector('button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ page: 3, size: 10 }));
  });

  it('settles an unmeasured scope empty, with no body', async () => {
    await render(response({ rows: [], totalRecords: 0, counts: null }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-table"]')).toBeNull();
    // The filter-miss card is not the scope's empty state.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).toBeNull();
  });

  // A failed read must not render the copy that asserts the foundation has no matching groups.
  it('separates a failed read from an empty one, and keeps the note off a fabricated zero', async () => {
    const emitted: unknown[] = [];
    await render(response(), (counts) => emitted.push(counts));
    getEngagementGroupAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));

    await setType('wg');

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).toBeNull();
    expect(emitted.at(-1)).toBeNull();
  });

  // The failure is per query, so the outer pipeline must survive it and serve the next one.
  it('recovers on the next query after a failed read', async () => {
    await render();
    getEngagementGroupAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));
    await setType('wg');

    getEngagementGroupAttendance.mockReturnValue(of(response()));
    await setType('gov');

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]')).not.toBeNull();
  });

  // The default response's zeroes are not a measured count, so an unread section must stay null —
  // settling is reported separately, since a read with nothing to count still ends.
  it('emits no counts while no foundation is selected, since nothing was read', async () => {
    const emitted: unknown[] = [];
    selectedFoundation.set(null);
    await render(response(), (counts) => emitted.push(counts));

    expect(getEngagementGroupAttendance).not.toHaveBeenCalled();
    expect(emitted.every((counts) => counts === null)).toBe(true);
    // An unresolved foundation is not a foundation with no groups matching the filter — the table
    // holds its loading state rather than the section rendering empty or errored.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-table"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-error"]')).toBeNull();
    expect(fixture.componentInstance['loading']()).toBe(true);
  });

  // The URL is the only carrier of table state across a reload or a shared link.
  it('starts on the page the URL carries, with the type the page binds in', async () => {
    await render(response({ totalRecords: 80 }), undefined, { groupType: 'wg', groupPage: '3' });

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'wg', page: 3 }));
  });

  it('falls back to page 1 for a URL page it cannot honour', async () => {
    await render(response(), undefined, { groupPage: '-2' });

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'all', page: 1 }));
  });

  // The totals join still reports the real count for a page past the end, so leaving the page alone
  // would render an empty table under "34 groups".
  it('lands on the last page holding rows when the URL page is past the end', async () => {
    await render(response({ rows: [], totalRecords: 34, counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } }), undefined, { groupPage: '9' });

    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 9 }));
    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 4 }));
    // The re-read is already on the last page, so it must settle there rather than clamp again.
    expect(getEngagementGroupAttendance).toHaveBeenCalledTimes(2);
  });

  // A clamped read is not a settled read: non-null counts would let the container's deep link settle
  // against the empty table the follow-up page is about to replace.
  it('reports no counts until the clamped page arrives', async () => {
    const emissions: unknown[] = [];
    await render(
      response({ rows: [], totalRecords: 34, counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } }),
      (counts) => emissions.push(counts),
      { groupPage: '9' },
      response({ totalRecords: 34, counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } })
    );

    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 4 }));
    // One null per read; the counts arrive only with the page that has rows.
    expect(emissions).toEqual([null, null, { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 }]);
    // The clamped page is the first settled render, so "34 groups" never sits over an empty table.
    expect(fixture.componentInstance['loading']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]')).not.toBeNull();
  });

  // The container releases a deep link only once every section has settled, so a read that ends
  // with no counts to report — a failure, or no foundation — still has to say it ended.
  it('settles a failed read, which reports no counts at all', async () => {
    const lifecycle: string[] = [];
    await render(response(), undefined, {}, undefined, lifecycle);
    lifecycle.length = 0;
    getEngagementGroupAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));

    await setType('wg');

    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  // A clamp fires a follow-up fetch, so the first response is not a settled read — settling there
  // would let a deep link anchor against the empty table the replacement page is about to fill.
  it('settles once across a clamp, on the page that has rows', async () => {
    const lifecycle: string[] = [];
    await render(
      response({ rows: [], totalRecords: 34, counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } }),
      undefined,
      { groupPage: '9' },
      response({ totalRecords: 34, counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 0 } }),
      lifecycle
    );

    // The clamp's own read re-holds the deep link and does not settle; the follow-up page does.
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
  });

  it('writes the filter and page back to the URL, dropping each at its default', async () => {
    await render(response({ totalRecords: 200 }), undefined, { groupType: 'wg', groupPage: '3' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onPageChange'](3);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { groupType: 'wg', groupPage: 4 }, preserveFragment: true, replaceUrl: true })
    );

    // A default is written as null so it leaves the URL rather than pinning a redundant param.
    await setType('all');

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { groupType: null, groupPage: null } }));
  });

  // Clamping here would re-read page 1 for a set that has no rows on any page.
  it('settles on an out-of-range page when the filtered set is empty, without re-reading', async () => {
    await render(response({ rows: [], totalRecords: 0, counts: { groups: 0, dormantGroups: 0, lowAttendanceGroups: 0 } }), undefined, { groupPage: '9' });

    expect(getEngagementGroupAttendance).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).not.toBeNull();
  });

  // Otherwise a reload or a shared link keeps sending the reader to the page that has no rows.
  it.each([
    [34, 4],
    [8, null],
  ])('rewrites the URL page when it clamps a set of %i to page %s', async (totalRecords, groupPage) => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await render(
      response({ rows: [], totalRecords, counts: { groups: totalRecords, dormantGroups: 0, lowAttendanceGroups: 0 } }),
      undefined,
      { groupPage: '9' },
      response({ totalRecords })
    );

    // The default page leaves the URL rather than pinning a redundant param.
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { groupType: null, groupPage } }));
  });

  it('renders the empty state rather than an empty table once the read resolves with nothing, and resets the type from it', async () => {
    await render(response({ rows: [], totalRecords: 0, counts: { groups: 0, dormantGroups: 0, lowAttendanceGroups: 0 } }), undefined, { groupType: 'wg' });

    const empty = query('engagement-group-attendance-empty') as HTMLElement;
    expect(empty.textContent).toContain('No groups of this type');
    expect(empty.textContent).toContain('This foundation has no groups matching the selected filter.');
    expect(query('engagement-group-attendance-table')).toBeNull();

    (empty.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    expect(fixture.componentInstance.groupType()).toBe('all');
  });
});
