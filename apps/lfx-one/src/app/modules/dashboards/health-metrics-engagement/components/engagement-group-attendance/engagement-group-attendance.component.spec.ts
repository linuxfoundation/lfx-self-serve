// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
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
  return { rows: [groupRow()], totalRecords: 1, counts: { groups: 1, dormantGroups: 0, lowAttendanceGroups: 0 }, ...overrides };
}

describe('EngagementGroupAttendanceComponent', () => {
  let fixture: ComponentFixture<EngagementGroupAttendanceComponent>;
  let getEngagementGroupAttendance: ReturnType<typeof vi.fn>;

  async function render(payload: HealthMetricsEngagementGroupAttendance = response(), onCounts?: (counts: unknown) => void): Promise<void> {
    getEngagementGroupAttendance = vi.fn().mockReturnValue(of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementGroupAttendanceComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEngagementGroupAttendance } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
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
  it('emits the whole-set counts for the sub-nav badges', async () => {
    const emitted: unknown[] = [];
    await render(response({ counts: { groups: 34, dormantGroups: 3, lowAttendanceGroups: 5 } }), (counts) => emitted.push(counts));

    expect(emitted.at(-1)).toEqual({ groups: 34, dormantGroups: 3, lowAttendanceGroups: 5 });
  });

  it('re-reads from page 1 when the type filter changes, because the rank is per-cut', async () => {
    await render();
    getEngagementGroupAttendance.mockClear();

    fixture.componentInstance['page'].set(3);
    fixture.componentInstance['onFilterChange']('wg');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getEngagementGroupAttendance).toHaveBeenCalledWith(expect.objectContaining({ groupType: 'wg', page: 1 }));
  });

  it('shows the Dormant badge instead of a bar, since a group that never met has no rate to draw', async () => {
    const dormant = groupRow({
      committeeId: 'c-2',
      periods: [{ range: 'YTD', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: true }],
    });
    await render(response({ rows: [dormant], counts: { groups: 1, dormantGroups: 1, lowAttendanceGroups: 0 } }));

    const row = fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-row-c-2"]');
    expect(row.textContent).toContain('No meetings this period');
    expect(row.textContent).toContain('Dormant');
    expect(row.querySelector('[data-testid="engagement-attendance-bar"]')).toBeNull();
  });

  it('renders the empty state rather than an empty table once the read resolves with nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, counts: { groups: 0, dormantGroups: 0, lowAttendanceGroups: 0 } }));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-group-attendance-table"]')).toBeNull();
  });
});
