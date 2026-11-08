// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingDetailsDrawerData, MeetingHomeRow, MeetingOccurrence, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeStore } from '../../services/meetings-home.store';
import { MeetingDetailsContext } from './meeting-details.context';

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
  const now = signal(new Date('2049-12-31T09:00:00.000Z'));

  const create = (row: MeetingHomeRow, detail$: Observable<Meeting> = of(row.meeting)): MeetingDetailsContext => {
    detail = vi.fn().mockReturnValue(detail$);
    toast = vi.fn();
    close = vi.fn();
    refreshUserMeetings = vi.fn();
    const data: MeetingDetailsDrawerData = { row, tab: 'agenda', injector: Injector.NULL };
    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsContext,
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close } },
        { provide: MeetingService, useValue: { getMeetingDetail: detail, removedRegistrationMeetingIds: signal(new Set<string>()) } },
        { provide: UserService, useValue: { refreshUserMeetings, refreshUserPastMeetings: vi.fn() } },
        { provide: MeetingsHomeStore, useValue: { now } },
        { provide: UiToastService, useValue: { show: toast } },
      ],
    });
    return TestBed.inject(MeetingDetailsContext);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    now.set(new Date('2049-12-31T09:00:00.000Z'));
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

  it('keeps the row data open with a toast on any other error', () => {
    const context = create(
      buildRow(MEETING),
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );

    expect(context.meeting()).toBe(MEETING);
    expect(close).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting details unavailable' }));
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

  it('counts a past row viewer as a member', () => {
    const context = create(buildRow({ ...(PAST as unknown as Meeting), visibility: 'private' } as Meeting));

    expect(context.fullAccess()).toBe(true);
  });
});
