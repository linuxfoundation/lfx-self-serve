// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementNonMemberParticipationComponent } from './engagement-non-member-participation.component';

import type {
  HealthMetricsEngagementNonMemberParticipation,
  HealthMetricsEngagementNonMemberPeriodCounts,
  HealthMetricsEngagementNonMemberRow,
} from '@lfx-one/shared/interfaces';

function nonMemberRow(overrides: Partial<HealthMetricsEngagementNonMemberRow> = {}): HealthMetricsEngagementNonMemberRow {
  return {
    accountId: 'a-1',
    accountName: 'Acme Motors',
    membershipStatus: 'Non-member',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsAttended: 3, distinctPeople: 1, sortRank: 4 },
      { range: 'COMPLETED_YEAR_2', meetingsAttended: 5, distinctPeople: 2, sortRank: 3 },
      { range: 'COMPLETED_YEAR', meetingsAttended: 8, distinctPeople: 3, sortRank: 2 },
      { range: 'YTD', meetingsAttended: 12, distinctPeople: 4, sortRank: 1 },
    ],
    ...overrides,
  };
}

/** The view's per-period caption counts; the completed years default to the YTD count. */
function periodCounts(ytd: number, completedYear = ytd): HealthMetricsEngagementNonMemberPeriodCounts[] {
  return [
    { range: 'COMPLETED_YEAR_3', orgs: ytd },
    { range: 'COMPLETED_YEAR_2', orgs: ytd },
    { range: 'COMPLETED_YEAR', orgs: completedYear },
    { range: 'YTD', orgs: ytd },
  ];
}

function response(overrides: Partial<HealthMetricsEngagementNonMemberParticipation> = {}): HealthMetricsEngagementNonMemberParticipation {
  return { rows: [nonMemberRow()], counts: periodCounts(1), ...overrides };
}

describe('EngagementNonMemberParticipationComponent', () => {
  let fixture: ComponentFixture<EngagementNonMemberParticipationComponent>;
  let getEngagementNonMemberParticipation: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let verdicts: boolean[];

  async function render(
    payload: HealthMetricsEngagementNonMemberParticipation | Error = response(),
    onCounts?: (counts: unknown) => void,
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementNonMemberParticipation = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementNonMemberParticipationComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementNonMemberParticipation } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementNonMemberParticipationComponent);
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

  it('reads the selected foundation and renders the returned rows', async () => {
    await render();

    expect(getEngagementNonMemberParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-row-a-1"]');
    expect(row.textContent).toContain('Acme Motors');
    expect(row.textContent).toContain('12');
    expect(row.textContent).toContain('Non-member');
    expect(verdicts).toEqual([false]);
  });

  // The design's columns: no First seen or Last attended.
  it('renders the organization, meetings, people and membership columns only', async () => {
    await render();

    const headers = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="engagement-non-member-participation-table"] th')) as HTMLElement[];
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Organization', 'Meetings attended', 'People', 'Membership']);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="engagement-non-member-participation-row-a-1"] td')).toHaveLength(4);
  });

  it('shows membership as the small hollow-dot status, with the glyph hidden from assistive tech', async () => {
    await render();

    const status = fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-row-a-1-status"]') as HTMLElement;
    expect(status.textContent?.replace(/\s+/g, ' ').trim()).toBe('○ Non-member');
    expect(status.className).toContain('text-[12px]');
    expect(status.className).toContain('text-gray-400');
    expect(status.className).toContain('lg:whitespace-nowrap');
    expect(status.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('○');
  });

  // The period pill re-projects the loaded rows, so switching it must not cost another request.
  it('re-projects the loaded rows when the period changes, without re-reading', async () => {
    await render();
    getEngagementNonMemberParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(getEngagementNonMemberParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-row-a-1"]').textContent).toContain('8');
  });

  // The rank is per period, so the pill has to re-order the loaded rows, not just re-read their cells.
  it('re-sorts by the selected period rank', async () => {
    const rows = [
      nonMemberRow({ accountId: 'a-1', accountName: 'Acme Motors', periods: [{ range: 'YTD', meetingsAttended: 2, distinctPeople: 1, sortRank: 2 }] }),
      nonMemberRow({ accountId: 'b-2', accountName: 'Vendor Corp', periods: [{ range: 'YTD', meetingsAttended: 9, distinctPeople: 4, sortRank: 1 }] }),
    ];
    await render(response({ rows, counts: periodCounts(2) }));

    const names = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')).map((row) => (row as HTMLElement).textContent?.trim() ?? '');
    expect(names[0]).toContain('Vendor Corp');
    expect(names[1]).toContain('Acme Motors');
  });

  // Every row moves when the pill changes, so a reader left on page 8 would land on unrelated orgs.
  it('restarts paging when the period re-orders the table, without re-reading', async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      nonMemberRow({
        accountId: `a-${index}`,
        accountName: `Org ${index}`,
        periods: [{ range: 'YTD', meetingsAttended: 1, distinctPeople: 1, sortRank: index }],
      })
    );
    await render(response({ rows, counts: periodCounts(60) }));
    getEngagementNonMemberParticipation.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    expect(fixture.componentInstance['first']()).toBe(50);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(fixture.componentInstance['first']()).toBe(0);
    expect(getEngagementNonMemberParticipation).not.toHaveBeenCalled();
  });

  it('emits the selected period scope count for the sub-nav badge, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: periodCounts(19, 33) }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, { range: 'YTD', orgs: 19 }]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('19 organizations');
  });

  // The view counts its scope per period, so the caption and badge follow the pill without a re-read.
  it('re-captions and re-reports the badge when the period changes', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: periodCounts(19, 33) }), (counts) => emitted.push(counts));
    getEngagementNonMemberParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getEngagementNonMemberParticipation).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toEqual({ range: 'COMPLETED_YEAR', orgs: 33 });
    // The period re-settles too, since whether it has any non-member moves the section's height.
    expect(verdicts).toEqual([false, false]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('33 organizations');
  });

  // The caption counts organizations that attended in the period, so the table lists the same ones.
  it('lists only organizations that attended a meeting in the selected period', async () => {
    const rows = [
      nonMemberRow({ accountId: 'a-1', accountName: 'Acme Motors' }),
      nonMemberRow({
        accountId: 'b-2',
        accountName: 'Vendor Corp',
        periods: [
          { range: 'COMPLETED_YEAR', meetingsAttended: 4, distinctPeople: 2, sortRank: 1 },
          { range: 'YTD', meetingsAttended: 0, distinctPeople: 0, sortRank: 2 },
        ],
      }),
    ];
    await render(response({ rows, counts: periodCounts(1, 2) }));
    const rowIds = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('tbody tr')).map((row) => (row as HTMLElement).getAttribute('data-testid') ?? '');

    expect(rowIds()).toEqual(['engagement-non-member-participation-row-a-1']);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(rowIds()).toEqual(['engagement-non-member-participation-row-b-2', 'engagement-non-member-participation-row-a-1']);
  });

  // Organizations on record with none active in the period are a measured zero, not an empty foundation.
  it('settles empty, with no body, when no organization attended in the selected period', async () => {
    const rows = [nonMemberRow({ periods: [{ range: 'YTD', meetingsAttended: 0, distinctPeople: 0, sortRank: 1 }] })];
    await render(response({ rows, counts: periodCounts(0) }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-table"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('0 organizations');
  });

  // Null attendance and a null count are unmeasured, so the caption must not claim nobody attended.
  it('settles empty, with no body, when attendance was not measured, captioning an em dash rather than zero', async () => {
    const rows = [nonMemberRow({ periods: [{ range: 'YTD', meetingsAttended: null, distinctPeople: null, sortRank: null }] })];
    await render(response({ rows, counts: null }));

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-table"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('—');
  });

  // A view that reports no scope count has not measured zero organizations, and the table says so.
  it('captions an unmeasured scope with an em dash rather than a confident zero, keeping its rows', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, null]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('—');
    // Unmeasured counts only caption the rows; the table still has them, so the section is not empty.
    expect(verdicts).toEqual([false]);
  });

  // A failed read is not an empty foundation, and the two states must not render the same card.
  it('renders the error state, not the empty state, when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('boom'), (counts) => emitted.push(counts));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-error"]')).not.toBeNull();
    expect(verdicts).toEqual([false]);
    expect(emitted).toEqual([null, null]);
  });

  // The server answers a zero-row read with null counts, so the section settles empty.
  it('settles empty, with no body, for a foundation with no rows', async () => {
    await render(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED);

    expect(verdicts).toEqual([true]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-table"]')).toBeNull();
  });

  // The container holds a deep link's scroll until every section reports, so both ends must fire.
  it('reports each read starting and settling', async () => {
    const lifecycle: string[] = [];
    await render(response(), undefined, lifecycle);

    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton and withholds the settle while no foundation is selected', async () => {
    const emitted: unknown[] = [];
    const lifecycle: string[] = [];
    selectedFoundation.set(null);
    await render(response(), (counts) => emitted.push(counts), lifecycle);

    expect(getEngagementNonMemberParticipation).not.toHaveBeenCalled();
    expect(emitted).toEqual([null, null]);
    // Settling here would release the container's pending deep link before any read has reflowed
    // the pane, and no later read can re-arm a fragment that is already gone.
    expect(lifecycle).toEqual(['reading']);
    expect(fixture.componentInstance['loading']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-error"]')).toBeNull();
  });

  // A foundation arriving late is the deep-link case: the read that follows has to settle it.
  it('reads the new foundation and restarts paging when the selection switches', async () => {
    const lifecycle: string[] = [];
    selectedFoundation.set(null);
    await render(response(), undefined, lifecycle);
    fixture.componentInstance['onTablePage']({ first: 25, rows: 25 });

    selectedFoundation.set({ slug: 'globex' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEngagementNonMemberParticipation).toHaveBeenCalledWith({ foundationSlug: 'globex' });
    expect(getEngagementNonMemberParticipation).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(fixture.componentInstance['first']()).toBe(0);
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
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-table"]')).toBeNull();
  });
});
