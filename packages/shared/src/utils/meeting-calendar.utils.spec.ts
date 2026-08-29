// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { BEHAVIORAL_CLASS_CALENDAR_COLORS, CANCELLED_COLOR, PAST_MEETING_CALENDAR_COLOR } from '../constants/calendar-colors.constants';

import { meetingToCalendarEvents, publicMeetingToCalendarEvents, resolveMeetingCalendarClickRoute } from './meeting-calendar.utils';

import type { PublicCalendarMeeting } from '../interfaces';
import type { PublicCalendarCommittee, PublicCalendarCommitteeContext } from '../interfaces/calendar.interface';

describe('meetingToCalendarEvents', () => {
  it('does not style in-progress v1_past_meeting rows as past', () => {
    const events = meetingToCalendarEvents({
      meeting_and_occurrence_id: '99152950841-1630560600000',
      start_time: new Date(Date.now() - 30 * 60_000).toISOString(),
      duration: 60,
      title: 'Live sync',
    } as never);

    expect(events[0].classNames).not.toContain('meeting-event-past');
  });

  it('styles ended v1_past_meeting rows as past', () => {
    const events = meetingToCalendarEvents({
      meeting_and_occurrence_id: '99152950841-1630560600000',
      start_time: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      duration: 60,
      title: 'Completed sync',
    } as never);

    expect(events[0].classNames).toContain('meeting-event-past');
  });
});

describe('publicMeetingToCalendarEvents', () => {
  function publicMeeting(over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting {
    return {
      id: 'meeting-1',
      title: 'Technical Steering Committee',
      start_time: new Date(Date.now() + 60 * 60_000).toISOString(),
      duration: 60,
      timezone: 'America/New_York',
      ...over,
    };
  }

  it('never emits a password into extendedProps, so a click cannot forward one into the join URL', () => {
    // The public projection has no `password` field at all, but a future refactor pointing this
    // mapper back at a full Meeting would silently reintroduce the leak — so the click route the
    // event actually produces is asserted, not just the absence of the key.
    const [event] = publicMeetingToCalendarEvents({ ...publicMeeting(), password: 'super-secret' } as PublicCalendarMeeting);

    expect(event.extendedProps).not.toHaveProperty('password');
    const route = resolveMeetingCalendarClickRoute(event.extendedProps!);
    expect(route?.queryParams ?? {}).not.toHaveProperty('password');
  });

  it('expands occurrences using the series title and marks cancelled ones inert', () => {
    const events = publicMeetingToCalendarEvents(
      publicMeeting({
        cancelled_occurrences: ['1630560600'],
        occurrences: [
          { occurrence_id: '1630560600', start_time: new Date(Date.now() + 60 * 60_000).toISOString(), duration: 30 },
          { occurrence_id: '1630647000', start_time: new Date(Date.now() + 120 * 60_000).toISOString(), duration: 30 },
        ],
      })
    );

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.title === 'Technical Steering Committee')).toBe(true);
    expect(events[0].classNames).toContain('cursor-default');
    expect(resolveMeetingCalendarClickRoute(events[0].extendedProps!)).toBeNull();
    expect(events[1].classNames).not.toContain('cursor-default');
  });

  it('falls back to the series duration for an occurrence with no per-occurrence override', () => {
    // Without the fallback, isOccurrencePast computes NaN (so an ended occurrence never styles as
    // past) and addMinutesToDate silently substitutes 60 minutes — wrong end time for any meeting
    // whose series duration isn't 60, and no durationMinutes for the click route to build from.
    const start = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const [event] = publicMeetingToCalendarEvents(publicMeeting({ duration: 90, occurrences: [{ occurrence_id: '1630560600', start_time: start } as never] }));

    expect(event.extendedProps?.durationMinutes).toBe(90);
    expect(new Date(event.end!).getTime() - new Date(start).getTime()).toBe(90 * 60_000);
    expect(event.classNames).toContain('meeting-event-past');
  });

  it('links a past-meeting row through its composite resource id', () => {
    const [event] = publicMeetingToCalendarEvents(
      publicMeeting({
        meeting_and_occurrence_id: '99152950841-1630560600000',
        scheduled_start_time: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      })
    );

    expect(event.classNames).toContain('meeting-event-past');
    expect(resolveMeetingCalendarClickRoute(event.extendedProps!)?.path).toEqual(['/meetings', '99152950841-1630560600000']);
  });

  describe('committee attribution', () => {
    const tsc: PublicCalendarCommittee = { uid: 'uid-tsc', name: 'TSC', behavioralClass: 'oversight-committee' };
    const board: PublicCalendarCommittee = { uid: 'uid-board', name: 'Governing Board', behavioralClass: 'governing-board' };
    const directory: PublicCalendarCommitteeContext = { committeesByUid: { [tsc.uid]: tsc, [board.uid]: board } };

    it('colours the event by behavioural class and suffixes the group name', () => {
      const [event] = publicMeetingToCalendarEvents(publicMeeting({ title: 'Weekly sync', committee_uids: [tsc.uid] }), directory);

      expect(event.title).toBe('Weekly sync · TSC');
      expect(event.backgroundColor).toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['oversight-committee'].bg);
    });

    it('prefers the actively filtered committee over the first association and drops the suffix', () => {
      const [event] = publicMeetingToCalendarEvents(publicMeeting({ title: 'Weekly sync', committee_uids: [tsc.uid, board.uid] }), {
        ...directory,
        activeCommitteeUid: board.uid,
      });

      expect(event.title).toBe('Weekly sync');
      expect(event.backgroundColor).toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['governing-board'].bg);
    });

    it('ignores committees absent from the public directory', () => {
      // The feed publishes UIDs for every associated committee, including ones the public group
      // directory does not list. Those must not colour or label anything.
      const [event] = publicMeetingToCalendarEvents(publicMeeting({ title: 'Weekly sync', committee_uids: ['uid-private', tsc.uid] }), directory);

      expect(event.title).toBe('Weekly sync · TSC');
    });

    it('renders default styling with no context, no committees, or no directory match', () => {
      const bare = publicMeetingToCalendarEvents(publicMeeting({ title: 'Weekly sync' }))[0];
      const unmatched = publicMeetingToCalendarEvents(publicMeeting({ title: 'Weekly sync', committee_uids: ['uid-private'] }), directory)[0];

      expect(bare.title).toBe('Weekly sync');
      expect(unmatched.title).toBe('Weekly sync');
      expect(unmatched.backgroundColor).toBe(bare.backgroundColor);
    });

    it('keeps the cancelled and past treatments rather than the committee colour', () => {
      // Cancelled/past state tells the reader more than which group owns the meeting, so it wins.
      const [cancelled] = publicMeetingToCalendarEvents(
        publicMeeting({
          committee_uids: [tsc.uid],
          cancelled_occurrences: ['1630560600'],
          occurrences: [{ occurrence_id: '1630560600', start_time: new Date(Date.now() + 60 * 60_000).toISOString(), duration: 30 }],
        }),
        directory
      );
      const [past] = publicMeetingToCalendarEvents(
        publicMeeting({ committee_uids: [tsc.uid], start_time: new Date(Date.now() - 3 * 60 * 60_000).toISOString() }),
        directory
      );

      expect(cancelled.backgroundColor).toBe(CANCELLED_COLOR.bg);
      expect(past.backgroundColor).toBe(PAST_MEETING_CALENDAR_COLOR.bg);
    });
  });
});
