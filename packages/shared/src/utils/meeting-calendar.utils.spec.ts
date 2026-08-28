// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { meetingToCalendarEvents, publicMeetingToCalendarEvents, resolveMeetingCalendarClickRoute } from './meeting-calendar.utils';

import type { PublicCalendarMeeting } from '../interfaces';

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
});
