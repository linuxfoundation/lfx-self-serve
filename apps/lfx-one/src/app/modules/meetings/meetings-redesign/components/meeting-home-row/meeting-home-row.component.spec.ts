// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDashboardView, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UserService } from '@services/user.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';
import { MeetingHomeRowComponent } from './meeting-home-row.component';

const START = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

function buildMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: '123',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Kubernetes',
    project_slug: 'kubernetes',
    is_foundation: false,
    start_time: START.toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: 'Series title',
    description: '',
    recurrence: null,
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
    password: 'secret',
    invited: true,
    occurrences: [],
    ...overrides,
  } as PastMeeting;
}

function buildRow(meeting: Meeting, overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow {
  return {
    key: meeting.id,
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: null,
    startTime: START.toISOString(),
    durationMinutes: 60,
    ...overrides,
  };
}

describe('MeetingHomeRowComponent', () => {
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let getPublicMeetingJoinUrl: ReturnType<typeof vi.fn>;
  const viewerUsername = signal<string | null>('viewer');

  const render = async (row: MeetingHomeRow, view: MeetingDashboardView = 'upcoming'): Promise<ComponentFixture<MeetingHomeRowComponent>> => {
    const fixture = TestBed.createComponent(MeetingHomeRowComponent);
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('view', view);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingHomeRowComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (fixture: ComponentFixture<MeetingHomeRowComponent>, testId: string): string => query(fixture, testId)?.textContent?.trim() ?? '';
  const texts = (fixture: ComponentFixture<MeetingHomeRowComponent>, testId: string): string[] =>
    Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`)).map(
      (element) => element.textContent?.replace('·', '').trim() ?? ''
    );
  const classes = (fixture: ComponentFixture<MeetingHomeRowComponent>, testId: string): string[] => Array.from(query(fixture, testId)?.classList ?? []);

  beforeEach(() => {
    navigateByUrl = vi.fn().mockResolvedValue(true);
    navigate = vi.fn().mockResolvedValue(true);
    open = vi.fn();
    getPublicMeetingJoinUrl = vi.fn(() => of({ link: 'https://zoom.example.test/j/123' }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    vi.stubGlobal('open', open);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl, navigate } },
        { provide: MeetingsHomeStore, useValue: { lastMeeting: signal(null), now: signal(new Date()) } },
        { provide: MeetingOwnInviteResendService, useValue: { isResendingOwn: () => false } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal(new Set<string>()), getPublicMeetingJoinUrl } },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        {
          provide: UserService,
          useValue: { authenticated: signal(true), viewerUsername, meetingJoinIdentity: signal({ name: 'Real Viewer', email: 'real@example.test' }) },
        },
        { provide: MeetingsHomeEditService, useValue: { isChecking: () => false } },
        { provide: MeetingsHomeDeleteService, useValue: {} },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('upcoming', () => {
    it('renders the date tile, project, title and meta line', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      expect(text(fixture, 'meetings-home-row-date-month')).toBe(START.toLocaleString('en-US', { month: 'short' }));
      expect(query(fixture, 'meetings-home-row-date-month')?.className).toContain('bg-blue-500');
      expect(text(fixture, 'meetings-home-row-date-day')).toBe(String(START.getDate()));
      expect(text(fixture, 'meetings-home-row-project-name')).toBe('Kubernetes');
      expect(text(fixture, 'meetings-home-row-title')).toBe('Series title');
      const weekday = START.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = START.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      expect(texts(fixture, 'meetings-home-row-when')).toEqual([weekday, time, '1h']);
      expect(text(fixture, 'meetings-home-row-type').replace('·', '').trim()).toBe('Technical');
      expect(query(fixture, 'meetings-home-row-recurring')).toBeNull();
      expect(query(fixture, 'meetings-home-row-attended')).toBeNull();
    });

    it.each<[number, string]>([
      [30, '30m'],
      [90, '1h 30m'],
    ])("shows the occurrence's own title and a %i minute duration as %s", async (minutes, label) => {
      const fixture = await render(buildRow(buildMeeting(), { title: 'Occurrence title', durationMinutes: minutes }));

      expect(text(fixture, 'meetings-home-row-title')).toBe('Occurrence title');
      expect(texts(fixture, 'meetings-home-row-when').at(-1)).toBe(label);
    });

    it('labels a recurring meeting with its repeat rule', async () => {
      const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '4' } });
      const fixture = await render(buildRow(meeting));

      expect(text(fixture, 'meetings-home-row-recurring')).toBe('Recurring');
      expect(query(fixture, 'meetings-home-row-recurring')?.tabIndex).toBe(0);
    });

    it.each<[Partial<Meeting>, string[]]>([
      [{ visibility: MeetingVisibility.PUBLIC, restricted: false }, []],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: false }, ['private']],
      [{ visibility: MeetingVisibility.PUBLIC, restricted: true }, ['restricted']],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: true }, ['private', 'restricted']],
    ])('shows the visibility badges for %j', async (overrides, kinds) => {
      const fixture = await render(buildRow(buildMeeting(overrides)));
      const badges = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid^="meetings-home-row-visibility-"]'));

      expect(badges.map((badge) => badge.getAttribute('aria-label')?.toLowerCase())).toEqual(kinds);
      expect(badges.every((badge) => badge.tabIndex === 0)).toBe(true);
    });

    it('sizes the tile 40×42, and 46×48 in a centre over 860px', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      expect(classes(fixture, 'meetings-home-row-date')).toEqual(
        expect.arrayContaining(['w-[40px]', 'h-[42px]', 'rounded-[8px]', '@[861px]:w-[46px]', '@[861px]:h-[48px]', '@[861px]:rounded-[10px]'])
      );
      expect(classes(fixture, 'meetings-home-row-date-month')).toEqual(
        expect.arrayContaining(['h-[13px]', 'text-[8px]', 'rounded-t-[8px]', '@[861px]:h-[14px]', '@[861px]:text-[8.5px]', '@[861px]:rounded-t-[10px]'])
      );
      expect(classes(fixture, 'meetings-home-row-date-day')).toEqual(expect.arrayContaining(['text-[16px]', '@[861px]:text-[19px]']));
    });

    it('lays the row out as a top-aligned grid, and one nowrap line over 860px', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      expect(classes(fixture, 'meetings-home-row')).toEqual(
        expect.arrayContaining(['grid', 'grid-cols-[auto_minmax(0,1fr)_auto_auto]', 'items-start', '@[861px]:flex', '@[861px]:flex-nowrap'])
      );
      expect(classes(fixture, 'meetings-home-row-actions')).toEqual(expect.arrayContaining(['contents', '@[861px]:flex']));
      expect(classes(fixture, 'meetings-home-row-menu')).toEqual(expect.arrayContaining(['col-start-4', 'row-start-1', '-my-[4px]']));
    });

    describe('organized by', () => {
      const jane = { name: 'Jane Doe', username: 'jdoe', email: '', profile_picture: 'https://example.org/jane.png' };
      const avatars = (fixture: ComponentFixture<MeetingHomeRowComponent>): HTMLElement[] =>
        Array.from(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-row-organizer-avatar"]'));

      it('shows one organizer as a labelled avatar with a tooltip, then the name', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: jane })));
        const [avatar] = avatars(fixture);

        expect(text(fixture, 'meetings-home-row-organizer').replace('·', '').trim()).toBe('Organized by:Jane Doe');
        expect(text(fixture, 'meetings-home-row-organizer-name')).toBe('Jane Doe');
        expect(avatars(fixture)).toHaveLength(1);
        expect(avatar.getAttribute('role')).toBe('img');
        expect(avatar.getAttribute('aria-label')).toBe('Jane Doe');
        expect(avatar.getAttribute('tabindex')).toBe('0');
        expect(avatar.querySelector('img')?.getAttribute('src')).toBe(jane.profile_picture);
        expect(fixture.debugElement.query(By.css('[data-testid="meetings-home-row-organizer-avatar"]')).injector.get(UiTooltipDirective).text()).toBe(
          'Jane Doe'
        );
      });

      it('draws 18px avatars with the design initials, overlapping 5px after the first', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: { ...jane, profile_picture: undefined }, organizers: ['asmith'] })));
        const [first, second] = avatars(fixture);
        const avatar = second.querySelector<HTMLElement>('lfx-ui-avatar');

        expect(first.style.marginLeft).toBe('0px');
        expect(second.style.marginLeft).toBe('-5px');
        expect(avatar?.style.width).toBe('18px');
        expect(Array.from(avatar?.classList ?? [])).toEqual(expect.arrayContaining(['!text-[8px]', '!font-semibold', 'ring-2', 'ring-ui-background-100']));
        expect(avatar?.getAttribute('aria-hidden')).toBe('true');
        expect(first.textContent?.trim()).toBe('JD');
        expect(second.textContent?.trim()).toBe('AS');
      });

      it('shows several organizers as avatars only, with no names or count', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: jane, organizers: ['jdoe', 'auth0|asmith', 'bking'] })));

        expect(avatars(fixture).map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Jane Doe', 'asmith', 'bking']);
        expect(query(fixture, 'meetings-home-row-organizer-name')).toBeNull();
        expect(text(fixture, 'meetings-home-row-organizer')).not.toContain('+');
      });

      it('names the viewer "You"', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: { name: 'Viewer Person', username: 'viewer', email: '' }, organizers: ['viewer'] })));

        expect(avatars(fixture)[0].getAttribute('aria-label')).toBe('You');
        expect(text(fixture, 'meetings-home-row-organizer-name')).toBe('You');
      });

      it('hides the item without an owner or creator', async () => {
        const fixture = await render(buildRow(buildMeeting()));

        expect(query(fixture, 'meetings-home-row-organizer')).toBeNull();
      });
    });

    it('opens the meeting page in a new tab with the password and date', async () => {
      const fixture = await render(buildRow(buildMeeting()));
      const url = `/meetings/123?password=secret&occurrence=${START.getTime()}`;

      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('href')).toBe(url);
      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('target')).toBe('_blank');
      query(fixture, 'meetings-home-row-when')?.click();

      expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('jumps to the project without opening the row', async () => {
      const fixture = await render(buildRow(buildMeeting()));
      const eyebrow = query(fixture, 'meetings-home-row-project');

      expect(eyebrow?.getAttribute('href')).toBe('/project/overview?project=kubernetes');
      expect(eyebrow?.getAttribute('aria-label')).toBe('Jump to project: Kubernetes');
      eyebrow?.click();

      expect(navigateByUrl).toHaveBeenCalledWith('/project/overview?project=kubernetes');
      expect(open).not.toHaveBeenCalled();
    });

    it('opens the row menu without opening the row', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      query(fixture, 'meetings-home-row-actions-trigger')?.querySelector('button')?.click();

      expect(open).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('jumps to a foundation overview for foundation meetings', async () => {
      const fixture = await render(buildRow(buildMeeting({ project_name: 'CNCF', project_slug: 'cncf', is_foundation: true })));

      expect(query(fixture, 'meetings-home-row-project')?.getAttribute('href')).toBe('/foundation/overview?project=cncf');
      expect(query(fixture, 'meetings-home-row-project')?.getAttribute('aria-label')).toBe('Jump to foundation: CNCF');
    });

    it('shows the project logo, or its initial without one', async () => {
      const withLogo = await render(buildRow(buildMeeting({ project_logo_url: 'https://cdn.example/logo.svg' })));
      expect(withLogo.nativeElement.querySelector('[data-testid="ui-avatar-image"]')?.getAttribute('src')).toBe('https://cdn.example/logo.svg');

      const withoutLogo = await render(buildRow(buildMeeting({ project_name: 'kubernetes' })));
      expect(withoutLogo.nativeElement.querySelector('[data-testid="ui-avatar-initials"]')?.textContent?.trim()).toBe('K');
    });

    it('shows the project as plain text without a slug, and nothing without a name', async () => {
      const noSlug = await render(buildRow(buildMeeting({ project_slug: undefined })));
      expect(query(noSlug, 'meetings-home-row-project')?.tagName).toBe('SPAN');

      const noName = await render(buildRow(buildMeeting({ project_name: undefined })));
      expect(query(noName, 'meetings-home-row-project')).toBeNull();
    });

    it('hides the type when the meeting has none', async () => {
      const fixture = await render(buildRow(buildMeeting({ meeting_type: 'None' })));

      expect(query(fixture, 'meetings-home-row-type')).toBeNull();
    });
  });

  describe('RSVP', () => {
    it('shows the RSVP controls on upcoming rows without opening the row on a click', async () => {
      const fixture = await render(buildRow(buildMeeting({ is_invite_responses_enabled: true }), { myRsvp: null }));

      expect(query(fixture, 'meetings-home-rsvp')).not.toBeNull();
      expect(classes(fixture, 'meetings-home-row-rsvp-cell')).toEqual(
        expect.arrayContaining(['col-[2/-1]', 'row-start-2', '@[481px]:col-[3/4]', '@[481px]:row-start-1'])
      );
      expect(fixture.debugElement.query(By.css('[data-testid="meetings-home-rsvp-accepted"]')).componentInstance.size()).toBe('small');
      query(fixture, 'meetings-home-rsvp')?.click();
      expect(open).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('has no RSVP controls on past rows', async () => {
      const fixture = await render(buildRow(buildMeeting({ is_invite_responses_enabled: true })), 'past');

      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();
    });
  });

  describe('join', () => {
    const soon = (): string => new Date(Date.now() + 5 * 60_000).toISOString();

    it('shows Join inside the join window and opens the link built for the viewer without opening the row', async () => {
      const fixture = await render(buildRow(buildMeeting(), { startTime: soon() }));
      const join = query(fixture, 'meetings-home-row-join');

      expect(join?.querySelector('button')?.getAttribute('aria-label')).toBe('Join Series title');
      expect(join?.querySelector('button')?.className).toContain('h-ui-tiny');
      expect(getPublicMeetingJoinUrl).toHaveBeenCalledWith('123', 'secret', { email: 'real@example.test' });
      join?.querySelector('button')?.click();

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/zoom\.example\.test\/j\/123\?uname=Real%20Viewer/), '_blank', 'noopener,noreferrer');
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('falls back to the meeting page with the password when the join link fails to load', async () => {
      getPublicMeetingJoinUrl.mockReturnValue(throwError(() => new Error('upstream down')));
      const fixture = await render(buildRow(buildMeeting(), { startTime: soon() }));

      query(fixture, 'meetings-home-row-join')?.querySelector('button')?.click();

      expect(open).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/meetings', '123'], { queryParams: { password: 'secret' } });
    });

    it.each<[string, Partial<Meeting>, MeetingDashboardView, number]>([
      ['outside the join window', {}, 'upcoming', 3 * 24 * 60],
      ['on a restricted meeting the viewer is not invited to', { restricted: true, invited: false }, 'upcoming', 5],
      ['on past rows', {}, 'past', 5],
    ])('has no Join %s', async (_label, overrides, view, minutes) => {
      const fixture = await render(buildRow(buildMeeting(overrides), { startTime: new Date(Date.now() + minutes * 60_000).toISOString() }), view);

      expect(query(fixture, 'meetings-home-row-join')).toBeNull();
      expect(getPublicMeetingJoinUrl).not.toHaveBeenCalled();
    });
  });

  describe('past', () => {
    it('uses the grey band and marks a meeting I attended', async () => {
      const fixture = await render(buildRow(buildMeeting({ user_attended: true })), 'past');

      expect(query(fixture, 'meetings-home-row-date-month')?.className).toContain('bg-gray-200');
      expect(text(fixture, 'meetings-home-row-attended')).toBe('Attended');
    });

    it('has no Attended mark when I did not attend', async () => {
      const fixture = await render(buildRow(buildMeeting({ user_attended: false })), 'past');

      expect(query(fixture, 'meetings-home-row-attended')).toBeNull();
    });

    it('shows Recording and AI Summary in place of the RSVP controls, and never on upcoming rows', async () => {
      const meeting = buildMeeting({ has_recording: true, has_ai_summary: true });
      const past = await render(buildRow(meeting), 'past');
      const upcoming = await render(buildRow(meeting));

      expect(query(past, 'meetings-home-row-recording')).toBeTruthy();
      expect(query(past, 'meetings-home-row-summary')).toBeTruthy();
      expect(query(past, 'meetings-home-rsvp')).toBeNull();
      expect(query(upcoming, 'meetings-home-row-artifacts')).toBeNull();
      expect(classes(past, 'meetings-home-row-artifacts-cell')).toEqual(expect.arrayContaining(['col-[2/-1]', 'row-start-2', 'hidden', 'has-[div]:flex']));
    });

    it('opens the meeting page in place for invitees', async () => {
      const fixture = await render(buildRow(buildMeeting({ meeting_and_occurrence_id: '123-1759334400000' })), 'past');

      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('target')).toBeNull();
      query(fixture, 'meetings-home-row')?.click();

      expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123-1759334400000');
      expect(open).not.toHaveBeenCalled();
    });

    it('opens the admin details page with the project for organizers', async () => {
      const fixture = await render(buildRow(buildMeeting({ meeting_and_occurrence_id: '123-1759334400000', organizer: true })), 'past');

      query(fixture, 'meetings-home-row-title')?.click();

      expect(navigateByUrl).toHaveBeenCalledTimes(1);
      expect(navigateByUrl).toHaveBeenCalledWith('/project/meetings/123-1759334400000/details?project=kubernetes');
    });
  });
});
