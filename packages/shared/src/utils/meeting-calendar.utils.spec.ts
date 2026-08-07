// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { meetingToCalendarEvents } from './meeting-calendar.utils';

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
