// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDetailsDrawerData, MeetingDetailsTab, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';
import { MeetingDetailsDrawerComponent } from './meeting-details-drawer.component';
import { MeetingDetailsContext } from './meeting-details.context';
import { MeetingDetailsScheduleComponent } from './schedule/meeting-details-schedule.component';

// The schedule section has its own spec; the shell only places it.
@Component({ selector: 'lfx-meeting-details-schedule', template: '' })
class ScheduleStubComponent {}

const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_name: 'Synthetic Project',
  project_slug: 'synthetic-project',
  meeting_type: 'Technical',
  visibility: 'public',
  restricted: false,
  committees: [{ uid: 'c1', name: 'Synthetic TSC' }],
  password: 'synthetic-pass',
  invited: true,
  organizer: false,
  show_meeting_attendees: false,
  recording_enabled: true,
  transcript_enabled: false,
  youtube_upload_enabled: false,
  ai_summary_enabled: false,
  organizers: [],
  timezone: 'Pacific/Chatham',
  created_by: { username: 'synthetic-owner', name: 'Synthetic Owner', email: 'owner@acme.example' },
  recurrence: null,
  occurrences: [],
} as unknown as Meeting;

const row = (meeting: Meeting | PastMeeting, overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow => ({
  key: meeting.id,
  meeting,
  occurrence: null,
  title: meeting.title,
  occurrenceId: null,
  startTime: '2026-11-05T18:00:00Z',
  durationMinutes: 60,
  ...overrides,
});

describe('MeetingDetailsDrawerComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsDrawerComponent>;
  let now: WritableSignal<Date>;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let edit: ReturnType<typeof vi.fn>;
  let cancelOccurrence: ReturnType<typeof vi.fn>;
  let requestClose: ReturnType<typeof vi.fn<() => void>>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let refreshUserPastMeetings: ReturnType<typeof vi.fn>;
  let clearRemovedRegistration: ReturnType<typeof vi.fn>;
  let closeDialog: ReturnType<typeof vi.fn>;
  let dialogClosed: Subject<void>;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  };
  const render = async (value: MeetingHomeRow, tab: MeetingDetailsTab = 'agenda', detail$: Observable<Meeting> = of(value.meeting)): Promise<void> => {
    getMeetingDetail.mockReturnValue(detail$);
    const page = Injector.create({
      providers: [
        { provide: MeetingsHomeStore, useValue: { now } },
        { provide: MeetingsHomeEditService, useValue: { edit } },
        { provide: MeetingsHomeDeleteService, useValue: { cancelOccurrence } },
      ],
    });
    const data: MeetingDetailsDrawerData = { row: value, tab, injector: page };
    TestBed.overrideProvider(DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(MeetingDetailsDrawerComponent);
    await settle();
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const findAll = (testId: string): HTMLElement[] => [...fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`)];
  const context = (): MeetingDetailsContext => fixture.debugElement.injector.get(MeetingDetailsContext);
  const click = async (testId: string): Promise<void> => {
    (find(testId)?.querySelector('button') ?? find(testId))?.click();
    await settle();
  };

  beforeEach(() => {
    now = signal(new Date('2026-11-05T12:00:00Z'));
    getMeetingDetail = vi.fn();
    toastShow = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    edit = vi.fn();
    cancelOccurrence = vi.fn(() => of(true));
    requestClose = vi.fn<() => void>();
    refreshUserMeetings = vi.fn();
    refreshUserPastMeetings = vi.fn();
    clearRemovedRegistration = vi.fn();
    closeDialog = vi.fn();
    dialogClosed = new Subject<void>();
    const drawerContext = new UiDrawerContext('right', 1080);
    drawerContext.requestClose = requestClose;

    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: null },
        { provide: UiDrawerContext, useValue: drawerContext },
        { provide: DialogRef, useValue: { close: closeDialog, closed: dialogClosed } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show: toastShow } },
        {
          provide: MeetingService,
          useValue: {
            getMeetingDetail,
            clearRemovedRegistration,
            removedRegistrationMeetingIds: signal(new Set<string>()),
            getMeetingRegistrants: () => of([]),
            getPastMeetingParticipants: () => of([]),
            getPastMeetingRecording: () => of({ sessions: [{ total_size: 1, share_url: 'https://zoom.example/rec' }] }),
            getPastMeetingTranscript: () => of({ recording_files: [] }),
            getPastMeetingSummary: () => throwError(() => new HttpErrorResponse({ status: 404 })),
            getMeetingAttachments: () => of([]),
            getPastMeetingAttachments: () => of([]),
            attachmentChanges: signal(new Map()),
            attachmentScopeOverrides: signal(new Map()),
            // Upcoming guests stay loading, so tests set the hosts and count themselves.
            getMyMeetingRegistrants: () => NEVER,
          },
        },
        { provide: CommitteeService, useValue: { getCommitteeMembers: () => of([]) } },
        {
          provide: UserService,
          useValue: {
            viewerUsername: signal('synthetic-viewer'),
            user: signal(null),
            refreshUserMeetings,
            refreshUserPastMeetings,
            confirmedMeetingRsvps: () => [],
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingDetailsDrawerComponent, {
      remove: { imports: [MeetingDetailsScheduleComponent] },
      add: { imports: [ScheduleStubComponent] },
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  describe('title block', () => {
    it('shows the project, title, badges and organizer', async () => {
      await render(row(MEETING));

      expect(find('meeting-details-title')?.textContent?.trim()).toBe('Synthetic sync');
      expect(find('meeting-details-project')?.textContent).toContain('Synthetic Project');
      expect(find('meeting-details-visibility-public')?.textContent?.trim()).toBe('Public');
      expect(find('meeting-details-type')?.textContent?.trim()).toBe('Technical');
      expect(find('meeting-details-group')?.textContent?.trim()).toBe('Synthetic TSC');
      expect(find('meeting-details-group')?.getAttribute('role')).toBe('button');
      expect(find('meeting-details-group')?.getAttribute('aria-label')).toBe('View group: Synthetic TSC');
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      find('meeting-details-group')?.click();
      expect(open).toHaveBeenCalledWith('/groups/c1', '_blank', 'noopener,noreferrer');
      open.mockRestore();
      expect(findAll('meeting-details-feature-recording_enabled')).toHaveLength(1);
      expect(findAll('meeting-details-feature-transcript_enabled')).toHaveLength(0);
      expect(find('meeting-details-organizer-name')?.textContent?.trim()).toBe('Synthetic Owner');
      expect(find('meeting-details-organizer-name')?.getAttribute('href')).toMatch(/^mailto:owner@acme\.example\?subject=Synthetic%20sync/);
      expect(find('meeting-details-scheduled-zone')?.textContent).toContain('Scheduled in Pacific/Chatham');
    });

    it('re-reads an upcoming meeting and shows the fresh detail, bypassing the cache for organizers', async () => {
      const organizerRow = row({ ...MEETING, organizer: true });
      await render(organizerRow, 'agenda', of({ ...MEETING, organizer: true, transcript_enabled: true, invited: undefined } as unknown as Meeting));

      expect(getMeetingDetail).toHaveBeenCalledWith('synthetic-meeting', { skipCache: true });
      expect(findAll('meeting-details-feature-transcript_enabled')).toHaveLength(1);
    });

    it('keeps the row data and shows an error toast when the detail fails', async () => {
      await render(
        row(MEETING),
        'agenda',
        throwError(() => new Error('down'))
      );

      expect(find('meeting-details-title')?.textContent?.trim()).toBe('Synthetic sync');
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Meeting details unavailable' }));
    });

    it('closes and reloads the list when the meeting is gone or no longer visible', async () => {
      await render(
        row(MEETING),
        'agenda',
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );

      expect(closeDialog).toHaveBeenCalledTimes(1);
      expect(refreshUserMeetings).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting unavailable' }));
    });

    it('titles the shown date', async () => {
      await render(row(MEETING));
      context().occurrence.set({ occurrence_id: 'occ-2', title: 'Special session', start_time: '2026-11-12T18:00:00Z', duration: 60 });
      await settle();

      expect(find('meeting-details-title')?.textContent?.trim()).toBe('Special session');
    });

    it('adds the guests section hosts to Organized by for a viewer who may see the guests', async () => {
      const host = { first_name: 'Host', last_name: 'Person', username: 'host', email: 'host@acme.example', host: true };
      await render(row({ ...MEETING, show_meeting_attendees: true }));
      context().hosts.set([host]);
      await settle();

      expect(findAll('meeting-details-organizer-avatar').map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
        'Email Synthetic Owner',
        'Email Host Person',
      ]);
    });

    it('leaves the hosts out when the guest list is hidden from the viewer', async () => {
      await render(row(MEETING));
      context().hosts.set([{ first_name: 'Host', last_name: 'Person', username: 'host', email: 'host@acme.example', host: true }]);
      await settle();

      expect(find('meeting-details-organizer-name')?.textContent?.trim()).toBe('Synthetic Owner');
    });

    it('makes a described visibility badge focusable with its description as label', async () => {
      await render(row({ ...MEETING, visibility: 'private' } as Meeting));
      const badge = findAll('meeting-details-badges')[0]?.querySelector('[role="img"][tabindex="0"]');

      expect(badge?.getAttribute('aria-label')).toMatch(/^Private: /);
    });

    it('titles the browser tab with the shown meeting', async () => {
      await render(row(MEETING));

      expect(TestBed.inject(Title).getTitle()).toBe('Synthetic sync · LFX');
    });

    it('does not re-read a past meeting', async () => {
      const past = {
        ...MEETING,
        id: 'synthetic-meeting-1762362000000',
        meeting_id: 'synthetic-meeting',
        scheduled_start_time: '2026-11-01T18:00:00Z',
      } as PastMeeting;
      await render(row(past));

      expect(getMeetingDetail).not.toHaveBeenCalled();
      expect(context().state()).toBe('ended');
      expect(context().pastMeetingId()).toBe('synthetic-meeting-1762362000000');
    });

    it('badges an ended date with the artifacts that exist only', async () => {
      const past = {
        ...MEETING,
        id: 'synthetic-meeting-1762362000000',
        meeting_id: 'synthetic-meeting',
        scheduled_start_time: '2026-11-01T18:00:00Z',
        transcript_enabled: true,
        ai_summary_enabled: true,
      } as PastMeeting;
      await render(row(past));

      expect(findAll('meeting-details-feature-recording_enabled')).toHaveLength(1);
      expect(findAll('meeting-details-feature-transcript_enabled')).toHaveLength(0);
      expect(findAll('meeting-details-feature-ai_summary_enabled')).toHaveLength(0);
    });
  });

  describe('tabs', () => {
    it('hides the tabs and shows the agenda when the guest list is not shared with the viewer', async () => {
      await render(row(MEETING), 'guests');

      expect(find('meeting-details-tabs')).toBeNull();
      expect(find('meeting-details-agenda')?.classList.contains('hidden')).toBe(false);
      expect(find('meeting-details-guests')).toBeNull();
    });

    it('opens an organizer on the requested tab and switches between them', async () => {
      await render(row({ ...MEETING, organizer: true }), 'guests');

      expect(find('meeting-details-guests')?.getAttribute('role')).toBe('tabpanel');
      expect(find('meeting-details-guests')?.hasAttribute('inert')).toBe(false);
      expect(find('meeting-details-agenda')?.hasAttribute('inert')).toBe(true);
      expect(find('ui-tab-guests')?.textContent).toContain('Guests');

      await click('ui-tab-agenda');
      expect(context().tab()).toBe('agenda');
      expect(find('meeting-details-agenda')?.classList.contains('hidden')).toBe(false);
      expect(find('meeting-details-guests')?.classList.contains('hidden')).toBe(true);
    });

    it('keeps the guests section mounted but hidden and inert, so its count shows before the tab opens', async () => {
      await render(row({ ...MEETING, organizer: true }));
      const guests = find('meeting-details-guests');
      expect(guests?.classList.contains('hidden')).toBe(true);
      expect(guests?.hasAttribute('inert')).toBe(true);
      expect(find('ui-tab-count-guests')).toBeNull();

      context().guestCount.set(12);
      await settle();
      expect(find('ui-tab-count-guests')?.textContent?.trim()).toBe('12');
    });

    it('drops the header and tabs fades over a non-empty guests list', async () => {
      const fades = (): number => fixture.nativeElement.querySelectorAll('.bg-gradient-to-b').length;
      await render(row({ ...MEETING, organizer: true }), 'guests');
      expect(fades()).toBe(2);

      context().guestCount.set(3);
      await settle();
      expect(fades()).toBe(0);

      await click('ui-tab-agenda');
      expect(fades()).toBe(2);
    });

    it('names the tab Participants once the date has ended', async () => {
      now.set(new Date('2026-11-05T20:00:00Z'));
      await render(row({ ...MEETING, organizer: true }));

      expect(find('ui-tab-guests')?.textContent).toContain('Participants');
    });
  });

  describe('header', () => {
    it('copies the meeting link with its passcode', async () => {
      await render(row(MEETING));
      await click('meeting-details-copy-link');

      expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/meetings/synthetic-meeting?password=synthetic-pass`);
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting link copied to clipboard' });
    });

    it('copies the past meeting link without the passcode once the date has ended', async () => {
      now.set(new Date('2026-11-05T19:45:00Z'));
      await render(row(MEETING));
      await click('meeting-details-copy-link');

      expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/meetings/synthetic-meeting-${Date.parse('2026-11-05T18:00:00Z')}`);
    });

    it('reports a failed copy', async () => {
      copy.mockReturnValue(false);
      await render(row(MEETING));
      await click('meeting-details-copy-link');

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Copy Failed' }));
    });

    it('offers no menu to an invitee', async () => {
      await render(row(MEETING));

      expect(find('meeting-details-more')).toBeNull();
    });

    it('offers Edit Meeting to an organizer, closing the drawer first', async () => {
      const organizerRow = row({ ...MEETING, organizer: true });
      await render(organizerRow);
      await click('meeting-details-more');
      (TestBed.inject(OverlayContainer).getContainerElement().querySelector('[data-testid="meeting-details-edit"]') as HTMLElement).click();
      await settle();

      expect(closeDialog).toHaveBeenCalled();
      expect(edit).not.toHaveBeenCalled();
      dialogClosed.next();
      expect(edit).toHaveBeenCalledWith(organizerRow);
    });

    it('offers no Edit Meeting on a past row, even for a coming date', async () => {
      const past = {
        ...MEETING,
        organizer: true,
        created_by: { username: 'synthetic-owner', name: 'Synthetic Owner', email: 'owner@acme.example' },
        id: 'synthetic-meeting-1762362000000',
        meeting_id: 'synthetic-meeting',
        scheduled_start_time: '2026-11-01T18:00:00Z',
      } as PastMeeting;
      await render(row(past));
      context().occurrence.set({ occurrence_id: 'occ-2', title: '', start_time: '2026-11-12T18:00:00Z', duration: 60 });
      await settle();

      expect(context().state()).not.toBe('ended');
      expect(find('meeting-details-more')).toBeNull();
      await click('meeting-details-copy-link');
      expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/meetings/synthetic-meeting?password=synthetic-pass`);
      expect(find('meeting-details-organizer-name')?.getAttribute('href')).toContain(
        `body=${encodeURIComponent(`${environment.urls.home}/meetings/synthetic-meeting`)}`
      );
    });

    describe('Cancel Occurrence', () => {
      const OCCURRENCE = { occurrence_id: 'occ-1', title: '', start_time: '2026-11-05T18:00:00Z', duration: 60 };
      const series = (overrides: Partial<Meeting> = {}): MeetingHomeRow =>
        row({ ...MEETING, organizer: true, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, ...overrides } as Meeting, {
          occurrence: OCCURRENCE,
          occurrenceId: 'occ-1',
        });
      const menuItem = (testId: string): HTMLElement | null =>
        TestBed.inject(OverlayContainer).getContainerElement().querySelector(`[data-testid="${testId}"]`);

      it.each([
        [true, 1],
        [false, 0],
      ])('cancels the shown date through the page flow and closes only once it is cancelled (%s)', async (cancelled, closes) => {
        cancelOccurrence.mockReturnValue(of(cancelled));
        const seriesRow = series();
        await render(seriesRow);
        await click('meeting-details-more');

        expect(menuItem('meeting-details-edit')).not.toBeNull();
        expect(menuItem('meeting-details-cancel-occurrence')?.textContent?.trim()).toBe('Cancel Occurrence');
        menuItem('meeting-details-cancel-occurrence')?.click();
        await settle();

        expect(cancelOccurrence).toHaveBeenCalledWith(seriesRow, OCCURRENCE, 'drawer');
        expect(requestClose).toHaveBeenCalledTimes(closes);
      });

      it('offers it without Edit Meeting when the meeting has no project', async () => {
        await render(series({ project_slug: undefined }));
        await click('meeting-details-more');

        expect(menuItem('meeting-details-edit')).toBeNull();
        expect(menuItem('meeting-details-cancel-occurrence')).not.toBeNull();
      });

      it('is not offered on a past row, even for a coming date', async () => {
        const past = { ...series().meeting, id: 'synthetic-meeting-1762362000000', meeting_id: 'synthetic-meeting' } as unknown as PastMeeting;
        await render(row(past, { occurrence: OCCURRENCE, occurrenceId: 'occ-1' }));

        expect(find('meeting-details-more')).toBeNull();
      });

      it('is not offered on a one-time meeting', async () => {
        await render(row({ ...MEETING, organizer: true }));
        await click('meeting-details-more');

        expect(menuItem('meeting-details-cancel-occurrence')).toBeNull();
      });

      it('is not offered to an invitee', async () => {
        await render(series({ organizer: false }));

        expect(find('meeting-details-more')).toBeNull();
      });

      it('is not offered once the date has ended', async () => {
        now.set(new Date('2026-11-06T12:00:00Z'));
        await render(series());

        expect(find('meeting-details-more')).toBeNull();
      });
    });

    it('closes through the drawer so its close guard runs', async () => {
      await render(row(MEETING));
      await click('meeting-details-close');

      expect(requestClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('context', () => {
    it('follows the page clock through the join window', async () => {
      await render(row(MEETING));
      expect(context().state()).toBe('far');

      now.set(new Date('2026-11-05T17:55:00Z'));
      expect(context().state()).toBe('soon');
      now.set(new Date('2026-11-05T18:10:00Z'));
      expect(context().state()).toBe('live');
      // Still live through the end buffer, while the row keeps offering Join.
      now.set(new Date('2026-11-05T19:40:00Z'));
      expect(context().state()).toBe('live');
      expect(context().pastMeetingId()).toBeNull();
      now.set(new Date('2026-11-05T19:41:00Z'));
      expect(context().state()).toBe('ended');
    });

    it('rebuilds the row for another shown date', async () => {
      const opened = row(MEETING, { occurrenceId: 'occ-1', myRsvp: null });
      await render(opened);
      expect(context().shownRow()).toBe(opened);

      context().occurrence.set({ occurrence_id: 'occ-2', title: 'Special session', start_time: '2026-11-12T18:00:00Z', duration: 90 });
      expect(context().shownRow()).toEqual({
        ...opened,
        key: 'synthetic-meeting:occ-2',
        occurrence: { occurrence_id: 'occ-2', title: 'Special session', start_time: '2026-11-12T18:00:00Z', duration: 90 },
        title: 'Special session',
        occurrenceId: 'occ-2',
        startTime: '2026-11-12T18:00:00Z',
        durationMinutes: 90,
        myRsvp: undefined,
      });
    });

    it('refreshes the feed the shown date belongs to', async () => {
      await render(row(MEETING));
      context().refreshList();
      expect(refreshUserMeetings).toHaveBeenCalledTimes(1);

      now.set(new Date('2026-11-06T00:00:00Z'));
      context().refreshList();
      expect(refreshUserPastMeetings).toHaveBeenCalledTimes(1);
    });

    it('counts a registration made in the drawer as an invitation and refreshes the list', async () => {
      await render(row({ ...MEETING, invited: false } as Meeting));
      expect(context().invited()).toBe(false);

      context().markRegistered();
      expect(clearRemovedRegistration).toHaveBeenCalledWith(MEETING.id);
      expect(context().invited()).toBe(true);
      expect(refreshUserMeetings).toHaveBeenCalledTimes(1);
    });
  });
});
