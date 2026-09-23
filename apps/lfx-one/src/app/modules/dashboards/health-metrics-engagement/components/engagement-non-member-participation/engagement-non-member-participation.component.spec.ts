// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementNonMemberParticipationComponent } from './engagement-non-member-participation.component';

import type { HealthMetricsEngagementNonMemberParticipation, HealthMetricsEngagementNonMemberRow } from '@lfx-one/shared/interfaces';

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

function response(overrides: Partial<HealthMetricsEngagementNonMemberParticipation> = {}): HealthMetricsEngagementNonMemberParticipation {
  return { rows: [nonMemberRow()], counts: { orgs: 1 }, ...overrides };
}

describe('EngagementNonMemberParticipationComponent', () => {
  let fixture: ComponentFixture<EngagementNonMemberParticipationComponent>;
  let getEngagementNonMemberParticipation: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

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
        { provide: AnalyticsService, useValue: { getEngagementNonMemberParticipation } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementNonMemberParticipationComponent);
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

    expect(getEngagementNonMemberParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    const row = fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-row-a-1"]');
    expect(row.textContent).toContain('Acme Motors');
    expect(row.textContent).toContain('12');
    expect(row.textContent).toContain('Non-member');
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
    await render(response({ rows, counts: { orgs: 2 } }));

    const names = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')).map((row) => (row as HTMLElement).textContent?.trim() ?? '');
    expect(names[0]).toContain('Vendor Corp');
    expect(names[1]).toContain('Acme Motors');
  });

  it('emits the scope count for the sub-nav badge, and nothing while a read is in flight', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { orgs: 63 } }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, { orgs: 63 }]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('63 organizations');
  });

  // A view that reports no scope count has not measured zero organizations, and the table says so.
  it('captions an unmeasured scope with an em dash rather than a confident zero', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: null }), (counts) => emitted.push(counts));

    expect(emitted).toEqual([null, null]);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-count"]').textContent.trim()).toBe('—');
  });

  // A failed read is not an empty foundation, and the two states must not render the same card.
  it('renders the error state, not the empty state, when the read fails', async () => {
    const emitted: unknown[] = [];
    await render(new Error('boom'), (counts) => emitted.push(counts));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-empty"]')).toBeNull();
    expect(emitted).toEqual([null, null]);
  });

  it('renders the empty state for a measured foundation with no non-member organizations', async () => {
    await render(response({ rows: [], counts: { orgs: 0 } }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-empty"]')).not.toBeNull();
  });

  // The container holds a deep link's scroll until every section reports, so both ends must fire.
  it('reports each read starting and settling', async () => {
    const lifecycle: string[] = [];
    await render(response(), undefined, lifecycle);

    expect(lifecycle).toEqual(['reading', 'settled']);
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
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-non-member-participation-empty"]')).not.toBeNull();
  });
});
