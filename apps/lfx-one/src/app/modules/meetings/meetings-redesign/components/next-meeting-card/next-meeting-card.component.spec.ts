// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingRsvp } from '@lfx-one/shared/interfaces';
import { formatMeetingTimeRange } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NextMeetingCardComponent } from './next-meeting-card.component';

const MINUTE_MS = 60_000;
const inMinutes = (minutes: number): Date => new Date(Date.now() + minutes * MINUTE_MS);

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: '123',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Kubernetes',
    project_slug: 'kubernetes',
    start_time: inMinutes(3 * 24 * 60).toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: 'Series title',
    description: '',
    recurrence: null,
    committees: [{ uid: 'c-1', name: 'TOC' }],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: 'secret',
    invited: true,
    occurrences: [],
    ...overrides,
  };
}

function buildRow(meeting: Meeting, start: Date = new Date(meeting.start_time), overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow {
  return {
    key: meeting.id,
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: null,
    startTime: start.toISOString(),
    durationMinutes: 60,
    ...overrides,
  };
}

function rsvp(registrant: string, response: MeetingRsvp['response_type']): MeetingRsvp {
  return {
    id: `r-${registrant}`,
    meeting_id: '123',
    registrant_id: registrant,
    username: registrant,
    email: `${registrant}@example.test`,
    name: `Person ${registrant}`,
    response_type: response,
    scope: 'all',
    created_at: new Date().toISOString(),
  };
}

describe('NextMeetingCardComponent', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  const render = async (
    row: MeetingHomeRow | null,
    inputs: { loading?: boolean; rsvps?: MeetingRsvp[] | null; joinable?: boolean; joinUrl?: string | null } = {}
  ): Promise<ComponentFixture<NextMeetingCardComponent>> => {
    const fixture = TestBed.createComponent(NextMeetingCardComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('now', new Date());
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<NextMeetingCardComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (fixture: ComponentFixture<NextMeetingCardComponent>, testId: string): string => query(fixture, testId)?.textContent?.trim() ?? '';
  const joinButton = (fixture: ComponentFixture<NextMeetingCardComponent>): HTMLButtonElement =>
    query(fixture, 'meetings-home-next-card-join')?.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    open = vi.fn();
    vi.stubGlobal('open', open);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate, navigateByUrl: vi.fn() } }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the empty card without an upcoming date', async () => {
    const fixture = await render(null);

    expect(query(fixture, 'meetings-home-next-card')).toBeNull();
    expect(text(fixture, 'meetings-home-next-card-empty')).toContain('Your calendar is clear');
    expect(text(fixture, 'meetings-home-next-card-empty')).toContain('Your scheduled meetings will appear here.');
  });

  it('shows a skeleton card while the upcoming feed loads', async () => {
    const fixture = await render(null, { loading: true });

    expect(query(fixture, 'meetings-home-next-card-loading')?.getAttribute('role')).toBe('status');
    expect(query(fixture, 'meetings-home-next-card-empty')).toBeNull();
  });

  it('renders the date tile, project, title, time range, recurrence and tags', async () => {
    const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' } });
    const start = new Date(meeting.start_time);
    const fixture = await render(buildRow(meeting, start, { title: 'Occurrence title' }));

    expect(text(fixture, 'meetings-home-next-card-date')).toContain(String(start.getDate()));
    expect(query(fixture, 'meetings-home-next-card-visibility-public')).toBeTruthy();
    expect(text(fixture, 'meetings-home-next-card-project')).toMatch(/Kubernetes$/);
    expect(text(fixture, 'meetings-home-next-card-title')).toBe('Occurrence title');
    const weekday = start.toLocaleString('en-US', { weekday: 'short' });
    expect(text(fixture, 'meetings-home-next-card-when')).toBe(`${weekday}, ${formatMeetingTimeRange(start, 60)} · 60m`);
    expect(text(fixture, 'meetings-home-next-card-recurring')).toBe('Recurring');
    expect(text(fixture, 'meetings-home-next-card-type')).toBe('Technical');
    expect(text(fixture, 'meetings-home-next-card-groups')).toBe('TOC');
  });

  it('opens the meeting in a new tab on a card click', async () => {
    const fixture = await render(buildRow(buildMeeting()));

    query(fixture, 'meetings-home-next-card')?.click();

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\/meetings\/123\?password=secret/), '_blank', 'noopener,noreferrer');
  });

  describe('attendees', () => {
    it('shows the people going or maybe and the going and maybe counts', async () => {
      const fixture = await render(buildRow(buildMeeting()), {
        rsvps: [rsvp('a', 'accepted'), rsvp('b', 'maybe'), rsvp('c', 'declined'), rsvp('d', 'accepted')],
      });

      expect(text(fixture, 'meetings-home-next-card-counts')).toBe('2 going · 1 maybe');
      const avatars = Array.from<HTMLElement>(query(fixture, 'meetings-home-next-card-attendees')?.querySelectorAll('lfx-ui-avatar') ?? []);
      expect(avatars).toHaveLength(3);
    });

    it.each<[string, MeetingRsvp[] | null]>([
      ['the roster is hidden from the viewer', []],
      ['the responses are still loading', null],
    ])('hides the row while %s', async (_, rsvps) => {
      const fixture = await render(buildRow(buildMeeting()), { rsvps });

      expect(query(fixture, 'meetings-home-next-card-attendees')).toBeNull();
    });
  });

  describe('join', () => {
    it('is disabled outside the join window, and clicking it does not open the card', async () => {
      const fixture = await render(buildRow(buildMeeting()), { joinable: false, joinUrl: null });

      expect(joinButton(fixture).disabled).toBe(true);
      query(fixture, 'meetings-home-next-card-join')?.click();

      expect(open).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('opens the join link in a new tab', async () => {
      const fixture = await render(buildRow(buildMeeting()), { joinable: true, joinUrl: 'https://zoom.example.test/j/123?uname=Real' });

      expect(joinButton(fixture).disabled).toBe(false);
      query(fixture, 'meetings-home-next-card-join')?.click();

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('https://zoom.example.test/j/123?uname=Real', '_blank', 'noopener,noreferrer');
    });

    it('falls back to the meeting page with the password without a join link', async () => {
      const fixture = await render(buildRow(buildMeeting()), { joinable: true, joinUrl: null });

      query(fixture, 'meetings-home-next-card-join')?.click();

      expect(open).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/meetings', '123'], { queryParams: { password: 'secret' } });
    });
  });

  describe('starts-in note', () => {
    it.each<[number, string | null]>([
      [30, 'Meeting starts in 30 min'],
      [3 * 60 + 5, 'Meeting starts in 3 h'],
      [2 * 24 * 60, null],
    ])('%i minutes out → %s', async (minutes, label) => {
      const start = inMinutes(minutes);
      const fixture = await render(buildRow(buildMeeting({ start_time: start.toISOString() }), start));

      expect(query(fixture, 'meetings-home-next-card-starts-in')?.textContent?.trim() ?? null).toBe(label);
    });
  });
});
