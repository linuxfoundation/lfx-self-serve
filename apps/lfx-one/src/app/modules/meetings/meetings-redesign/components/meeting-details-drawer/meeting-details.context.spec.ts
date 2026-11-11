// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, MeetingOccurrence, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsContext } from './meeting-details.context';
import { MeetingDetailsSource } from './meeting-details.source';

const START = '2050-01-01T09:00:00.000Z';
const NEXT: MeetingOccurrence = { occurrence_id: '2525245200', title: '', start_time: '2050-01-08T09:00:00.000Z', duration: 45 } as MeetingOccurrence;
const MEETING = { id: 'mtg-1', title: 'Synthetic sync', duration: 30, invited: true } as Meeting;
const PAST = { id: 'past-1', meeting_id: 'mtg-1', title: 'Synthetic sync', scheduled_start_time: START, duration: 30 } as unknown as PastMeeting;

function buildRow(meeting: Meeting): MeetingHomeRow {
  return { key: meeting.id, meeting, occurrence: null, title: meeting.title, occurrenceId: null, startTime: START, durationMinutes: 30 };
}

describe('MeetingDetailsContext', () => {
  let detail: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn<(row: MeetingHomeRow) => void>>;
  const upcomingRows = signal<MeetingHomeRow[]>([]);
  const now = signal(new Date('2049-12-31T09:00:00.000Z'));

  const create = (row: MeetingHomeRow, detail$: Observable<Meeting> = of(row.meeting), hosted = true): MeetingDetailsContext => {
    detail = vi.fn().mockReturnValue(detail$);
    toast = vi.fn();
    close = vi.fn();
    refreshUserMeetings = vi.fn();
    open = vi.fn<(row: MeetingHomeRow) => void>();
    const hostRef = hosted ? ({ close } as unknown as DialogRef) : null;
    const source: MeetingDetailsSource = { row, tab: 'agenda', now, upcomingRows, hostRef, open, applySummaryChange: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsContext,
        { provide: MeetingDetailsSource, useValue: source },
        { provide: MeetingService, useValue: { getMeetingDetail: detail, removedRegistrationMeetingIds: signal(new Set<string>()) } },
        { provide: UserService, useValue: { refreshUserMeetings, refreshUserPastMeetings: vi.fn() } },
        { provide: UiToastService, useValue: { show: toast } },
      ],
    });
    return TestBed.inject(MeetingDetailsContext);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    now.set(new Date('2049-12-31T09:00:00.000Z'));
    upcomingRows.set([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('replaces the row data with the fresh detail and reads invited from it', () => {
    const context = create(buildRow(MEETING), of({ ...MEETING, title: 'Renamed', invited: false }));

    expect(context.meeting().title).toBe('Renamed');
    expect(context.shownRow().title).toBe('Renamed');
    expect(context.invited()).toBe(false);
  });

  it('closes the drawer and reloads the list when the meeting is gone', () => {
    const context = create(
      buildRow(MEETING),
      throwError(() => new HttpErrorResponse({ status: 404 }))
    );

    expect(context.meeting()).toBe(MEETING);
    expect(close).toHaveBeenCalled();
    expect(refreshUserMeetings).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting unavailable' }));
  });

  it('flags a load error on any other error, and clears it once a retry loads', () => {
    const context = create(
      buildRow(MEETING),
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );

    expect(context.loadError()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    detail.mockReturnValue(of({ ...MEETING, title: 'Renamed' }));
    context.retryLoad();

    expect(context.loadError()).toBe(false);
    expect(context.retrying()).toBe(false);
    expect(context.meeting().title).toBe('Renamed');
  });

  it('keeps retrying while a newer retry replaces a pending one', () => {
    const context = create(
      buildRow(MEETING),
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );
    const first = new Subject<Meeting>();
    const second = new Subject<Meeting>();
    context.meeting();

    detail.mockReturnValue(first);
    context.retryLoad();
    detail.mockReturnValue(second);
    context.retryLoad();

    expect(context.retrying()).toBe(true);

    second.next({ ...MEETING, title: 'Renamed' });

    expect(context.retrying()).toBe(false);
    expect(context.loadError()).toBe(false);
  });

  it('runs from a source alone, outside a dialog and the meetings home page', () => {
    const context = create(
      buildRow(MEETING),
      throwError(() => new HttpErrorResponse({ status: 404 })),
      false
    );

    expect(context.meeting()).toBe(MEETING);
    expect(context.now()).toEqual(now());
    expect(close).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting unavailable' }));
  });

  it('rebuilds the row for another date without the first date answer', () => {
    const context = create({ ...buildRow(MEETING), myRsvp: { response: 'accepted' } as unknown as MeetingHomeRow['myRsvp'] });
    context.occurrence.set(NEXT);

    expect(context.shownRow()).toEqual(
      expect.objectContaining({ key: 'mtg-1:2525245200', startTime: NEXT.start_time, durationMinutes: 45, title: 'Synthetic sync', myRsvp: undefined })
    );
  });

  it('has no past meeting id until the date has ended', () => {
    const context = create(buildRow(MEETING));
    expect(context.state()).toBe('far');
    expect(context.pastMeetingId()).toBeNull();

    now.set(new Date('2050-01-02T09:00:00.000Z'));
    expect(context.state()).toBe('ended');
    expect(context.pastMeetingId()).toBe(`mtg-1-${Date.parse(START)}`);
  });

  it('uses the past record id of a past row, and the series id for another date', () => {
    const context = create(buildRow(PAST as unknown as Meeting));

    expect(detail).not.toHaveBeenCalled();
    expect(context.pastMeetingId()).toBe('past-1');

    now.set(new Date('2050-02-01T09:00:00.000Z'));
    context.occurrence.set(NEXT);
    expect(context.pastMeetingId()).toBe(`mtg-1-${Date.parse(NEXT.start_time)}`);
  });

  it('reads its own clock every 5s and on focus when the page clock lags', () => {
    vi.useFakeTimers({ now: new Date('2050-01-01T08:55:00.000Z') });
    const context = create(buildRow(MEETING));
    expect(context.now()).toEqual(now());

    vi.advanceTimersByTime(5_000);
    expect(context.now().toISOString()).toBe('2050-01-01T08:55:05.000Z');
    expect(context.state()).toBe('soon');

    vi.setSystemTime(new Date('2050-01-01T09:01:00.000Z'));
    window.dispatchEvent(new Event('focus'));
    expect(context.state()).toBe('live');
  });

  it('stops counting a drawer registration as an invitation once the viewer removes themselves', () => {
    const removed = signal(new Set<string>());
    TestBed.overrideProvider(MeetingService, {
      useValue: { getMeetingDetail: () => of(MEETING), removedRegistrationMeetingIds: removed, clearRemovedRegistration: vi.fn() },
    });
    const context = create({ ...buildRow({ ...MEETING, invited: false }) }, of({ ...MEETING, invited: false }));
    context.markRegistered();
    expect(context.invited()).toBe(true);

    removed.set(new Set([MEETING.id]));
    expect(context.invited()).toBe(false);
  });

  it('reloads the participants now and after 1s, and the past list behind the drawer', () => {
    vi.useFakeTimers();
    const refreshUserPastMeetings = vi.fn();
    TestBed.overrideProvider(UserService, { useValue: { refreshUserMeetings: vi.fn(), refreshUserPastMeetings } });
    const context = create(buildRow(PAST as unknown as Meeting));

    context.refreshParticipants();
    expect(context.participantsVersion()).toBe(1);
    expect(refreshUserPastMeetings).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(context.participantsVersion()).toBe(2);
  });

  it('counts a past row viewer as a member', () => {
    const context = create(buildRow({ ...(PAST as unknown as Meeting), visibility: 'private' } as Meeting));

    expect(context.fullAccess()).toBe(true);
  });

  it('reopens a past row on the listed upcoming date, or on the live meeting for another date', () => {
    const listed = { ...buildRow(MEETING), key: `mtg-1:${NEXT.occurrence_id}`, occurrence: NEXT, startTime: NEXT.start_time };
    upcomingRows.set([listed]);
    const context = create(buildRow(PAST as unknown as Meeting));

    context.showUpcoming(NEXT);
    expect(open).toHaveBeenCalledWith(listed);

    upcomingRows.set([]);
    detail.mockReturnValue(of(MEETING));
    const later = { ...NEXT, occurrence_id: '2525850000', start_time: '2050-01-15T09:00:00.000Z' };
    context.showUpcoming(later);
    expect(detail).toHaveBeenLastCalledWith('mtg-1');
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'mtg-1:2525850000', meeting: MEETING, occurrence: later, startTime: later.start_time, durationMinutes: 45 })
    );
    const titled = { ...later, title: 'Release review', description: 'Cut the release' };
    detail.mockReturnValue(of({ ...MEETING, occurrences: [titled] }));
    context.showUpcoming(later);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: titled, title: 'Release review' }));
  });

  it('drops a pending live meeting load when a listed date is picked next', () => {
    const context = create(buildRow(PAST as unknown as Meeting));
    const live = new Subject<Meeting>();
    detail.mockReturnValue(live);
    context.showUpcoming(NEXT);

    const listed = { ...buildRow(MEETING), key: 'mtg-1:2525850000', startTime: '2050-01-15T09:00:00.000Z' };
    upcomingRows.set([listed]);
    context.showUpcoming({ ...NEXT, occurrence_id: '2525850000', start_time: listed.startTime });
    live.next(MEETING);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(listed);
  });

  it('drops a live meeting load once the viewer moved to another date', () => {
    const context = create(buildRow(PAST as unknown as Meeting));
    const live = new Subject<Meeting>();
    detail.mockReturnValue(live);

    context.showUpcoming(NEXT);
    context.occurrence.set({ ...NEXT, start_time: START });
    live.next(MEETING);

    expect(open).not.toHaveBeenCalled();
  });
});
