// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersBoardAttendanceComponent } from './members-board-attendance.component';

import type {
  HealthMetricsMembersBoardAttendance,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBoardMeeting,
} from '@lfx-one/shared/interfaces';

function cohort(overrides: Partial<HealthMetricsMembersBoardCohortSummary> = {}): HealthMetricsMembersBoardCohortSummary {
  return {
    latestAttendancePct: 0.82,
    latestAttendedCount: 9,
    latestInvitedCount: 11,
    meetingsInRangeCount: 12,
    neverAttendedCount: 0,
    isBelowExpectedLevel: true,
    ...overrides,
  };
}

function meeting(overrides: Partial<HealthMetricsMembersBoardMeeting> = {}): HealthMetricsMembersBoardMeeting {
  return {
    meetingId: 'm-1',
    committeeName: 'Acme Board',
    meetingDate: '2026-08-31',
    attendedCount: 9,
    invitedCount: 11,
    attendancePct: 0.818,
    isLatestMeeting: false,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersBoardAttendance> = {}): HealthMetricsMembersBoardAttendance {
  return {
    cohorts: { board: cohort(), voting_members: cohort({ latestAttendancePct: 0.646, isBelowExpectedLevel: false }) },
    trend: [meeting({ meetingId: 'm-0', meetingDate: '2026-07-31', attendancePct: 0.9 }), meeting({ isLatestMeeting: true })],
    rows: [meeting()],
    totalRecords: 12,
    ...overrides,
  };
}

const NO_MEETINGS = response({ cohorts: { board: null, voting_members: null }, trend: [], rows: [], totalRecords: 0 });

describe('MembersBoardAttendanceComponent', () => {
  let fixture: ComponentFixture<MembersBoardAttendanceComponent>;
  let getMembersBoardAttendance: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let selectedRange: ReturnType<typeof signal<string>>;
  let notes: string[];
  let lifecycle: string[];
  let verdicts: boolean[];

  // `payload` answers the first read; `followUpPayload` (a value or a stream) every read after it.
  async function render(
    payload: HealthMetricsMembersBoardAttendance = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersBoardAttendance | Observable<HealthMetricsMembersBoardAttendance>,
    cohortValue: HealthMetricsMembersBoardCohort = 'board'
  ): Promise<void> {
    const followUp = followUpPayload ?? payload;
    getMembersBoardAttendance = vi
      .fn()
      .mockReturnValue(isObservable(followUp) ? followUp : of(followUp))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersBoardAttendanceComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getMembersBoardAttendance } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: HealthMetricsChromeService, useValue: { selectedRange } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersBoardAttendanceComponent);
    // The page owns the cohort switch and passes it in.
    fixture.componentRef.setInput('cohort', cohortValue);
    fixture.componentInstance.noteChange.subscribe((note) => notes.push(note));
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

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string | undefined {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    selectedRange = signal<string>('YTD');
    notes = [];
    lifecycle = [];
    verdicts = [];
  });

  function sortBy(column: string): void {
    (query(`members-board-sort-${column}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  it('reads the board cohort for the period, renders the metrics, and settles with the board note', async () => {
    await render();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', cohort: 'board', offset: 0, pageSize: 10, sort: null });
    expect(text('members-board-metrics-latest-value')).toBe('82%');
    expect(text('members-board-metrics-latest-description')).toBe('9 of 11 board members attended');
    expect(text('members-board-metrics-other-label')).toBe('Voting-member attendance');
    expect(text('members-board-metrics-other-value')).toBe('65%');
    expect(text('members-board-metrics-never-value')).toBe('0');
    expect(text('members-board-metrics-never-description')).toBe('Board members with no meeting this year');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(notes).toEqual(['', '82% attended']);
  });

  it('renders a meeting row with its name, date and attendance over a bar red below the level', async () => {
    await render();

    expect(text('members-board-row-m-1-name')).toBe('Acme Board');
    expect(text('members-board-row-m-1-date')).toBe('Aug 31, 2026');
    expect(text('members-board-row-m-1-attendance')).toBe('9/11・82%');
    expect(query('members-board-row-m-1-attendance')?.querySelector('[data-testid="health-metrics-progress-fill"]')?.className).toContain('bg-red-500');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="members-board-table"] th')).toHaveLength(3);
  });

  it('charts the latest meetings oldest first under its sub-heading, the latest bar solid', async () => {
    await render();

    expect(text('members-board-trend')).toContain('Attendance by meeting');
    expect(query('members-board-chart-bars')?.getAttribute('aria-label')).toBe('Attendance at the latest 2 board meetings, oldest first');
    expect(
      [...fixture.nativeElement.querySelectorAll('[data-testid^="members-board-chart-value-"]')].map((label: Element) => label.textContent?.trim())
    ).toEqual(['90%', '82%']);
    expect(query('members-board-chart-fill-m-0')?.style.opacity).toBe('0.2');
    expect(query('members-board-chart-fill-m-1')?.style.opacity).toBe('1');
    expect(query('members-board-chart-bar-m-1')?.getAttribute('aria-label')).toBe('Acme Board, Date Aug 31, 2026, Attendance 82% · 9 / 11');
  });

  it('sorts the meetings on the server, returning to the first page and keeping the chart oldest first', async () => {
    await render(response({ totalRecords: 30 }), { boardPage: '2' });
    getMembersBoardAttendance.mockClear();

    sortBy('attendance');
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, sort: { key: 'attendance', direction: 'desc' } }));
    expect(query('members-board-sort-attendance')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
    expect(query('members-board-chart-bar-m-0')).not.toBeNull();
  });

  it('switches to voting members from the first page, keeping the sort, while the note stays on the board', async () => {
    await render(response({ totalRecords: 30 }), { boardPage: '2' });
    sortBy('meeting');
    await settle();
    getMembersBoardAttendance.mockClear();
    notes.length = 0;

    fixture.componentRef.setInput('cohort', 'voting_members');
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ cohort: 'voting_members', offset: 0, sort: { key: 'meeting', direction: 'asc' } })
    );
    expect(text('members-board-metrics-latest-description')).toBe('9 of 11 voting members attended');
    expect(text('members-board-metrics-other-label')).toBe('Board attendance');
    expect(notes).toEqual(['82% attended']);
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { boardCohort: 'voting_members', boardPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 30 }));
    getMembersBoardAttendance.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { boardCohort: null, boardPage: 3 } }));
  });

  it('starts on the page the URL carries, and falls back for a page it cannot honour', async () => {
    await render(response({ totalRecords: 30 }), { boardPage: '2' }, undefined, 'voting_members');
    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ cohort: 'voting_members', offset: 10 }));

    TestBed.resetTestingModule();
    await render(response(), { boardPage: 'x' });
    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ cohort: 'board', offset: 0 }));
  });

  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 12 }), { boardPage: '9' }, response());

    expect(getMembersBoardAttendance).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getMembersBoardAttendance).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 10 }));
    expect(getMembersBoardAttendance).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { boardCohort: null, boardPage: 2 } }));
  });

  it('re-reads from the first page for a new period, blanking the note until it lands', async () => {
    await render(response({ totalRecords: 30 }), { boardPage: '3' });
    getMembersBoardAttendance.mockClear();
    notes.length = 0;

    selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
    expect(notes).toEqual(['', '82% attended']);
  });

  it('reads the default period when the picker holds one the views do not carry', async () => {
    selectedRange.set('LAST_WEEK');
    await render();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ range: 'YTD' }));
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersBoardAttendance.mockReturnValue(new Subject<HealthMetricsMembersBoardAttendance>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-board-loading')).not.toBeNull();
    expect(query('members-board-metrics')).toBeNull();
  });

  it('settles empty, with no body, when the period holds no meeting', async () => {
    await render(NO_MEETINGS);

    expect(verdicts).toEqual([true]);
    expect(query('members-board-metrics')).toBeNull();
    expect(query('members-board-table')).toBeNull();
    expect(notes.at(-1)).toBe('');
  });

  it('does not settle empty for a cohort with no meeting while the other cohort met, so the switch can go back', async () => {
    const votingOnly = { board: cohort({ meetingsInRangeCount: 0 }), voting_members: cohort({ meetingsInRangeCount: 4 }) };
    await render(response({ cohorts: votingOnly, trend: [], rows: [], totalRecords: 0 }));

    expect(verdicts).toEqual([false]);
    expect(text('members-board-empty')).toContain('No board meetings in this period');
    expect(query('members-board-metrics')).toBeNull();
  });

  it('keeps the body for rows and a trend the cohort summaries leave unmeasured', async () => {
    await render(response({ cohorts: { board: null, voting_members: null } }));

    expect(verdicts).toEqual([false]);
    expect(text('members-board-metrics-latest-value')).toBe('—');
    expect(query('members-board-empty')).toBeNull();
  });

  it('separates a failed read from an empty one, settling it without a note', async () => {
    await render(response({ totalRecords: 30 }));
    notes.length = 0;
    lifecycle.length = 0;
    getMembersBoardAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['page'].set(1);
    await settle();

    expect(query('members-board-error')).not.toBeNull();
    expect(notes).toEqual(['']);
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersBoardAttendance).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-board-loading')).not.toBeNull();
  });
});
