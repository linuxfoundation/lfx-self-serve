// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementMeetingParticipationComponent } from './engagement-meeting-participation.component';

import type { HealthMetricsEngagementMeetingParticipation, HealthMetricsEngagementParticipationRow } from '@lfx-one/shared/interfaces';

function participationRow(overrides: Partial<HealthMetricsEngagementParticipationRow> = {}): HealthMetricsEngagementParticipationRow {
  return {
    level: 'all',
    group: null,
    label: 'All meetings',
    totalGroups: 8,
    governance: false,
    periods: [
      {
        range: 'COMPLETED_YEAR_3',
        meetingsHeld: 14,
        invitedCount: 140,
        attendedCount: 77,
        attendancePct: 0.55,
        activeGroups: 5,
        neverAttended: 4,
        attendanceChangePp: null,
        meetingsChangePct: null,
      },
      {
        range: 'COMPLETED_YEAR_2',
        meetingsHeld: 16,
        invitedCount: 160,
        attendedCount: 96,
        attendancePct: 0.6,
        activeGroups: 6,
        neverAttended: 4,
        attendanceChangePp: 0.05,
        meetingsChangePct: 0.142857,
      },
      {
        range: 'COMPLETED_YEAR',
        meetingsHeld: 20,
        invitedCount: 200,
        attendedCount: 130,
        attendancePct: 0.65,
        activeGroups: 7,
        neverAttended: 2,
        attendanceChangePp: 0.05,
        meetingsChangePct: 0.25,
      },
      {
        range: 'YTD',
        meetingsHeld: 12,
        invitedCount: 120,
        attendedCount: 84,
        attendancePct: 0.7,
        activeGroups: 6,
        neverAttended: 3,
        attendanceChangePp: 0.04,
        meetingsChangePct: 0.2,
      },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsEngagementMeetingParticipation> = {}): HealthMetricsEngagementMeetingParticipation {
  return {
    total: participationRow(),
    rows: [
      participationRow({ level: 'group', group: 'Board', label: 'Board', governance: true }),
      participationRow({ level: 'group', group: 'Marketing', label: 'Marketing' }),
    ],
    ...overrides,
  };
}

describe('EngagementMeetingParticipationComponent', () => {
  let fixture: ComponentFixture<EngagementMeetingParticipationComponent>;
  let getEngagementMeetingParticipation: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let verdicts: boolean[];

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function render(
    payload: HealthMetricsEngagementMeetingParticipation = response(),
    onSection?: (key: unknown) => void,
    lifecycle?: string[]
  ): Promise<void> {
    getEngagementMeetingParticipation = vi.fn().mockReturnValue(of(payload));

    await TestBed.configureTestingModule({
      imports: [EngagementMeetingParticipationComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEngagementMeetingParticipation } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementMeetingParticipationComponent);
    if (onSection) fixture.componentInstance.sectionPicked.subscribe(onSection);
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

  it('reads the selected foundation and period, and renders the roll-up as the metrics row', async () => {
    await render();

    expect(getEngagementMeetingParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD' });
    expect(text('engagement-meeting-participation-metrics-attendance-label')).toBe('All-meeting attendance');
    expect(text('engagement-meeting-participation-metrics-attendance-value')).toBe('70%');
    expect(text('engagement-meeting-participation-metrics-attendance-description')).toBe('+4.0pp vs previous period');
    expect(text('engagement-meeting-participation-metrics-meetings-value')).toBe('12');
    expect(text('engagement-meeting-participation-metrics-groups-value')).toBe('6 / 8');
    expect(text('engagement-meeting-participation-metrics-never-value')).toBe('3');
    expect(verdicts).toEqual([false]);
  });

  // The design keeps every value in neutral-900, Never attended included, and drops the old click-throughs.
  it('shows the metrics as plain values, colouring only the attendance change', async () => {
    await render();

    expect(query('engagement-meeting-participation-metrics-never-value')?.className).toContain('text-gray-900');
    expect(query('engagement-meeting-participation-metrics-attendance-description')?.querySelector('.text-emerald-600')?.textContent).toBe('+4.0pp');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-meeting-participation-metrics"] button')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-filter-pills')).toBeNull();
  });

  it('takes the metrics from the roll-up row rather than the type rows', async () => {
    const total = participationRow();
    total.periods[3] = { ...total.periods[3], attendancePct: 0.41 };
    await render(response({ total }));

    expect(text('engagement-meeting-participation-metrics-attendance-value')).toBe('41%');
  });

  it('opens in the meeting-type order with no arrow, and sorts on a picked column', async () => {
    await render();
    const header = (key: string): HTMLElement => query(`engagement-meeting-participation-sort-${key}`) as HTMLElement;
    const rows = (): string[] =>
      [...fixture.nativeElement.querySelectorAll('tr[data-testid^="engagement-meeting-participation-row-"]')].map(
        (row: Element) => row.getAttribute('data-testid') ?? ''
      );

    expect(['type', 'meetings', 'attendance'].map((key) => header(key).closest('th')?.getAttribute('aria-sort'))).toEqual(['none', 'none', 'none']);
    expect(rows()).toEqual(['engagement-meeting-participation-row-Board', 'engagement-meeting-participation-row-Marketing']);

    (header('type').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (header('type').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(header('type').closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(rows()).toEqual(['engagement-meeting-participation-row-Marketing', 'engagement-meeting-participation-row-Board']);
  });

  it('draws each meeting type with its icon tile, its count and a 160px attendance bar', async () => {
    await render();

    const marketing = query('engagement-meeting-participation-row-Marketing') as HTMLElement;
    const cells = marketing.querySelectorAll('td');
    expect(cells[0].textContent?.trim()).toBe('Marketing');
    expect(cells[0].querySelector('[data-testid="health-metrics-cell-icon"] i')?.className).toContain('fa-chart-line-up');
    expect(cells[1].textContent?.trim()).toBe('12');
    expect(cells[2].textContent).toContain('70%');
    const fill = cells[2].querySelector('[data-testid="health-metrics-value-bar-fill"]') as HTMLElement;
    expect(fill.parentElement?.style.width).toBe('160px');
    expect(fill.className).toContain('bg-blue-500');
  });

  it('names the board row by its short type, points it at Members and holds it to the board rule', async () => {
    await render();

    const board = query('engagement-meeting-participation-row-Board') as HTMLElement;
    expect(board.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent).toBe('Board');
    expect(board.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim()).toBe('Board & voting-member attendance');
    expect(board.querySelector('[data-testid="health-metrics-cell-description"] .fa-angle-right')).not.toBeNull();
    // 70% passes the general rule but sits below the board's 90%.
    expect(board.querySelector('[data-testid="health-metrics-value-bar-fill"]')?.className).toContain('bg-red-500');
    expect(query('engagement-meeting-participation-row-Marketing')?.querySelector('[data-testid="health-metrics-cell-description"]')).toBeNull();
  });

  it('renders every metric of an unmeasured roll-up as an em dash, with no change line', async () => {
    const base = participationRow();
    const total = participationRow({
      totalGroups: null,
      periods: base.periods.map((period) => ({
        ...period,
        meetingsHeld: null,
        attendancePct: null,
        activeGroups: null,
        neverAttended: null,
        attendanceChangePp: null,
        meetingsChangePct: null,
      })),
    });
    await render(response({ total }));

    for (const key of ['attendance', 'meetings', 'groups', 'never']) {
      expect(text(`engagement-meeting-participation-metrics-${key}-value`)).toBe('—');
    }
    expect(query('engagement-meeting-participation-metrics-attendance-description')).toBeNull();
  });

  it('re-reads when the period changes, since the response carries every period per row', async () => {
    await render();
    getEngagementMeetingParticipation.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEngagementMeetingParticipation).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
    expect(text('engagement-meeting-participation-metrics-attendance-value')).toBe('65%');
  });

  // Under three meetings the rate is not reportable, and the note has to say so next to it.
  it('warns in a small warning note when the period holds too few meetings to rate', async () => {
    const thin = participationRow();
    thin.periods[3] = { ...thin.periods[3], meetingsHeld: 2 };
    await render(response({ total: thin, rows: [] }));

    const note = query('engagement-meeting-participation-low-confidence');
    expect(note?.tagName).toBe('LFX-UI-NOTE');
    expect(note?.textContent).toContain('Too few meetings in this period to report an attendance rate with confidence.');
    expect(text('engagement-meeting-participation-metrics-attendance-value')).toBe('No data');
  });

  it('links the board row to Members board attendance, clearing a cohort the URL carries', async () => {
    await render();

    const link = query('engagement-meeting-participation-row-Board-link') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/members#board');
    expect(link.getAttribute('aria-label')).toBe('Board: Board & voting-member attendance');
  });

  it('opens Members board attendance from anywhere on the board row', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    query('engagement-meeting-participation-row-Board')?.click();

    expect(navigate).toHaveBeenCalledWith(['/foundation/health-metrics', 'members'], {
      fragment: 'board',
      queryParams: { boardCohort: null, boardPage: null },
      queryParamsHandling: 'merge',
    });
  });

  it('scrolls any other meeting type to Group attendance, once per click on the row or its name button', async () => {
    const picked: unknown[] = [];
    await render(response(), (key) => picked.push(key));

    query('engagement-meeting-participation-row-Marketing')?.click();
    const button = query('engagement-meeting-participation-row-Marketing-link') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    button.click();

    expect(picked).toEqual(['committees', 'committees']);
  });

  // The container holds a deep link until every section settles and re-holds it on the next
  // `reading`, so both halves have to fire — and pair up — for each read.
  it('brackets every read with reading then settled, so the container can re-anchor above it', async () => {
    const lifecycle: string[] = [];
    await render(response(), undefined, lifecycle);

    expect(lifecycle).toEqual(['reading', 'settled']);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lifecycle).toEqual(['reading', 'settled', 'reading', 'settled']);
  });

  // A failed read must not render the copy that asserts the foundation has never met.
  it('separates a failed read from an empty one', async () => {
    await render();
    getEngagementMeetingParticipation.mockReturnValue(throwError(() => new Error('gateway timeout')));

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query('engagement-meeting-participation-error')).not.toBeNull();
    expect(verdicts).toEqual([false, false]);
    expect(query('engagement-meeting-participation-metrics')).toBeNull();
  });

  it('settles empty, with no body, for a foundation the view has no roll-up row for', async () => {
    await render(response({ total: null, rows: [] }));

    expect(verdicts).toEqual([true]);
    expect(query('engagement-meeting-participation-metrics')).toBeNull();
    expect(query('engagement-meeting-participation-table')).toBeNull();
  });

  it('settles empty, with no body, for a period whose roll-up held no meetings', async () => {
    const total = participationRow();
    total.periods = total.periods.map((period) => ({ ...period, meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null }));
    await render(response({ total }));

    expect(verdicts).toEqual([true]);
    expect(query('engagement-meeting-participation-metrics')).toBeNull();
    expect(query('engagement-meeting-participation-table')).toBeNull();
  });

  // A count the view never filled in is unmeasured, not zero, so it keeps the body.
  it('keeps the body for a period whose meeting count is unmeasured', async () => {
    const total = participationRow();
    total.periods = total.periods.map((period) => ({ ...period, meetingsHeld: null }));
    await render(response({ total }));

    expect(verdicts).toEqual([false]);
    expect(query('engagement-meeting-participation-metrics')).not.toBeNull();
  });

  // An unresolved foundation is not a foundation with no meetings, and the two must not look alike.
  it('holds the skeleton while no foundation is selected, rather than captioning an unread scope', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEngagementMeetingParticipation).not.toHaveBeenCalled();
    expect(query('engagement-meeting-participation-loading')).not.toBeNull();
    expect(verdicts).toEqual([]);
  });
});
