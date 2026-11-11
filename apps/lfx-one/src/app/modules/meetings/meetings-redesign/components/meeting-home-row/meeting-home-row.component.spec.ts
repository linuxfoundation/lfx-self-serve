// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDashboardView, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { formatMeetingWhen } from '@lfx-one/shared/utils';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UserService } from '@services/user.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';
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
  let openDetails: ReturnType<typeof vi.fn>;
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
    openDetails = vi.fn();
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
        { provide: MeetingsHomeStore, useValue: { lastMeeting: signal(null), approvedSummaries: signal(new Map()), now: signal(new Date()) } },
        { provide: MeetingOwnInviteResendService, useValue: { isResendingOwn: () => false } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal(new Set<string>()), getPublicMeetingJoinUrl } },
        { provide: MeetingRsvpService, useValue: { submittingMeetingIds: signal(new Set<string>()) } },
        {
          provide: UserService,
          useValue: { authenticated: signal(true), viewerUsername, meetingJoinIdentity: signal({ name: 'Real Viewer', email: 'real@example.test' }) },
        },
        { provide: MeetingsHomeEditService, useValue: { isChecking: () => false } },
        { provide: MeetingsHomeDeleteService, useValue: {} },
        { provide: MeetingsHomeDetailsService, useValue: { open: openDetails } },
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
      expect(texts(fixture, 'meetings-home-row-when').join(' · ')).toBe(formatMeetingWhen(START, 60));
      expect(texts(fixture, 'meetings-home-row-when')).toEqual([
        expect.stringMatching(/^\w{3}, \w{3} \d{1,2}$/),
        expect.stringMatching(/^\d{1,2}:\d{2} [AP]M$/),
        '60 min',
      ]);
      expect(text(fixture, 'meetings-home-row-type').replace('·', '').trim()).toBe('Technical');
      expect(query(fixture, 'meetings-home-row-recurring')).toBeNull();
      expect(query(fixture, 'meetings-home-row-attended')).toBeNull();
    });

    it.each<[number, string]>([
      [30, '30 min'],
      [90, '90 min'],
    ])("shows the occurrence's own title and a %i minute duration as %s", async (minutes, label) => {
      const fixture = await render(buildRow(buildMeeting(), { title: 'Occurrence title', durationMinutes: minutes }));

      expect(text(fixture, 'meetings-home-row-title')).toBe('Occurrence title');
      expect(texts(fixture, 'meetings-home-row-when').at(-1)).toBe(label);
    });

    it('names the repeat rule, and shows a short label with a tooltip in a body of 380px or less', async () => {
      const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '4' } });
      const fixture = await render(buildRow(meeting));
      const short = query(fixture, 'meetings-home-row-recurring-short');

      expect(text(fixture, 'meetings-home-row-recurring-label')).toBe('Every 2 weeks on Wednesday');
      expect(classes(fixture, 'meetings-home-row-recurring-label')).toEqual(expect.arrayContaining(['hidden', '@[381px]/body:inline-flex']));
      expect(short?.textContent?.trim()).toBe('Recurring');
      expect(short?.tabIndex).toBe(0);
      expect(short?.getAttribute('aria-label')).toBe('Repeats every 2 weeks on Wednesday');
      expect(classes(fixture, 'meetings-home-row-recurring-short')).toContain('@[381px]/body:hidden');
      expect(classes(fixture, 'meetings-home-row-recurring')).not.toContain('whitespace-nowrap');
      expect(fixture.debugElement.query(By.css('[data-testid="meetings-home-row-recurring-short"]')).injector.get(UiTooltipDirective).text()).toBe(
        'Repeats every 2 weeks on Wednesday'
      );
      expect(
        Array.from(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-row-recurring"] i')).map((icon) => (icon as HTMLElement).className)
      ).toEqual(['fa-light fa-arrows-repeat text-[11px]', 'fa-light fa-arrows-repeat text-[11px]']);
    });

    it('puts the type, then each group as an outline badge, then the organizers on the second meta line', async () => {
      const meeting = buildMeeting({
        committees: [
          { uid: 'c-1', name: 'TOC' },
          { uid: 'c-2', name: 'Security WG' },
        ],
        created_by: { name: 'Jane Doe', username: 'jdoe', email: '' },
      } as Partial<PastMeeting>);
      const fixture = await render(buildRow(meeting));
      const line = query(fixture, 'meetings-home-row-type')?.parentElement;
      const items = Array.from(line?.children ?? []).map((item) => (item as HTMLElement).dataset['testid']);

      expect(items).toEqual(['meetings-home-row-type', 'meetings-home-row-group', 'meetings-home-row-group', 'meetings-home-row-organizer']);
      expect(texts(fixture, 'meetings-home-row-group')).toEqual(['TOC', 'Security WG']);
      expect(query(fixture, 'meetings-home-row-group')?.querySelector('i')?.className).toBe('fa-light fa-users');
      expect(Array.from(line?.classList ?? [])).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
      expect(Array.from(line?.classList ?? [])).not.toContain('overflow-hidden');
      expect(classes(fixture, 'meetings-home-row-organizer')).toEqual(expect.arrayContaining(['flex-none', 'flex-wrap', 'max-w-full']));
    });

    it.each<[Partial<Meeting>, string[]]>([
      [{ visibility: MeetingVisibility.PUBLIC, restricted: false }, []],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: false }, ['private']],
      [{ visibility: MeetingVisibility.PUBLIC, restricted: true }, ['restricted']],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: true }, ['restricted', 'private']],
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
        expect.arrayContaining(['grid', 'grid-cols-[auto_minmax(0,1fr)_auto_auto]', 'items-start', 'py-[20px]', '@[861px]:flex', '@[861px]:flex-nowrap'])
      );
      expect(classes(fixture, 'meetings-home-row-actions')).toEqual(expect.arrayContaining(['contents', '@[861px]:flex']));
      expect(classes(fixture, 'meetings-home-row-menu')).toEqual(expect.arrayContaining(['col-start-4', 'row-start-1', '-my-[2px]']));
    });

    describe('organized by', () => {
      const jane = { name: 'Jane Doe', username: 'jdoe', email: '', profile_picture: 'https://example.org/jane.png' };
      const avatars = (fixture: ComponentFixture<MeetingHomeRowComponent>): HTMLElement[] =>
        Array.from(fixture.nativeElement.querySelectorAll('[data-testid="meetings-home-row-organizer-avatar"]'));

      it('shows one organizer as a hidden avatar with no tooltip, then the name', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: jane })));
        const [avatar] = avatars(fixture);

        expect(text(fixture, 'meetings-home-row-organizer').replace('·', '').trim()).toBe('Organized by:Jane Doe');
        expect(text(fixture, 'meetings-home-row-organizer-name')).toBe('Jane Doe');
        expect(avatars(fixture)).toHaveLength(1);
        expect(avatar.getAttribute('role')).toBeNull();
        expect(avatar.getAttribute('aria-label')).toBeNull();
        expect(avatar.getAttribute('tabindex')).toBeNull();
        expect(avatar.getAttribute('aria-hidden')).toBe('true');
        expect(avatar.querySelector('img')?.getAttribute('src')).toBe(jane.profile_picture);
        expect(fixture.debugElement.query(By.css('[data-testid="meetings-home-row-organizer-avatar"]')).injector.get(UiTooltipDirective).disabled()).toBe(true);
      });

      it('gives each of two organizers a labelled, focusable avatar with a tooltip', async () => {
        const fixture = await render(buildRow(buildMeeting({ created_by: jane, organizers: ['asmith'] })));
        const tooltips = fixture.debugElement
          .queryAll(By.css('[data-testid="meetings-home-row-organizer-avatar"]'))
          .map((el) => el.injector.get(UiTooltipDirective));

        expect(avatars(fixture).map((avatar) => [avatar.getAttribute('role'), avatar.getAttribute('tabindex'), avatar.getAttribute('aria-label')])).toEqual([
          ['img', '0', 'Jane Doe'],
          ['img', '0', 'asmith'],
        ]);
        expect(tooltips.map((tooltip) => [tooltip.text(), tooltip.disabled()])).toEqual([
          ['Jane Doe', false],
          ['asmith', false],
        ]);
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

        expect(text(fixture, 'meetings-home-row-organizer-name')).toBe('You');

        const stacked = await render(buildRow(buildMeeting({ created_by: { name: 'Viewer Person', username: 'viewer', email: '' }, organizers: ['asmith'] })));
        expect(avatars(stacked)[0].getAttribute('aria-label')).toBe('You');
      });

      it('hides the item without an owner or creator', async () => {
        const fixture = await render(buildRow(buildMeeting()));

        expect(query(fixture, 'meetings-home-row-organizer')).toBeNull();
      });
    });

    it('opens the details drawer on a click and keeps the meeting page link, in a new tab with the password and date', async () => {
      const row = buildRow(buildMeeting());
      const fixture = await render(row);
      const title = query(fixture, 'meetings-home-row-title');

      expect(title?.getAttribute('href')).toBe(`/meetings/123?password=secret&occurrence=${START.getTime()}`);
      expect(title?.getAttribute('target')).toBe('_blank');
      query(fixture, 'meetings-home-row-when')?.click();
      title?.click();

      expect(openDetails).toHaveBeenCalledTimes(2);
      expect(openDetails).toHaveBeenCalledWith(row, 'row');
      expect(open).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])('leaves a modified title click to the link (%o)', async (modifier) => {
      const fixture = await render(buildRow(buildMeeting()));
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, ...modifier });

      query(fixture, 'meetings-home-row-title')?.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
      expect(openDetails).not.toHaveBeenCalled();
    });

    it('jumps to the project without opening the row', async () => {
      const fixture = await render(buildRow(buildMeeting()));
      const eyebrow = query(fixture, 'meetings-home-row-project');

      expect(eyebrow?.getAttribute('href')).toBe('/project/overview?project=kubernetes');
      expect(eyebrow?.getAttribute('aria-label')).toBe('Jump to project: Kubernetes');
      eyebrow?.click();

      expect(navigateByUrl).toHaveBeenCalledWith('/project/overview?project=kubernetes');
      expect(openDetails).not.toHaveBeenCalled();
    });

    it('opens the row menu without opening the row', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      query(fixture, 'meetings-home-row-actions-trigger')?.querySelector('button')?.click();

      expect(openDetails).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('jumps to a foundation overview for foundation meetings', async () => {
      const fixture = await render(buildRow(buildMeeting({ project_name: 'CNCF', project_slug: 'cncf', is_foundation: true })));

      expect(query(fixture, 'meetings-home-row-project')?.getAttribute('href')).toBe('/foundation/overview?project=cncf');
      expect(query(fixture, 'meetings-home-row-project')?.getAttribute('aria-label')).toBe('Jump to foundation: CNCF');
    });

    it('shows the project logo, or the placeholder glyph without one', async () => {
      const withLogo = await render(buildRow(buildMeeting({ project_logo_url: 'https://cdn.example/logo.svg' })));
      expect(query(withLogo, 'meetings-home-project-logo-image')?.getAttribute('src')).toBe('https://cdn.example/logo.svg');

      const withoutLogo = await render(buildRow(buildMeeting({ project_name: 'kubernetes' })));
      expect(query(withoutLogo, 'meetings-home-project-logo-placeholder')).not.toBeNull();
      expect(withoutLogo.nativeElement.querySelector('lfx-meeting-project-logo')?.textContent?.trim()).toBe('');
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
      // At 480px or less the cell unwraps: the RSVP sits left on line 2.
      expect(classes(fixture, 'meetings-home-row-rsvp-cell')).toEqual(expect.arrayContaining(['contents', '@[481px]:col-[3/4]', '@[481px]:row-start-1']));
      expect(query(fixture, 'meetings-home-row-rsvp-cell')?.querySelector('lfx-meeting-rsvp-controls')?.parentElement?.className).toContain(
        'justify-self-start'
      );
      expect(fixture.debugElement.query(By.css('[data-testid="meetings-home-rsvp-accepted"]')).componentInstance.size()).toBe('small');
      query(fixture, 'meetings-home-rsvp')?.click();
      expect(openDetails).not.toHaveBeenCalled();
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
      expect(join?.querySelector('button')?.className).toContain('h-ui-xsmall');
      // At 480px or less Join sits right on the row's last line, above the attendance cell it shares.
      expect(join?.className).toContain('row-start-3');
      expect(join?.className).toContain('z-[1]');
      expect(join?.className).toContain('justify-self-end');
      expect(getPublicMeetingJoinUrl).toHaveBeenCalledWith('123', 'secret', { email: 'real@example.test' });
      join?.querySelector('button')?.click();

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/zoom\.example\.test\/j\/123\?uname=Real%20Viewer/), '_blank', 'noopener,noreferrer');
      expect(openDetails).not.toHaveBeenCalled();
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

  describe('organizer attendance', () => {
    it("shows the date's RSVP counts in a 220px popup trigger, and widens the actions over 860px", async () => {
      const fixture = await render(buildRow(buildMeeting({ rsvp_summary: { invited: 16, yes: 12, maybe: 2, no: 1, no_response: 1 } })));

      expect(text(fixture, 'meetings-home-attendance-label')).toBe('12 of 16 attending · 75%');
      expect(query(fixture, 'meetings-home-attendance-bar')?.getAttribute('aria-label')).toBe('Yes 12, Maybe 2, No 1, No response 1');
      expect(query(fixture, 'meetings-home-attendance-legend')).toBeNull();
      expect(query(fixture, 'meetings-home-attendance-trigger')?.getAttribute('role')).toBe('button');
      expect(fixture.nativeElement.querySelector('lfx-meeting-home-attendance-popup')?.classList).toContain('max-w-[220px]');
      expect(classes(fixture, 'meetings-home-row-actions')).toContain('@[861px]:min-w-[330px]');
      expect(classes(fixture, 'meetings-home-row')).toContain('@[601px]:grid-cols-[auto_minmax(0,1fr)_minmax(240px,auto)_auto]');
    });

    it('shows past attendance with the poorly-attended note', async () => {
      const fixture = await render(buildRow(buildMeeting({ attendance_summary: { invited: 20, attended: 9 } })), 'past');

      expect(text(fixture, 'meetings-home-attendance-label')).toBe('9 of 20 attended · 45%');
      expect(text(fixture, 'meetings-home-attendance-poor')).toBe('This meeting was poorly attended');
    });

    it('shows nothing and keeps the plain layout without counts', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      expect(query(fixture, 'meetings-home-row-attendance')).toBeNull();
      expect(classes(fixture, 'meetings-home-row-actions')).not.toContain('@[861px]:min-w-[330px]');
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
      const meeting = buildMeeting({ has_recording: true, recording_share_url: 'https://zoom.example/rec', has_ai_summary: true });
      const past = await render(buildRow(meeting), 'past');
      const upcoming = await render(buildRow(meeting));

      expect(query(past, 'meetings-home-row-recording')).toBeTruthy();
      expect(query(past, 'meetings-home-row-summary')).toBeTruthy();
      expect(query(past, 'meetings-home-rsvp')).toBeNull();
      expect(query(upcoming, 'meetings-home-row-artifacts')).toBeNull();
      expect(classes(past, 'meetings-home-row-artifacts-cell')).toEqual(
        expect.arrayContaining(['col-[2/-1]', 'row-start-2', '@[481px]:col-[3/4]', '@[481px]:row-start-1', 'hidden', 'has-[div]:flex'])
      );
      // At 480px or less the buttons sit left and wrap, so a phone row never overflows.
      expect(classes(past, 'meetings-home-row-artifacts-cell')).toEqual(
        expect.arrayContaining(['justify-self-start', '[&>*>div]:shrink', '[&>*>div]:flex-wrap', '@[481px]:[&>*>div]:flex-nowrap'])
      );
    });

    it('opens the details drawer on a click and links invitees to the meeting page in place', async () => {
      const row = buildRow(buildMeeting({ meeting_and_occurrence_id: '123-1759334400000' }));
      const fixture = await render(row, 'past');

      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('href')).toBe('/meetings/123-1759334400000');
      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('target')).toBeNull();
      query(fixture, 'meetings-home-row')?.click();

      expect(openDetails).toHaveBeenCalledWith(row, 'row');
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('links organizers to the admin details page with the project', async () => {
      const fixture = await render(buildRow(buildMeeting({ meeting_and_occurrence_id: '123-1759334400000', organizer: true })), 'past');

      expect(query(fixture, 'meetings-home-row-title')?.getAttribute('href')).toBe('/project/meetings/123-1759334400000/details?project=kubernetes');
    });
  });
});
