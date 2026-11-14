// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { formatMeetingWhen } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';

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

describe('NextMeetingCardComponent', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let openDetails: ReturnType<typeof vi.fn>;

  const render = async (
    row: MeetingHomeRow | null,
    inputs: { loading?: boolean; joinable?: boolean; joinUrl?: string | null } = {}
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
    openDetails = vi.fn();
    vi.stubGlobal('open', open);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate, navigateByUrl: vi.fn() } },
        { provide: UserService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: MeetingsHomeDetailsService, useValue: { open: openDetails } },
      ],
    });
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

  it('renders the date tile, project, title, date line and the type and recurring tags', async () => {
    const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' } });
    const start = new Date(meeting.start_time);
    const fixture = await render(buildRow(meeting, start, { title: 'Occurrence title' }));

    expect(text(fixture, 'meetings-home-next-card-date')).toContain(String(start.getDate()));
    expect(text(fixture, 'meetings-home-next-card-project')).toMatch(/Kubernetes$/);
    expect(text(fixture, 'meetings-home-next-card-title')).toBe('Occurrence title');
    expect(text(fixture, 'meetings-home-next-card-when')).toBe(formatMeetingWhen(start, 60));
    expect(text(fixture, 'meetings-home-next-card-type')).toBe('Technical');
    expect(text(fixture, 'meetings-home-next-card-recurring')).toBe('Recurring');
    expect(query(fixture, 'meetings-home-next-card-recurring')?.querySelector('i')?.classList).toContain('fa-arrows-repeat');
  });

  it('badges each of the meeting groups between the type and recurring tags', async () => {
    const meeting = buildMeeting({
      committees: [
        { uid: 'c-1', name: 'TOC' },
        { uid: 'c-2', name: 'Security WG' },
      ],
      recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' },
    });
    const fixture = await render(buildRow(meeting));
    const tags = Array.from(fixture.nativeElement.querySelectorAll('lfx-ui-badge')).map((badge) => (badge as HTMLElement).dataset['testid']);
    const groups = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-next-card-group"]')) as HTMLElement[];

    expect(groups.map((group) => group.textContent?.trim())).toEqual(['TOC', 'Security WG']);
    expect(groups[0].querySelector('i')?.classList).toContain('fa-users');
    expect(groups[1].getAttribute('title')).toBe('Security WG');
    expect(groups[1].querySelector('span')?.classList).toContain('truncate');
    expect(tags).toEqual([
      'meetings-home-next-card-type',
      'meetings-home-next-card-group',
      'meetings-home-next-card-group',
      'meetings-home-next-card-recurring',
    ]);
  });

  it("shows the date's RSVP counts with a legend for an organized meeting, and nothing without counts", async () => {
    const series = buildMeeting({ rsvp_summary: { invited: 9, yes: 9, maybe: 0, no: 0, no_response: 0 } });
    const occurrence = {
      occurrence_id: 'o-1',
      title: 'Series title',
      start_time: series.start_time,
      duration: 60,
      rsvp_summary: { invited: 10, yes: 4, maybe: 3, no: 1, no_response: 2 },
    };
    const organized = await render(buildRow(series, undefined, { occurrence, occurrenceId: 'o-1' }));
    const other = await render(buildRow(buildMeeting()));

    expect(text(organized, 'meetings-home-attendance-label')).toBe('4 of 10 attending · 40%');
    expect(query(organized, 'meetings-home-attendance-legend')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Yes 4 Maybe 3 No 1 No response 2');
    expect(query(other, 'meetings-home-next-card-attendance')).toBeNull();
  });

  it('badges only Private and Restricted meetings on the tile', async () => {
    const badges = async (overrides: Partial<Meeting>): Promise<string[]> => {
      const fixture = await render(buildRow(buildMeeting(overrides)));
      return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="meetings-home-next-card-visibility-"]')).map(
        (badge) => (badge as HTMLElement).dataset['testid'] ?? ''
      );
    };

    expect(await badges({ visibility: MeetingVisibility.PUBLIC, restricted: false })).toEqual([]);
    expect(await badges({ visibility: MeetingVisibility.PRIVATE, restricted: false })).toEqual(['meetings-home-next-card-visibility-private']);
    expect(await badges({ visibility: MeetingVisibility.PUBLIC, restricted: true })).toEqual(['meetings-home-next-card-visibility-restricted']);
    expect(await badges({ visibility: MeetingVisibility.PRIVATE, restricted: true })).toEqual([
      'meetings-home-next-card-visibility-restricted',
      'meetings-home-next-card-visibility-private',
    ]);
  });

  it('shows no recurring tag for a one-off meeting', async () => {
    const fixture = await render(buildRow(buildMeeting()));

    expect(query(fixture, 'meetings-home-next-card-recurring')).toBeNull();
  });

  it('opens the details drawer on a card or title click, keeping the title a new-tab link to the meeting', async () => {
    const row = buildRow(buildMeeting());
    const fixture = await render(row);
    const title = query(fixture, 'meetings-home-next-card-title');

    expect(title?.getAttribute('href')).toMatch(/^\/meetings\/123\?password=secret/);
    expect(title?.getAttribute('target')).toBe('_blank');
    query(fixture, 'meetings-home-next-card')?.click();
    title?.click();

    expect(openDetails).toHaveBeenCalledTimes(2);
    expect(openDetails).toHaveBeenCalledWith(row, 'next_card');
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves a modified title click to the link', async () => {
    const fixture = await render(buildRow(buildMeeting()));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });

    query(fixture, 'meetings-home-next-card-title')?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(openDetails).not.toHaveBeenCalled();
  });

  describe('join', () => {
    it('is disabled outside the join window, and clicking it does not open the card', async () => {
      const fixture = await render(buildRow(buildMeeting()), { joinable: false, joinUrl: null });

      expect(joinButton(fixture).disabled).toBe(true);
      query(fixture, 'meetings-home-next-card-join')?.click();

      expect(openDetails).not.toHaveBeenCalled();
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

  describe('join note', () => {
    const notes = (fixture: ComponentFixture<NextMeetingCardComponent>): { window: string | null; startsIn: string | null; live: string | null } => ({
      window: query(fixture, 'meetings-home-next-card-join-window')?.textContent?.trim() ?? null,
      startsIn: query(fixture, 'meetings-home-next-card-starts-in')?.textContent?.trim() ?? null,
      live: query(fixture, 'meetings-home-next-card-in-progress')?.textContent?.trim() ?? null,
    });
    const renderAt = (minutes: number, overrides: Partial<Meeting> = {}): Promise<ComponentFixture<NextMeetingCardComponent>> => {
      const start = inMinutes(minutes);
      return render(buildRow(buildMeeting({ start_time: start.toISOString(), ...overrides }), start));
    };

    it('before the join window, says how early the viewer may join', async () => {
      expect(notes(await renderAt(3 * 60))).toEqual({
        window: 'You may only join the meeting up to 10 minutes before the start time',
        startsIn: null,
        live: null,
      });
      expect(notes(await renderAt(45, { early_join_time_minutes: 30 })).window).toBe('You may only join the meeting up to 30 minutes before the start time');
    });

    it('inside the join window, counts down to the start', async () => {
      expect(notes(await renderAt(5))).toEqual({ window: null, startsIn: 'Meeting starts in 5 min', live: null });
      expect(notes(await renderAt(25, { early_join_time_minutes: 30 })).startsIn).toBe('Meeting starts in 25 min');
    });

    it('while the meeting runs, says it is in progress next to a live dot', async () => {
      const fixture = await renderAt(-10);

      expect(notes(fixture)).toEqual({ window: null, startsIn: null, live: 'The meeting is in progress' });
      expect(query(fixture, 'meetings-home-next-card-in-progress')?.classList).toContain('text-blue-600');
      expect(query(fixture, 'meetings-home-next-card-in-progress')?.querySelector('.meeting-live-dot')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('shows no note once the date is over', async () => {
      expect(notes(await renderAt(-90))).toEqual({ window: null, startsIn: null, live: null });
    });

    it('counts down in a neutral 12px note with a clock icon', async () => {
      const fixture = await renderAt(5);
      const note = query(fixture, 'meetings-home-next-card-starts-in');

      expect(Array.from(note?.classList ?? [])).toEqual(expect.arrayContaining(['text-label-12', 'text-gray-500']));
      expect(Array.from(note?.classList ?? []).some((name) => name.startsWith('bg-'))).toBe(false);
      expect(Array.from(note?.querySelector('i')?.classList ?? [])).toEqual(expect.arrayContaining(['fa-clock', 'text-[12px]']));
    });
  });
});
