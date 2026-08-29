// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { BEHAVIORAL_CLASS_CALENDAR_COLORS } from '@lfx-one/shared/constants';
import { GroupService } from '@services/group.service';
import { MeetingService } from '@services/meeting.service';
import { headerTestProviders, installMatchMediaShim } from '@shared/testing/header-test-providers';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventInput } from '@fullcalendar/core';
import type { PublicCalendarMeeting, PublicGroupSummary, PublicProjectMeetingsResponse } from '@lfx-one/shared/interfaces';

import { PublicProjectCalendarComponent } from './public-project-calendar.component';

beforeAll(installMatchMediaShim);

const TSC_UID = '11111111-1111-4111-8111-111111111111';
const BOARD_UID = '22222222-2222-4222-8222-222222222222';
/** Comfortably ended, so the occurrence renders with the past treatment rather than its group colour. */
const PAST_START = '2020-01-01T15:00:00Z';

function meeting(over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting {
  return {
    id: 'meeting-1',
    title: 'Technical Steering Committee',
    start_time: '2999-09-01T15:00:00Z',
    duration: 60,
    timezone: 'America/New_York',
    ...over,
  };
}

function group(over: Partial<PublicGroupSummary> = {}): PublicGroupSummary {
  return {
    uid: TSC_UID,
    name: 'TSC',
    category: 'Technical Steering Committee',
    behavioral_class: 'oversight-committee',
    context: { scope: 'project', foundation_uid: 'f1', foundation_name: 'CNCF', foundation_slug: 'cncf' },
    ...over,
  };
}

function response(over: Partial<PublicProjectMeetingsResponse> = {}): PublicProjectMeetingsResponse {
  return {
    meetings: [meeting()],
    total: 1,
    project: { uid: 'p1', name: 'Kubernetes' },
    ...over,
  };
}

describe('PublicProjectCalendarComponent', () => {
  let fixture: ComponentFixture<PublicProjectCalendarComponent>;
  let getPublicProjectMeetings: ReturnType<typeof vi.fn>;
  let getPublicProjectGroups: ReturnType<typeof vi.fn>;
  let queryParamMap: BehaviorSubject<Map<string, string>>;

  /** Reads the protected signals the template binds to, without loosening their visibility in the component. */
  function instance(): { calendarEvents: () => EventInput[]; initialView: () => string; clearCommitteeFilter: () => void } {
    return fixture.componentInstance as unknown as {
      calendarEvents: () => EventInput[];
      initialView: () => string;
      clearCommitteeFilter: () => void;
    };
  }

  async function render(
    options: {
      response?: PublicProjectMeetingsResponse;
      fail?: boolean;
      groups?: PublicGroupSummary[];
      groupsFail?: boolean;
      slug?: string;
      query?: Map<string, string>;
    } = {}
  ): Promise<void> {
    const { fail = false, groupsFail = false, slug = 'kubernetes' } = options;
    queryParamMap = new BehaviorSubject(options.query ?? new Map<string, string>());
    getPublicProjectMeetings = vi.fn(() => (fail ? throwError(() => new Error('upstream 503')) : of(options.response ?? response())));
    getPublicProjectGroups = vi.fn(() =>
      groupsFail ? throwError(() => new Error('directory 503')) : of({ groups: options.groups ?? [], total: (options.groups ?? []).length })
    );

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PublicProjectCalendarComponent],
      providers: [
        ...headerTestProviders(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeetingService, useValue: { getPublicProjectMeetings } },
        { provide: GroupService, useValue: { getPublicProjectGroups } },
        // After provideRouter, which also provides ActivatedRoute — the last provider wins, and the
        // router's own empty paramMap would otherwise silently swallow the slug/committee assertions.
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['projectSlug', slug]])), queryParamMap: queryParamMap.asObservable() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicProjectCalendarComponent);
    await fixture.whenStable();
  }

  it('renders the project name and meeting count once the feed resolves', async () => {
    await render();

    const title = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-title"]');
    const subtitle = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-subtitle"]');
    expect(title?.textContent?.trim()).toBe('Kubernetes — Calendar');
    expect(subtitle?.textContent?.trim()).toBe('1 meeting');
    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-container"]')).not.toBeNull();
  });

  it('shows the error state and no calendar when the feed fails', async () => {
    await render({ fail: true });

    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-container"]')).toBeNull();
  });

  it('scopes the request to a committee when ?committee= is present', async () => {
    await render({ query: new Map([['committee', TSC_UID]]) });

    expect(getPublicProjectMeetings).toHaveBeenCalledWith('kubernetes', TSC_UID);
  });

  it('opens on the week view when ?view=week, and the month view otherwise', async () => {
    await render({ query: new Map([['view', 'week']]) });
    expect(instance().initialView()).toBe('timeGridWeek');

    await render();
    expect(instance().initialView()).toBe('dayGridMonth');
  });

  it('does not refetch when only ?view changes', async () => {
    // Regression lock: the fetch pipeline reads queryParamMap for `committee`, so without
    // distinctUntilChanged on {slug, committeeUid} a pure month/week toggle would re-enter
    // switchMap, re-hit the upstream feed, and flash the loading skeleton.
    await render();
    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);

    queryParamMap.next(new Map([['view', 'week']]));
    await fixture.whenStable();

    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);
  });

  it('refetches when the committee filter changes', async () => {
    await render();
    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);

    queryParamMap.next(new Map([['committee', TSC_UID]]));
    await fixture.whenStable();

    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(2);
    expect(getPublicProjectMeetings).toHaveBeenLastCalledWith('kubernetes', TSC_UID);
  });

  describe('group filter', () => {
    it('renders the filter and a colour legend once the public directory resolves', async () => {
      await render({
        groups: [group()],
        response: response({
          meetings: [meeting({ committee_uids: [TSC_UID] }), meeting({ id: 'meeting-2', start_time: PAST_START, committee_uids: [TSC_UID] })],
        }),
      });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-filters"]')).not.toBeNull();
      const legend = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-legend"]');
      expect(legend?.textContent).toContain('Oversight');
      expect(legend?.textContent).toContain('Past');
    });

    it('suppresses a legend that would carry a single colour, which distinguishes nothing', async () => {
      await render({
        groups: [group()],
        response: response({ meetings: [meeting({ committee_uids: [TSC_UID] })] }),
      });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-legend"]')).toBeNull();
    });

    it('does not render the filter when the directory has no groups', async () => {
      await render({ groups: [] });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-filters"]')).toBeNull();
    });

    it('keeps rendering the calendar when the group directory fetch fails', async () => {
      // The directory only supplies labels and colours — losing it must not escalate to the page error state.
      await render({ groupsFail: true });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-container"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-error"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-filters"]')).toBeNull();
    });

    it('colours events by behavioural class and suffixes the group name when unfiltered', async () => {
      await render({
        groups: [group()],
        response: response({ meetings: [meeting({ committee_uids: [TSC_UID] })] }),
      });

      const [event] = instance().calendarEvents();
      expect(event.title).toBe('Technical Steering Committee · TSC');
      expect(event.backgroundColor).toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['oversight-committee'].bg);
    });

    it('drops the redundant group suffix while a filter is applied', async () => {
      await render({
        groups: [group()],
        query: new Map([['committee', TSC_UID]]),
        response: response({ meetings: [meeting({ committee_uids: [TSC_UID] })] }),
      });

      const [event] = instance().calendarEvents();
      expect(event.title).toBe('Technical Steering Committee');
      expect(event.backgroundColor).toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['oversight-committee'].bg);
    });

    it('prefers the server-computed behavioural class over one derived from the category', async () => {
      // Guards against the calendar's colours drifting from the badges the public group directory
      // renders, which read `behavioral_class` directly.
      await render({
        groups: [group({ behavioral_class: 'governing-board' })],
        response: response({ meetings: [meeting({ committee_uids: [TSC_UID] })] }),
      });

      const [event] = instance().calendarEvents();
      expect(event.backgroundColor).toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['governing-board'].bg);
    });

    it('names only the colours actually on the canvas, not the ones the groups imply', async () => {
      // The oversight meeting has ended, so it renders in the past treatment rather than its group's
      // colour. A legend built from committee associations would advertise an "Oversight" swatch that
      // appears nowhere on screen — worse than no legend, since the legend is the colour key.
      await render({
        groups: [group(), group({ uid: BOARD_UID, name: 'Governing Board', behavioral_class: 'governing-board' })],
        response: response({
          meetings: [meeting({ committee_uids: [TSC_UID], start_time: PAST_START }), meeting({ id: 'meeting-2', committee_uids: [BOARD_UID] })],
        }),
      });

      const legend = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-legend"]');
      expect(legend?.textContent).toContain('Past');
      expect(legend?.textContent).toContain('Boards');
      expect(legend?.textContent).not.toContain('Oversight');
    });

    it('treats a malformed committee param as an unknown group without calling the feed', async () => {
      // The server rejects a non-UUID committee with a 400, which would otherwise surface as the
      // generic page error rather than the group-not-found state it really is.
      await render({ groups: [group()], query: new Map([['committee', 'tsc']]) });

      expect(getPublicProjectMeetings).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-unknown-committee"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-error"]')).toBeNull();
    });

    it('leaves committees missing from the public directory unlabelled', async () => {
      // A PUBLIC meeting can belong to a committee the directory does not list; nothing about it,
      // name included, is publishable, so the event falls back to default styling.
      await render({
        groups: [group()],
        response: response({ meetings: [meeting({ committee_uids: [BOARD_UID] })] }),
      });

      const [event] = instance().calendarEvents();
      expect(event.title).toBe('Technical Steering Committee');
      expect(event.backgroundColor).not.toBe(BEHAVIORAL_CLASS_CALENDAR_COLORS['oversight-committee'].bg);
    });

    it('distinguishes an unknown committee filter from an empty calendar', async () => {
      await render({
        groups: [group()],
        query: new Map([['committee', BOARD_UID]]),
        response: response({ meetings: [], total: 0 }),
      });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-unknown-committee"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-empty"]')).toBeNull();
    });

    it('shows the empty state when a known group has no public meetings', async () => {
      await render({
        groups: [group()],
        query: new Map([['committee', TSC_UID]]),
        response: response({ meetings: [], total: 0 }),
      });

      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-empty"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-unknown-committee"]')).toBeNull();
    });

    it('clears the filter through the URL so the view stays shareable', async () => {
      await render({ groups: [group()], query: new Map([['committee', TSC_UID]]) });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      instance().clearCommitteeFilter();

      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { committee: null }, queryParamsHandling: 'merge' }));
    });
  });
});
