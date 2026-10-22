// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementAttendanceTrendComponent } from './engagement-attendance-trend.component';

import type { ChartData } from 'chart.js';
import type { HealthMetricsEngagementAttendanceMonth, HealthMetricsEngagementAttendanceTrend } from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '<div data-testid="chart-stub"></div>' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'line'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

/** Twelve months ending with the current UTC month, as the view's rolling window does. */
function window12(rate: (index: number) => number | null = (index) => 0.4 + index * 0.01): HealthMetricsEngagementAttendanceMonth[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const monthStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1)).toISOString().slice(0, 10);
    const attendancePct = rate(index);
    return {
      monthStartDate,
      meetingsHeld: attendancePct === null ? 0 : 10,
      invited: 100,
      attended: 50,
      attendancePct,
      attendanceChangePp: index === 0 ? null : 0.01,
    };
  });
}

describe('EngagementAttendanceTrendComponent', () => {
  let fixture: ComponentFixture<EngagementAttendanceTrendComponent>;
  let getEngagementAttendanceTrend: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];

  async function render(payload: HealthMetricsEngagementAttendanceTrend | Error = { months: window12() }): Promise<void> {
    getEngagementAttendanceTrend = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementAttendanceTrendComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEngagementAttendanceTrend } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    })
      .overrideComponent(EngagementAttendanceTrendComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(EngagementAttendanceTrendComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(testId: string): string {
    return (fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function chartData(): ChartData<'line'> | null {
    return (fixture.debugElement.query(By.directive(ChartStubComponent))?.componentInstance as ChartStubComponent | undefined)?.data() ?? null;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
  });

  it('reads the foundation roll-up and reports the read starting and settling', async () => {
    await render();

    expect(getEngagementAttendanceTrend).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: null });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(text('engagement-attendance-trend-window')).toBe('Last 12 months');
  });

  // The month in progress is plotted but never headlines, so the hero reads the eleventh month.
  it('headlines the latest full month with the view change and the side stats', async () => {
    await render();

    expect(text('engagement-attendance-trend-latest')).toBe('50%');
    expect(text('engagement-attendance-trend-delta')).toBe('+1.0pp vs previous month');
    expect(text('engagement-attendance-trend-change')).toBe('+10.0pp');
    expect(text('engagement-attendance-trend-high')).toBe('50%');
    expect(text('engagement-attendance-trend-low')).toBe('40%');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-low-confidence"]')).toBeNull();
  });

  it('plots every month, gapping unrated ones, and lists them for screen readers', async () => {
    await render({ months: window12((index) => (index === 3 ? null : 0.5)) });

    const data = chartData()?.datasets[0]?.data ?? [];
    expect(data).toHaveLength(12);
    expect(data[3]).toBeNull();
    expect(data[4]).toBeCloseTo(50);

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="engagement-attendance-trend-table"] tbody tr');
    expect(rows).toHaveLength(12);
    expect(rows[11].textContent).toContain('(to date)');
    expect(rows[3].textContent).toContain('—');
  });

  it('draws the line under a low-confidence banner when fewer than six months have a rate', async () => {
    await render({ months: window12((index) => (index < 8 ? null : 0.5)) });

    expect(text('engagement-attendance-trend-low-confidence')).toContain('Only 4 of the last 12 months have attendance');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-chart"]')).not.toBeNull();
  });

  it('shows a not-enough-data card, and no chart, for a single rated month', async () => {
    await render({ months: window12((index) => (index === 5 ? 0.5 : null)) });

    expect(text('engagement-attendance-trend-insufficient')).toContain('Not enough data to chart a trend');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-chart"]')).toBeNull();
  });

  it('shows the empty state when no month has a rate', async () => {
    await render({ months: window12(() => null) });

    expect(text('engagement-attendance-trend-empty')).toContain('No meeting attendance in the last 12 months');
  });

  // A failed read is not a foundation without meetings, and the two states must not render the same card.
  it('renders the error state, not the empty state, when the read fails', async () => {
    await render(new Error('boom'));

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-empty"]')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  // The trend follows the project selector, but its window is fixed, so the period pill costs no request.
  it('re-reads for a project but not for a period change', async () => {
    await render();
    getEngagementAttendanceTrend.mockClear();
    const chrome = TestBed.inject(HealthMetricsChromeService);

    chrome.selectedRange.set('COMPLETED_YEAR');
    await settle();
    expect(getEngagementAttendanceTrend).not.toHaveBeenCalled();

    chrome.selectedProjectSlug.set('acme-core');
    await settle();
    expect(getEngagementAttendanceTrend).toHaveBeenCalledWith({ foundationSlug: 'acme', projectSlug: 'acme-core' });
  });

  // A tab left open across a month boundary must not headline the new month's partial attendance.
  it('re-judges the month in progress on every read, so a month rollover is seen', async () => {
    await render();
    const now = new Date();
    fixture.componentInstance['today'].set(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
    fixture.detectChanges();
    // A stale date treats the current month (51%) as complete, so it headlines.
    expect(text('engagement-attendance-trend-latest')).toBe('51%');

    TestBed.inject(HealthMetricsChromeService).selectedProjectSlug.set('acme-core');
    await settle();

    expect(text('engagement-attendance-trend-latest')).toBe('50%');
  });

  it('holds the skeleton and withholds the settle while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render(HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED);

    expect(getEngagementAttendanceTrend).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['reading']);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-attendance-trend-loading"]')).not.toBeNull();
  });
});
