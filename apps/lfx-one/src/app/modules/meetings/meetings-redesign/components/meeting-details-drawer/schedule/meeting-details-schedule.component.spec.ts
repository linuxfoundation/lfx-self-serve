// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDetailsState, MeetingHomeRow, MeetingJoinLink } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingsHomeJoinService } from '../../../services/meetings-home-join.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsScheduleComponent } from './meeting-details-schedule.component';

const START = '2026-11-05T17:00:00Z';
function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'synthetic-meeting',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Synthetic Project',
    project_slug: 'synthetic-project',
    start_time: START,
    duration: 30,
    timezone: 'UTC',
    title: 'Synthetic sync',
    description: '',
    recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '5', end_times: 4 },
    committees: [],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: 'pw',
    invited: false,
    organizer: false,
    is_invite_responses_enabled: true,
    early_join_time_minutes: 15,
    occurrences: [],
    ...overrides,
  };
}
const MEETING = buildMeeting();
const ROW: MeetingHomeRow = {
  key: 'synthetic-meeting',
  meeting: MEETING,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: null,
  startTime: START,
  durationMinutes: 30,
};

describe('MeetingDetailsScheduleComponent', () => {
  let state: WritableSignal<MeetingDetailsState>;
  let link: WritableSignal<MeetingJoinLink>;
  let upcomingRows: WritableSignal<MeetingHomeRow[]>;
  let meeting: WritableSignal<Meeting>;

  const render = async (): Promise<ComponentFixture<MeetingDetailsScheduleComponent>> => {
    const fixture = TestBed.createComponent(MeetingDetailsScheduleComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);
  const text = (fixture: ComponentFixture<unknown>, testId: string): string => query(fixture, testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    state = signal<MeetingDetailsState>('far');
    link = signal<MeetingJoinLink>({ url: null, error: null, code: null });
    upcomingRows = signal<MeetingHomeRow[]>([]);
    meeting = signal(MEETING);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingDetailsContext,
          useValue: {
            row: signal(ROW),
            shownRow: signal(ROW),
            meeting,
            occurrence: signal(null),
            state,
            now: signal(new Date('2026-11-01T12:00:00Z')),
            organizer: signal(false),
          },
        },
        { provide: MeetingsHomeStore, useValue: { upcomingRows } },
        { provide: MeetingsHomeJoinService, useValue: { joinLink: () => link } },
        { provide: UserService, useValue: { authenticated: signal(true) } },
        {
          provide: MeetingService,
          useValue: { removedRegistrationMeetingIds: signal(new Set()) },
        },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set()) } },
      ],
    });
  });

  it('shows the long date, the time and the recurrence with its end', async () => {
    const fixture = await render();

    expect(text(fixture, 'meeting-details-schedule-long-date')).toMatch(/^Thursday, Nov 5, 2026$/);
    expect(text(fixture, 'meeting-details-schedule-time')).toMatch(/· 30 min$/);
    expect(text(fixture, 'meeting-details-schedule-recurrence')).toBe('Weekly on Thursday, for 4 occurrences');
  });

  it('keeps Join off before its window and says when it opens', async () => {
    const fixture = await render();

    expect(query(fixture, 'meeting-details-schedule-join')?.querySelector('button')?.disabled).toBe(true);
    expect(text(fixture, 'meeting-details-schedule-join-window')).toBe('You may only join the meeting up to 15 minutes before the start time.');
  });

  it("answers on the list's row for the shown date, which carries the viewer's RSVP", async () => {
    const fixture = await render();
    expect(query(fixture, 'meetings-home-rsvp')).toBeNull();

    upcomingRows.set([{ ...ROW, meeting: { ...MEETING, invited: true }, myRsvp: null }]);
    await fixture.whenStable();
    expect(query(fixture, 'meetings-home-rsvp-accepted')).not.toBeNull();
  });

  it("links Join to the viewer's join URL inside the window", async () => {
    state.set('live');
    link.set({ url: 'https://zoom.example.test/j/1', error: null, code: null });
    const fixture = await render();

    const anchor = query(fixture, 'meeting-details-schedule-join')?.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://zoom.example.test/j/1');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(text(fixture, 'meeting-details-schedule-in-progress')).toBe('The meeting is in progress.');
  });

  it('keeps Join busy while the link loads', async () => {
    state.set('soon');
    const fixture = await render();

    expect(query(fixture, 'meeting-details-schedule-join')?.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
    expect(query(fixture, 'meeting-details-schedule-in-progress')).toBeNull();
  });

  it('shows why the link failed, with a way to join with another email when the viewer is not registered', async () => {
    state.set('soon');
    link.set({ url: null, error: 'You are not registered for this meeting', code: 'NOT_REGISTERED_FOR_MEETING' });
    const fixture = await render();

    expect(text(fixture, 'meeting-details-schedule-join-error')).toBe(
      'You are not registered for this meeting. Click here to join using a different email address.'
    );
    expect(query(fixture, 'meeting-details-schedule-join-other-email')?.getAttribute('href')).toMatch(/\/meetings\/synthetic-meeting\?password=pw$/);

    meeting.set(buildMeeting({ password: 'fresh' }));
    fixture.detectChanges();
    expect(query(fixture, 'meeting-details-schedule-join-other-email')?.getAttribute('href')).toMatch(/\?password=fresh$/);
    expect(query(fixture, 'meeting-details-schedule-join')?.querySelector('button')?.getAttribute('aria-busy')).toBeNull();
  });

  it('says the meeting has ended and offers no Join', async () => {
    state.set('ended');
    const fixture = await render();

    expect(text(fixture, 'meeting-details-schedule-ended')).toBe('This meeting has ended.');
    expect(query(fixture, 'meeting-details-schedule-join')).toBeNull();
  });
});
