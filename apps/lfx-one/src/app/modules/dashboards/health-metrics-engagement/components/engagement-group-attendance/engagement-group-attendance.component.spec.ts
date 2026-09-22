// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementGroupAttendanceComponent } from './engagement-group-attendance.component';

import type { HealthMetricsEngagementGroupAttendance, HealthMetricsEngagementGroupRow } from '@lfx-one/shared/interfaces';

function groupRow(overrides: Partial<HealthMetricsEngagementGroupRow> = {}): HealthMetricsEngagementGroupRow {
  return {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
    projectSlug: 'acme-core',
    projectName: 'Acme Core',
    groupTypeLabel: 'Technical Steering Committee',
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
  return { rows: [groupRow()], totalRecords: 1, counts: { groups: 1, dormantGroups: 0 }, ...overrides };
}

describe('EngagementGroupAttendanceComponent', () => {
  let fixture: ComponentFixture<EngagementGroupAttendanceComponent>;
  let getEngagementGroupAttendance: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  async function render(
    payload: HealthMetricsEngagementGroupAttendance = response(),
    onCounts?: (counts: unknown) => void,
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsEngagementGroupAttendance
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
        // The drawer this table opens is a PrimeNG p-drawer, whose panel animation needs a provider.
        provideNoopAnimations(),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEngagementGroupAttendance } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        // The component reads its initial filter and page off the URL, and writes them back.
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementGroupAttendanceComponent);
    if (onCounts) fixture.componentInstance.countsChange.subscribe(onCounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
  });

  it('reads the selected foundation and period, and renders the returned page', async () => {
    await render();

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      projectSlug: null,
      groupType: 'all',
      range: 'YTD',
      page: 1,
      size: 25,
    });
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-count"]').textContent.trim()).toBe('1 group');
  });

  // The counts cover the whole filtered set, so they must come from the response, not the page rows.
  it('emits the whole-set counts for the sub-nav badges, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { groups: 34, dormantGroups: 3 } }), (counts) => emitted.push(counts));

    expect(emitted.at(-1)).toEqual({ groups: 34, dormantGroups: 3 });

    fixture.componentInstance['loading'].set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // The default response's zeroes would otherwise render as a believable "0 groups" badge.
    expect(emitted.at(-1)).toBeNull();
  });

  it('re-reads from page 1 when the type filter changes, because the rank is per-cut', async () => {
    // `totalRecords` has to cover page 3, or the out-of-range clamp resets the page for us.
    await render(response({ totalRecords: 80 }));
    getEngagementGroupAttendance.mockClear();

    fixture.componentInstance['page'].set(3);
    fixture.componentInstance['onFilterChange']('wg');
    fixture.detectChanges();
    await fixture.whenStable();

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

  // A `DatePipe` render of the date-only value reads a day early west of UTC, so the label is
  // precomputed against a UTC-anchored parse instead.
  it('renders the last-met date on its own calendar day, and an em dash when a group never met', async () => {
    await render(response({ rows: [groupRow(), groupRow({ committeeId: 'c-3', lastMetDate: null })] }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]').textContent).toContain('Aug 14, 2026');
    expect(fixture.componentInstance['rowViews']()[1]?.lastMetLabel).toBe('\u2014');
  });

  it('shows the Dormant badge instead of a bar, since a group that never met has no rate to draw', async () => {
    const dormant = groupRow({
      committeeId: 'c-2',
      periods: [{ range: 'YTD', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: true }],
    });
    await render(response({ rows: [dormant], counts: { groups: 1, dormantGroups: 1 } }));

    const row = fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-2"]');
    expect(row.textContent).toContain('No meetings this period');
    expect(row.textContent).toContain('Dormant');
    expect(row.querySelector('[data-testid="engagement-attendance-bar"]')).toBeNull();
  });

  // lfx-table resolves the clicked row through `data-row-index`; without it the drawer is unreachable.
  it('opens the drawer on the row the user clicked', async () => {
    await render();

    const row = fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]');
    expect(row.getAttribute('data-row-index')).toBe('0');
    row.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['drawerVisible']()).toBe(true);
    expect(fixture.componentInstance['selectedRow']()?.committeeId).toBe('c-1');
  });

  it('opens the drawer from the keyboard, so the detail is not mouse-only', async () => {
    await render();

    const row = fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]');
    expect(row.getAttribute('tabindex')).toBe('0');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance['drawerVisible']()).toBe(true);
    expect(fixture.componentInstance['selectedRow']()?.committeeId).toBe('c-1');
  });

  it('opens the drawer on Space and swallows the keypress, so the pane does not page down under it', async () => {
    await render();

    const row = fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    fixture.detectChanges();

    expect(fixture.componentInstance['drawerVisible']()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('holds the count back while a read is in flight, so it never reads zero mid-fetch', async () => {
    await render();
    fixture.componentInstance['loading'].set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-count"]').textContent.trim()).toBe('\u2014');
  });

  // A failed read must not render the copy that asserts the foundation has no matching groups.
  it('separates a failed read from an empty one, and keeps the badges and count off a fabricated zero', async () => {
    const emitted: unknown[] = [];
    await render(response(), (counts) => emitted.push(counts));
    getEngagementGroupAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onFilterChange']('wg');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-count"]').textContent.trim()).toBe('\u2014');
    expect(emitted.at(-1)).toBeNull();
  });

  // The failure is per query, so the outer pipeline must survive it and serve the next one.
  it('recovers on the next query after a failed read', async () => {
    await render();
    getEngagementGroupAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));
    fixture.componentInstance['onFilterChange']('wg');
    fixture.detectChanges();
    await fixture.whenStable();

    getEngagementGroupAttendance.mockReturnValue(of(response()));
    fixture.componentInstance['onFilterChange']('gov');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-1"]')).not.toBeNull();
  });

  // The default response's zeroes are not a measured count, and a deep link waiting on this section
  // is settled by the first non-null emission — so an unread section must stay null.
  it('emits no counts while no foundation is selected, since nothing was read', async () => {
    const emitted: unknown[] = [];
    selectedFoundation.set(null);
    await render(response(), (counts) => emitted.push(counts));

    expect(getEngagementGroupAttendance).not.toHaveBeenCalled();
    expect(emitted.every((counts) => counts === null)).toBe(true);
  });

  // The URL is the only carrier of table state across a reload or a shared link.
  it('starts on the page and filter the URL carries', async () => {
    await render(response({ totalRecords: 80 }), undefined, { groupType: 'wg', groupPage: '3' });

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'wg', page: 3 }));
  });

  it('falls back to the defaults for URL values it cannot honour', async () => {
    await render(response(), undefined, { groupType: 'board', groupPage: '-2' });

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'all', page: 1 }));
  });

  // The totals join still reports the real count for a page past the end, so leaving the page alone
  // would render an empty table under "34 groups".
  it('lands on the last page holding rows when the URL page is past the end', async () => {
    await render(response({ rows: [], totalRecords: 34, counts: { groups: 34, dormantGroups: 3 } }), undefined, { groupPage: '9' });

    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 9 }));
    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    // The re-read is already on the last page, so it must settle there rather than clamp again.
    expect(getEngagementGroupAttendance).toHaveBeenCalledTimes(2);
  });

  // A clamped read is not a settled read: non-null counts would let the container's deep link settle
  // against the empty table the follow-up page is about to replace.
  it('reports no counts until the clamped page arrives', async () => {
    const emissions: unknown[] = [];
    await render(
      response({ rows: [], totalRecords: 34, counts: { groups: 34, dormantGroups: 3 } }),
      (counts) => emissions.push(counts),
      { groupPage: '9' },
      response({ totalRecords: 34, counts: { groups: 34, dormantGroups: 3 } })
    );

    expect(getEngagementGroupAttendance).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    expect(emissions.filter((counts) => counts !== null)).toEqual([{ groups: 34, dormantGroups: 3 }]);
  });

  it('writes the filter and page back to the URL, dropping each at its default', async () => {
    await render(response({ totalRecords: 200 }), undefined, { groupType: 'wg', groupPage: '3' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onTablePage']({ first: 75, rows: 25 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { groupType: 'wg', groupPage: 4 }, preserveFragment: true, replaceUrl: true })
    );

    // A default is written as null so it leaves the URL rather than pinning a redundant param.
    fixture.componentInstance['onFilterChange']('all');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { groupType: null, groupPage: null } }));
  });

  it('renders the empty state rather than an empty table once the read resolves with nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, counts: { groups: 0, dormantGroups: 0 } }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-table"]')).toBeNull();
  });
});
