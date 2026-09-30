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

import type { HealthMetricsMembersBoardAttendance, HealthMetricsMembersBoardCohortSummary, HealthMetricsMembersBoardMeeting } from '@lfx-one/shared/interfaces';

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
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsMembersBoardAttendance> = {}): HealthMetricsMembersBoardAttendance {
  return {
    cohorts: { board: cohort(), voting_members: cohort({ latestAttendancePct: 0.646, isBelowExpectedLevel: false }) },
    trend: [meeting({ meetingId: 'm-0', meetingDate: '2026-07-31', attendancePct: 0.9 }), meeting()],
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

  // `payload` answers the first read; `followUpPayload` (a value or a stream) every read after it.
  async function render(
    payload: HealthMetricsMembersBoardAttendance = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersBoardAttendance | Observable<HealthMetricsMembersBoardAttendance>
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
    fixture.componentInstance.noteChange.subscribe((note) => notes.push(note));
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
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
  });

  it('reads the board cohort for the period, renders the hero, and settles with the board note', async () => {
    await render();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', cohort: 'board', offset: 0, pageSize: 10 });
    expect(text('members-board-meetings')).toBe('12 meetings in range');
    expect(text('members-board-latest')).toBe('82%');
    expect(query('members-board-latest')?.classList).toContain('text-amber-600');
    expect(text('members-board-caption')).toBe('Last board meeting · below the ~100% this should be');
    expect(text('members-board-other')).toBe('65%');
    expect(text('members-board-attended')).toBe('9 / 11');
    expect(text('members-board-never')).toBe('0');
    expect(text('members-board-count')).toBe('12 meetings');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(notes).toEqual(['', '82% attended']);
  });

  it('renders a meeting row with its attended counts and rate bar', async () => {
    await render();

    expect(text('members-board-row-m-1-name')).toBe('Acme Board');
    expect(text('members-board-row-m-1-date')).toBe('Aug 31, 2026');
    expect(text('members-board-row-m-1-attended')).toBe('9 / 11');
    expect(text('members-board-row-m-1-rate')).toBe('82%');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="members-board-table"] th')).toHaveLength(4);
  });

  it('draws the latest meetings as a chart with a screen-reader table of the same values', async () => {
    await render();

    expect(query('members-board-chart')?.getAttribute('aria-label')).toContain('latest 2 board meetings');
    const rows = [...(query('members-board-chart-table')?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim())
    );
    expect(rows).toEqual([
      ['Jul 31, 2026', 'Acme Board', '90%'],
      ['Aug 31, 2026', 'Acme Board', '82%'],
    ]);
  });

  it('flags never-attended seats and links to the representatives who never attended', async () => {
    await render(response({ cohorts: { board: cohort({ neverAttendedCount: 3 }), voting_members: null } }));

    expect(query('members-board-never')?.classList).toContain('text-red-600');
    expect(text('members-board-never-note')).toContain('3 representatives have never attended');
    const link = query('members-board-never-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/engagement?repFilter=never#reps');
    expect(notes.at(-1)).toBe('3 seats unused');
  });

  it('keeps the board-only never-attended note off the voting members cohort', async () => {
    const board = cohort({ neverAttendedCount: 3 });
    await render(response({ cohorts: { board, voting_members: board } }), { boardCohort: 'voting_members' });

    expect(text('members-board-never')).toBe('3');
    expect(query('members-board-never-note')).toBeNull();
  });

  it('leaves out the never-attended note when every seat has been used', async () => {
    await render();

    expect(query('members-board-never-note')).toBeNull();
  });

  it('switches to voting members, re-reading from page 1 and writing the cohort to the URL, while the note stays on the board', async () => {
    await render(response({ totalRecords: 30 }), { boardPage: '2' });
    getMembersBoardAttendance.mockClear();
    notes.length = 0;

    fixture.componentInstance['onCohortChange']('voting_members');
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ cohort: 'voting_members', offset: 0 }));
    expect(text('members-board-caption')).toBe('Last voting meeting');
    expect(text('members-board-other')).toBe('82%');
    expect(notes).toEqual(['82% attended']);
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { boardCohort: 'voting_members', boardPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('ignores a cohort it does not know', async () => {
    await render();
    getMembersBoardAttendance.mockClear();

    fixture.componentInstance['onCohortChange']('committee');
    await settle();

    expect(getMembersBoardAttendance).not.toHaveBeenCalled();
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 30 }));
    getMembersBoardAttendance.mockClear();

    fixture.componentInstance['onTablePage']({ first: 20, rows: 10 });
    await settle();

    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ offset: 20 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { boardCohort: null, boardPage: 3 } }));
  });

  it('starts on the cohort and page the URL carries, and falls back for values it cannot honour', async () => {
    await render(response({ totalRecords: 30 }), { boardCohort: 'voting_members', boardPage: '2' });
    expect(getMembersBoardAttendance).toHaveBeenCalledWith(expect.objectContaining({ cohort: 'voting_members', offset: 10 }));

    TestBed.resetTestingModule();
    await render(response(), { boardCohort: 'toString', boardPage: 'x' });
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

  it('re-reads from page 1 for a new period, blanking the note until it lands', async () => {
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
    expect(query('members-board-latest')).toBeNull();
    expect(text('members-board-meetings')).toBe('—');
  });

  it('shows the empty state when the period holds no meeting', async () => {
    await render(NO_MEETINGS);

    expect(text('members-board-empty')).toContain('No board meetings in this period');
    expect(query('members-board-table')).toBeNull();
    expect(notes.at(-1)).toBe('');
  });

  it('separates a failed read from an empty one, settling it without a note', async () => {
    await render(response({ totalRecords: 30 }));
    notes.length = 0;
    lifecycle.length = 0;
    getMembersBoardAttendance.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    await settle();

    expect(query('members-board-error')).not.toBeNull();
    expect(query('members-board-empty')).toBeNull();
    expect(notes).toEqual(['']);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersBoardAttendance).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-board-loading')).not.toBeNull();
    expect(query('members-board-empty')).toBeNull();
  });
});
