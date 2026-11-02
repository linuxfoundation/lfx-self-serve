// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDashboardView, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { formatMeetingTimeRange } from '@lfx-one/shared/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let open: ReturnType<typeof vi.fn>;

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

  beforeEach(() => {
    navigateByUrl = vi.fn().mockResolvedValue(true);
    open = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public disconnect = vi.fn();
      }
    );
    vi.stubGlobal('open', open);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigateByUrl } }] });
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
      expect(text(fixture, 'meetings-home-row-when')).toBe(`${weekday} · ${formatMeetingTimeRange(START, 60)} · 60 min`);
      expect(text(fixture, 'meetings-home-row-type')).toBe('Technical');
      expect(query(fixture, 'meetings-home-row-recurring')).toBeNull();
      expect(query(fixture, 'meetings-home-row-attended')).toBeNull();
    });

    it("shows the occurrence's own title and duration", async () => {
      const fixture = await render(buildRow(buildMeeting(), { title: 'Occurrence title', durationMinutes: 90 }));

      expect(text(fixture, 'meetings-home-row-title')).toBe('Occurrence title');
      expect(text(fixture, 'meetings-home-row-when')).toMatch(/ · 90 min$/);
    });

    it('labels a recurring meeting with its repeat rule', async () => {
      const meeting = buildMeeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '4' } });
      const fixture = await render(buildRow(meeting));

      expect(text(fixture, 'meetings-home-row-recurring')).toBe('Recurring');
    });

    it.each<[Partial<Meeting>, string[]]>([
      [{ visibility: MeetingVisibility.PUBLIC, restricted: false }, ['public']],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: false }, ['private']],
      [{ visibility: MeetingVisibility.PUBLIC, restricted: true }, ['restricted']],
      [{ visibility: MeetingVisibility.PRIVATE, restricted: true }, ['private', 'restricted']],
    ])('shows the visibility badges for %j', async (overrides, kinds) => {
      const fixture = await render(buildRow(buildMeeting(overrides)));
      const badges = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid^="meetings-home-row-visibility-"]'));

      expect(badges.map((badge) => badge.getAttribute('aria-label')?.toLowerCase())).toEqual(kinds);
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
