// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementAttendanceTrendComponent } from './engagement-attendance-trend.component';

import type { HealthMetricsEngagementAttendanceMonth, HealthMetricsEngagementAttendanceTrend } from '@lfx-one/shared/interfaces';

/** The design's 2026 sample, January to October; October is still collecting meetings. */
const DESIGN_2026: [number, number][] = [
  [63, 9],
  [48, 21],
  [32, 39],
  [21, 48],
  [19, 40],
  [18, 65],
  [14, 66],
  [12, 74],
  [9, 72],
  [7, 50],
];

function months(year: number, rows: readonly [number | null, number][]): HealthMetricsEngagementAttendanceMonth[] {
  return rows.map(([pct, meetings], index) => ({
    monthStartDate: `${year}-${String(index + 1).padStart(2, '0')}-01`,
    meetingsHeld: meetings,
    invited: 100,
    attended: 50,
    attendancePct: pct === null ? null : pct / 100,
    attendanceChangePp: null,
  }));
}

describe('EngagementAttendanceTrendComponent', () => {
  let fixture: ComponentFixture<EngagementAttendanceTrendComponent>;
  let getEngagementAttendanceTrend: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: (boolean | null)[];

  async function render(payload: HealthMetricsEngagementAttendanceTrend | Error = { months: months(2026, DESIGN_2026) }): Promise<void> {
    getEngagementAttendanceTrend = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementAttendanceTrendComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEngagementAttendanceTrend } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementAttendanceTrendComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  }

  function text(testId: string): string {
    return el(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function selectYear(range: 'YTD' | 'COMPLETED_YEAR'): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    // Only Date is faked, so the design's October 2026 is "now" while timers and the scheduler run for real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the foundation roll-up and reports the read starting and settling', async () => {
    await render();

    expect(getEngagementAttendanceTrend).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('leads year to date with the previous month, the change since January and the highest and lowest rates', async () => {
    await render();

    expect(text('engagement-attendance-trend-metrics-latest-label')).toBe('Previous month (Sep 2026)');
    expect(text('engagement-attendance-trend-metrics-latest-value')).toBe('9%');
    expect(text('engagement-attendance-trend-metrics-latest-description')).toBe('−3pp vs August');
    expect(text('engagement-attendance-trend-metrics-change-value')).toBe('−54pp');
    expect(text('engagement-attendance-trend-metrics-change-description')).toBe('63% in Jan → 9% in Sep');
    expect(text('engagement-attendance-trend-metrics-high-value')).toBe('63%');
    expect(text('engagement-attendance-trend-metrics-low-description')).toBe('September 2026');
    expect(el('engagement-attendance-trend-low-confidence')).toBeNull();
  });

  it('charts January to the month in progress, dashing into it, and lists the months for screen readers', async () => {
    await render();

    expect(el('engagement-attendance-trend-chart-line-in-progress')).not.toBeNull();
    expect(el('engagement-attendance-trend-chart-points')?.getAttribute('aria-label')).toBe('All-meeting attendance by month, 2026');
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="engagement-attendance-trend-table"] tbody tr');
    expect(rows).toHaveLength(10);
    expect(rows[9].textContent).toContain('October 2026 (to date)');
    expect(text('engagement-attendance-trend-table')).toContain('All-meeting attendance by month, 2026');
  });

  it('draws the line under a low-confidence note when fewer than six months have a rate', async () => {
    await render({
      months: months(
        2026,
        DESIGN_2026.map(([pct, meetings], index) => [pct, index < 5 ? 2 : meetings])
      ),
    });

    expect(text('engagement-attendance-trend-low-confidence')).toBe(
      'Only 5 months in 2026 have attendance from 3 or more meetings, so the trend is indicative, not reliable.'
    );
    expect(el('engagement-attendance-trend-chart')).not.toBeNull();
  });

  it('shows a not-enough-data card, and no chart, with a single rated full month', async () => {
    await render({
      months: months(
        2026,
        DESIGN_2026.map(([pct], index) => [index === 4 ? pct : null, index === 4 ? 10 : 0])
      ),
    });

    expect(text('engagement-attendance-trend-insufficient')).toContain('Only one month in 2026 has attendance from 3 or more meetings.');
    expect(el('engagement-attendance-trend-chart')).toBeNull();
    // The card says why it cannot chart, so it never holds back the tab's blank card.
    expect(verdicts).toEqual([null]);
  });

  it('settles empty, with no body, when no month has a rate', async () => {
    await render({
      months: months(
        2026,
        DESIGN_2026.map(() => [null, 0])
      ),
    });

    expect(verdicts).toEqual([true]);
    expect(el('engagement-attendance-trend-metrics')).toBeNull();
    expect(el('engagement-attendance-trend-insufficient')).toBeNull();
  });

  // A failed read is not a foundation without meetings, and the two states must not render the same card.
  it('renders the error state, not the empty state, when the read fails', async () => {
    await render(new Error('boom'));

    expect(el('engagement-attendance-trend-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  // One read holds every month, so the period pill re-cuts it and re-settles without a request.
  it('follows the period pill off the same read, and says when a completed year is not in the view yet', async () => {
    await render({ months: [...months(2025, DESIGN_2026.slice(0, 9)), ...months(2026, DESIGN_2026)] });
    getEngagementAttendanceTrend.mockClear();

    await selectYear('COMPLETED_YEAR');

    expect(getEngagementAttendanceTrend).not.toHaveBeenCalled();
    expect(text('engagement-attendance-trend-insufficient')).toContain('Attendance history for 2025 is not available yet.');
    // The card says why it cannot chart, so the shell gets no verdict and the tab's blank card is not held back.
    expect(verdicts).toEqual([false, null]);
  });

  it('charts a completed year from January to December when the view holds it', async () => {
    const year: [number, number][] = DESIGN_2026.concat([
      [8, 30],
      [6, 12],
    ]);
    await render({ months: months(2025, year) });

    await selectYear('COMPLETED_YEAR');

    expect(text('engagement-attendance-trend-metrics-latest-label')).toBe('December 2025');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="engagement-attendance-trend-table"] tbody tr')).toHaveLength(12);
    expect(el('engagement-attendance-trend-chart-line-in-progress')).toBeNull();
  });

  it('gives the shell no verdict for January in year to date', async () => {
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
    await render({ months: months(2026, [[40, 10]]) });

    expect(text('engagement-attendance-trend-insufficient')).toContain('The trend starts once January closes.');
    expect(verdicts).toEqual([null]);
  });

  it('settles empty in January when the foundation has no attendance at all', async () => {
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
    await render({ months: [] });

    expect(el('engagement-attendance-trend-insufficient')).toBeNull();
    expect(verdicts).toEqual([true]);
  });

  it('settles empty on a past year too when the view has no rows for the foundation', async () => {
    await render({ months: [] });

    await selectYear('COMPLETED_YEAR');

    expect(verdicts).toEqual([true, true]);
  });

  // A tab left open across a month boundary must not headline the new month's partial attendance.
  it('re-judges the month in progress on every read, so a month rollover is seen', async () => {
    await render();
    fixture.componentInstance['today'].set(new Date('2026-11-02T12:00:00Z'));
    fixture.detectChanges();
    // A stale date treats October as complete, so it headlines.
    expect(text('engagement-attendance-trend-metrics-latest-label')).toBe('Previous month (Oct 2026)');

    selectedFoundation.set({ slug: 'acme-two' });
    await settle();

    expect(text('engagement-attendance-trend-metrics-latest-label')).toBe('Previous month (Sep 2026)');
  });

  it('holds the skeleton and withholds the settle while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render(HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_UNMEASURED);

    expect(getEngagementAttendanceTrend).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(['reading']);
    expect(el('engagement-attendance-trend-loading')).not.toBeNull();
  });
});
