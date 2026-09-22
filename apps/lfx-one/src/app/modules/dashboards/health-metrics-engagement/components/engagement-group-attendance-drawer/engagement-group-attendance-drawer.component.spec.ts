// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { buildHealthMetricsOverviewPeriods } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { EngagementGroupAttendanceDrawerComponent } from './engagement-group-attendance-drawer.component';

import type { HealthMetricsEngagementGroupRow } from '@lfx-one/shared/interfaces';

function groupRow(overrides: Partial<HealthMetricsEngagementGroupRow> = {}): HealthMetricsEngagementGroupRow {
  return {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
    projectSlug: 'acme-core',
    projectName: 'Acme Core',
    groupTypeLabel: 'Technical Steering Committee',
    lastMetDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR', meetingsHeld: 12, invitedCount: 120, attendedCount: 71, attendancePct: 0.59, dormant: false },
      { range: 'YTD', meetingsHeld: 8, invitedCount: 80, attendedCount: 50, attendancePct: 0.62, dormant: false },
    ],
    ...overrides,
  };
}

describe('EngagementGroupAttendanceDrawerComponent', () => {
  async function render(row: HealthMetricsEngagementGroupRow | null): Promise<ComponentFixture<EngagementGroupAttendanceDrawerComponent>> {
    await TestBed.configureTestingModule({
      imports: [EngagementGroupAttendanceDrawerComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    const fixture = TestBed.createComponent(EngagementGroupAttendanceDrawerComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the row already in hand, most recent period first', async () => {
    const fixture = await render(groupRow());
    const periods = fixture.componentInstance['periods']();

    expect(periods.map((period) => period.range)).toEqual(['YTD', 'COMPLETED_YEAR']);
    // Labels come from the Overview's own period options, so the drawer cannot drift from the pill.
    expect(periods[0]?.label).toBe(buildHealthMetricsOverviewPeriods().find((period) => period.range === 'YTD')?.label);
  });

  it('falls back to the raw range when a period has no matching label option', async () => {
    const fixture = await render(
      groupRow({ periods: [{ range: 'COMPLETED_YEAR_4', meetingsHeld: 4, invitedCount: 40, attendedCount: 20, attendancePct: 0.5, dormant: false }] })
    );

    expect(fixture.componentInstance['periods']()[0]?.label).toBe('COMPLETED_YEAR_4');
  });

  // Same UTC-anchored parse as the table: a `DatePipe` render would drift a day west of UTC.
  it('renders the last-met date on its own calendar day, and "Never" without one', async () => {
    const fixture = await render(groupRow());
    expect(fixture.componentInstance['lastMetLabel']()).toBe('Aug 14, 2026');

    fixture.componentRef.setInput('row', groupRow({ lastMetDate: null }));
    expect(fixture.componentInstance['lastMetLabel']()).toBe('Never');
  });

  it('renders no body and no periods without a selected row', async () => {
    const fixture = await render(null);

    expect(fixture.componentInstance['periods']()).toEqual([]);
    expect(document.querySelector('[data-testid="engagement-group-drawer-body"]')).toBeNull();
  });
});
