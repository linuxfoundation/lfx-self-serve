// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('reads the selected foundation and renders the returned rows', async () => {
    await render();

    expect(getEngagementOrgParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]');
    expect(row.textContent).toContain('Acme Motors');
    expect(row.textContent).toContain('21 / 27');
    expect(row.textContent).toContain('1.8');
    expect(row.textContent).toContain('Aug 14, 2026');
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

    fixture.componentInstance['searchForm'].controls.search.setValue('vendor');
    fixture.detectChanges();

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-org-participation-row-a-2"]')).not.toBeNull();
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

  it('reports no counts and still settles when no foundation is selected', async () => {
    const emitted: unknown[] = [];
    const lifecycle: string[] = [];
    selectedFoundation = signal<{ slug: string } | null>(null);
    await render(response(), (counts) => emitted.push(counts), {}, lifecycle);

    expect(getEngagementOrgParticipation).not.toHaveBeenCalled();
    expect(emitted).toEqual([null, null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });
});
