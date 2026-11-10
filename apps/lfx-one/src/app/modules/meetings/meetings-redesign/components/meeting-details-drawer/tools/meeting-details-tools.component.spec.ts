// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Meeting, MeetingDetailsState, MeetingHomeRow, MeetingRegistrant, MeetingRsvp, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { hasMeetingFullAccess } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDialogsService } from '../../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingAttendeeGridComponent } from '../../meeting-attendee-grid/meeting-attendee-grid.component';
import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsReconcileDialogComponent } from '../reconcile/meeting-details-reconcile-dialog.component';
import { MeetingDetailsArtifactsService } from './meeting-details-artifacts.service';
import { MeetingDetailsToolsComponent } from './meeting-details-tools.component';

const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  visibility: 'private',
  restricted: false,
  invited: true,
  organizer: false,
  project_slug: 'synthetic-project',
  is_invite_responses_enabled: true,
  recurrence: null,
  occurrences: [],
} as unknown as Meeting;

const SUMMARY = {
  uid: 's-1',
  approved: false,
  requires_approval: true,
  summary_data: { content: 'Notes', edited_content: '' },
} as PastMeetingSummary;

const registrant = (uid: string, response: string | null, email = `${uid}@acme.example`): MeetingRegistrant =>
  ({ uid, email, rsvp: response ? { registrant_id: uid, response_type: response } : null }) as unknown as MeetingRegistrant;

describe('MeetingDetailsToolsComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsToolsComponent>;
  let meeting: WritableSignal<Meeting>;
  let state: WritableSignal<MeetingDetailsState>;
  let pastMeetingId: WritableSignal<string | null>;
  let tab: WritableSignal<string>;
  let canViewGuests: WritableSignal<boolean>;
  let confirmed: WritableSignal<MeetingRsvp[]>;
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;
  let removedIds: WritableSignal<Set<string>>;
  let removedUids: WritableSignal<ReadonlySet<string>>;
  let guestCount: WritableSignal<number | null>;
  let registered: WritableSignal<boolean>;
  let toastShow: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let edit: ReturnType<typeof vi.fn>;
  let closed: Subject<void>;
  let closeDialog: ReturnType<typeof vi.fn>;
  let openSummary: ReturnType<typeof vi.fn>;
  let openRecording: ReturnType<typeof vi.fn>;
  let copyRecordingLink: ReturnType<typeof vi.fn>;
  let applySummaryChange: ReturnType<typeof vi.fn>;
  let windowOpen: ReturnType<typeof vi.fn>;
  let modalOpen: ReturnType<typeof vi.fn>;
  let participantsVersion: WritableSignal<number>;
  let refreshParticipants: ReturnType<typeof vi.fn>;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
  };
  const render = async (overrides: Partial<Meeting> = {}, dateState: MeetingDetailsState = 'far'): Promise<void> => {
    meeting.set({ ...MEETING, ...overrides });
    state.set(dateState);
    pastMeetingId.set(dateState === 'ended' ? 'synthetic-meeting-1762362000000' : null);
    fixture = TestBed.createComponent(MeetingDetailsToolsComponent);
    await settle();
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => find(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const click = async (testId: string): Promise<void> => {
    ((find(testId)?.querySelector('button') ?? find(testId)) as HTMLElement).click();
    await settle();
  };

  beforeEach(() => {
    meeting = signal(MEETING);
    state = signal<MeetingDetailsState>('far');
    pastMeetingId = signal<string | null>(null);
    canViewGuests = signal(true);
    tab = signal('agenda');
    confirmed = signal<MeetingRsvp[]>([]);
    removedIds = signal(new Set<string>());
    removedUids = signal(new Set<string>());
    guestCount = signal<number | null>(null);
    registered = signal(false);
    meetingService = {
      getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
      getPastMeetingParticipants: vi.fn().mockReturnValue(of([])),
      getPastMeetingRecording: vi.fn().mockReturnValue(of({ sessions: [{ total_size: 1, share_url: 'https://zoom.example/rec' }] })),
      getPastMeetingTranscript: vi.fn().mockReturnValue(of({ recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.example/vtt' }] })),
      getPastMeetingSummary: vi.fn().mockReturnValue(of(SUMMARY)),
      getPublicMeeting: vi.fn().mockReturnValue(of({ meeting: {} })),
    };
    toastShow = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    edit = vi.fn();
    closed = new Subject<void>();
    closeDialog = vi.fn(() => closed.next());
    openSummary = vi.fn();
    openRecording = vi.fn();
    copyRecordingLink = vi.fn();
    applySummaryChange = vi.fn();
    windowOpen = vi.fn();
    modalOpen = vi.fn(() => ({ closed: new Subject<void>(), close: vi.fn() }));
    participantsVersion = signal(0);
    refreshParticipants = vi.fn();
    const row = computed<MeetingHomeRow>(() => ({
      key: meeting().id,
      meeting: meeting(),
      occurrence: null,
      title: meeting().title,
      occurrenceId: null,
      startTime: '2026-11-05T18:00:00Z',
      durationMinutes: 60,
    }));
    const context = {
      row,
      meeting,
      shownRow: row,
      state,
      organizer: computed(() => meeting().organizer === true),
      invited: computed(() => (!!meeting().invited || registered()) && !removedIds().has(meeting().id)),
      fullAccess: computed(() => hasMeetingFullAccess(meeting(), { organizer: meeting().organizer === true, member: !!meeting().invited })),
      pastMeetingId,
      tab,
      canViewGuests,
      participantsVersion,
      refreshParticipants,
      removedRegistrantUids: removedUids,
      guestCount,
    };

    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsArtifactsService,
        { provide: MeetingDetailsContext, useValue: context },
        { provide: MeetingService, useValue: { ...meetingService, removedRegistrationMeetingIds: removedIds } },
        {
          provide: UserService,
          useValue: {
            viewerUsername: signal('synthetic-viewer'),
            user: signal({ email: 'viewer@acme.example' }),
            confirmedMeetingRsvps: () => confirmed(),
          },
        },
        { provide: DialogRef, useValue: { closed, close: closeDialog } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show: toastShow } },
        { provide: MeetingsHomeEditService, useValue: { edit } },
        { provide: MeetingsHomeStore, useValue: { applySummaryChange } },
        { provide: MeetingsHomeDialogsService, useValue: { openSummary, openRecording, copyRecordingLink } },
        { provide: UiModalService, useValue: { open: modalOpen } },
      ],
    });
    TestBed.inject(DOCUMENT).defaultView!.open = windowOpen as unknown as Window['open'];
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  describe('host controls', () => {
    it('mounts host controls with the key the BFF sends', async () => {
      await render({ can_view_host_key: true, host_key: '482193' });
      expect(find('meeting-details-host-key')).not.toBeNull();
    });

    it('stays hidden unless the BFF marks the viewer and sends a key', async () => {
      await render({ can_view_host_key: false, host_key: '482193' });
      expect(find('meeting-details-host-key')).toBeNull();
    });
  });

  describe('organizer, upcoming', () => {
    it('loads the date roster, counts its answers with the organizer’s own, and invites people', async () => {
      meetingService['getMeetingRegistrants'].mockReturnValue(NEVER);
      await render({ organizer: true });
      expect(find('meeting-details-rsvp-loading')).not.toBeNull();
      fixture.destroy();

      meetingService['getMeetingRegistrants'].mockReturnValue(
        of([registrant('reg-a', 'accepted'), registrant('reg-me', null), registrant('reg-c', 'declined')])
      );
      confirmed.set([{ registrant_id: 'reg-me', response_type: 'accepted', scope: 'all', updated_at: '2026-11-05T10:00:00Z' } as MeetingRsvp]);
      await render({ organizer: true });

      expect(meetingService['getMeetingRegistrants']).toHaveBeenLastCalledWith('synthetic-meeting', true, undefined, true, undefined, false, false);
      expect(text('meetings-home-attendance-label')).toBe('2 of 3 attending · 67%');
      expect(find('meeting-details-rsvp-grid')?.querySelectorAll('lfx-ui-avatar').length).toBe(3);

      await click('meeting-details-invite');
      expect(closeDialog).toHaveBeenCalled();
      expect(edit).toHaveBeenCalledWith(expect.objectContaining({ key: 'synthetic-meeting' }));
    });

    it('shows no counts when the roster fails, and logs it', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      meetingService['getMeetingRegistrants'].mockReturnValue(throwError(() => new Error('down')));
      await render({ organizer: true });

      expect(find('meeting-details-rsvp')).toBeNull();
      expect(find('meeting-details-rsvp-loading')).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('Failed to load the meeting registrants:', expect.any(Error));
      consoleError.mockRestore();
    });

    it('drops the viewer from the counts and avatars after Remove Myself, without a refetch', async () => {
      meetingService['getMeetingRegistrants'].mockReturnValue(of([registrant('reg-a', 'accepted'), registrant('reg-me', 'declined', 'Viewer@acme.example')]));
      await render({ organizer: true });
      expect(text('meetings-home-attendance-label')).toBe('1 of 2 attending · 50%');

      removedIds.set(new Set(['synthetic-meeting']));
      await settle();
      expect(text('meetings-home-attendance-label')).toBe('1 of 1 attending · 100%');
      expect(find('meeting-details-rsvp-grid')?.querySelectorAll('lfx-ui-avatar').length).toBe(1);
      expect(meetingService['getMeetingRegistrants']).toHaveBeenCalledTimes(1);
    });

    it('drops a guest removed from the Guests tab', async () => {
      meetingService['getMeetingRegistrants'].mockReturnValue(of([registrant('reg-a', 'accepted'), registrant('reg-b', null), registrant('reg-c', null)]));
      await render({ organizer: true });
      expect(text('meetings-home-attendance-label')).toBe('1 of 3 attending · 33%');

      removedUids.set(new Set(['reg-b']));
      await settle();
      expect(text('meetings-home-attendance-label')).toBe('1 of 2 attending · 50%');
      expect(find('meeting-details-rsvp-grid')?.querySelectorAll('lfx-ui-avatar').length).toBe(2);
    });

    it('offers no Invite people without a project, as Edit Meeting', async () => {
      meetingService['getMeetingRegistrants'].mockReturnValue(of([registrant('reg-a', 'accepted')]));
      await render({ organizer: true, project_slug: undefined });

      expect(find('meeting-details-invite')).toBeNull();
    });

    it('shows only the invited count without RSVPs', async () => {
      meetingService['getMeetingRegistrants'].mockReturnValue(of([registrant('reg-a', null), registrant('reg-b', null)]));
      await render({ organizer: true, is_invite_responses_enabled: false });

      expect(text('meeting-details-invited')).toBe('2 invited');
      removedUids.set(new Set(['reg-b']));
      await settle();
      expect(text('meeting-details-invited')).toBe('1 invited');
      expect(find('meeting-details-rsvp')).toBeNull();
    });
  });

  describe('invited count for a non-organizer', () => {
    it('shows the guest list length as a button to the Guests tab, following local removals', async () => {
      guestCount.set(3);
      await render();

      expect(text('meeting-details-total-invitees')).toBe('3 invited');
      expect(find('meeting-details-total-invitees')?.getAttribute('aria-label')).toBe('3 invited, show guest list');
      await click('meeting-details-total-invitees');
      expect(tab()).toBe('guests');

      guestCount.set(2);
      await settle();
      expect(text('meeting-details-total-invitees')).toBe('2 invited');
    });

    it('shows the invitee count as plain text without the guest list, less the viewer after Remove Myself', async () => {
      meetingService['getPublicMeeting'].mockReturnValue(of({ meeting: { registrant_count: 12 } }));
      canViewGuests.set(false);
      await render({ password: 'synthetic-pass' } as Partial<Meeting>);

      expect(meetingService['getPublicMeeting']).toHaveBeenCalledWith('synthetic-meeting', 'synthetic-pass');
      expect(find('meeting-details-total-invitees')?.tagName).toBe('SPAN');
      expect(text('meeting-details-total-invitees')).toBe('12 invited');

      removedIds.set(new Set(['synthetic-meeting']));
      await settle();
      expect(text('meeting-details-total-invitees')).toBe('11 invited');
      expect(meetingService['getPublicMeeting']).toHaveBeenCalledTimes(1);
    });

    it('loads the count once the viewer registers from the drawer, and keeps it through Remove Myself', async () => {
      meetingService['getPublicMeeting'].mockReturnValue(of({ meeting: { registrant_count: 4 } }));
      canViewGuests.set(false);
      await render({ invited: false });
      expect(meetingService['getPublicMeeting']).not.toHaveBeenCalled();

      registered.set(true);
      await settle();
      expect(text('meeting-details-total-invitees')).toBe('4 invited');

      removedIds.set(new Set(['synthetic-meeting']));
      await settle();
      expect(text('meeting-details-total-invitees')).toBe('3 invited');
      expect(meetingService['getPublicMeeting']).toHaveBeenCalledTimes(1);
    });

    it('keeps a count requested before Remove Myself counting the viewer, even when it lands after', async () => {
      const response = new Subject<unknown>();
      meetingService['getPublicMeeting'].mockReturnValue(response);
      canViewGuests.set(false);
      await render();

      removedIds.set(new Set(['synthetic-meeting']));
      response.next({ meeting: { registrant_count: 12 } });
      await settle();
      expect(text('meeting-details-total-invitees')).toBe('11 invited');
    });

    it('does not take the viewer off again when the count was loaded after Remove Myself', async () => {
      meetingService['getPublicMeeting'].mockReturnValue(of({ meeting: { registrant_count: 11 } }));
      removedIds.set(new Set(['synthetic-meeting']));
      canViewGuests.set(false);
      await render();

      expect(text('meeting-details-total-invitees')).toBe('11 invited');
    });

    it('stays hidden with no invitees, for organizers, once the date ends, and fetches nothing when not invited', async () => {
      canViewGuests.set(false);
      await render();
      expect(find('meeting-details-total-invitees')).toBeNull();
      fixture.destroy();

      guestCount.set(3);
      canViewGuests.set(true);
      await render({ organizer: true });
      expect(find('meeting-details-total-invitees')).toBeNull();
      fixture.destroy();

      await render({}, 'ended');
      expect(find('meeting-details-total-invitees')).toBeNull();
      fixture.destroy();

      meetingService['getPublicMeeting'].mockClear();
      await render({ invited: false });
      expect(meetingService['getPublicMeeting']).not.toHaveBeenCalled();
    });
  });

  it('shows no artifacts before the date ends', async () => {
    await render();
    expect(find('meeting-details-tools-card')).toBeNull();
    expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
  });

  describe('ended', () => {
    it('counts attendance over every participant, with the absent count', async () => {
      meetingService['getPastMeetingParticipants'].mockReturnValue(of([{ is_attended: true }, { is_attended: false }, { is_attended: false }]));
      await render({}, 'ended');

      expect(text('meetings-home-attendance-label')).toBe('1 of 3 attended · 33%');
      expect(text('meetings-home-attendance-legend')).toBe('Attended 1 Absent 2');
      expect(find('meetings-home-attendance-poor')).not.toBeNull();
      expect(find('meeting-details-attendance-grid')).not.toBeNull();

      fixture.debugElement.query(By.directive(MeetingAttendeeGridComponent)).componentInstance.viewAll.emit();
      expect(tab()).toBe('guests');
    });

    it('shows no participants grid when the attendee list is not shared', async () => {
      meetingService['getPastMeetingParticipants'].mockReturnValue(of([{ is_attended: true }, { is_attended: false }]));
      canViewGuests.set(false);
      await render({}, 'ended');

      expect(text('meetings-home-attendance-label')).toBe('1 of 2 attended · 50%');
      expect(find('meeting-details-attendance-grid')).toBeNull();
    });

    it('reloads the participants in place when they change', async () => {
      meetingService['getPastMeetingParticipants'].mockReturnValue(of([{ is_attended: false }, { is_attended: false }]));
      await render({}, 'ended');
      expect(text('meetings-home-attendance-label')).toBe('0 of 2 attended · 0%');

      meetingService['getPastMeetingParticipants'].mockReturnValue(of([{ is_attended: true }, { is_attended: false }]));
      participantsVersion.update((version) => version + 1);
      await settle();
      expect(meetingService['getPastMeetingParticipants']).toHaveBeenCalledTimes(2);
      expect(text('meetings-home-attendance-label')).toBe('1 of 2 attended · 50%');
    });

    it('offers Reconcile Attendance to an organizer only, and refreshes the participants on a change', async () => {
      await render({}, 'ended');
      expect(find('meeting-details-reconcile')).toBeNull();
      fixture.destroy();

      await render({ organizer: true }, 'ended');
      await click('meeting-details-reconcile');
      expect(modalOpen).toHaveBeenCalledWith(MeetingDetailsReconcileDialogComponent, {
        data: { row: expect.objectContaining({ key: 'synthetic-meeting' }), pastMeetingId: 'synthetic-meeting-1762362000000', onChange: expect.any(Function) },
        describedBy: true,
      });
      modalOpen.mock.calls[0][1].data.onChange();
      expect(refreshParticipants).toHaveBeenCalled();
    });

    it('falls back to the past feed’s counts on a past row', async () => {
      await render({ scheduled_start_time: '2026-11-01T18:00:00Z', attendance_summary: { invited: 5, attended: 4 } } as Partial<Meeting>, 'ended');
      expect(text('meetings-home-attendance-label')).toBe('4 of 5 attended · 80%');
    });

    it('falls back to the meeting’s counts when the participant list is hidden', async () => {
      await render({ participant_count: 4, attended_count: 3 }, 'ended');
      expect(text('meetings-home-attendance-label')).toBe('3 of 4 attended · 75%');
      expect(find('meeting-details-attendance-grid')).toBeNull();
    });

    it('offers the recording, the pending summary to an invitee, and the transcript on the meeting page', async () => {
      await render({}, 'ended');

      expect(find('meeting-details-recording')).not.toBeNull();
      expect(text('meeting-details-summary-pending')).toBe('Pending');
      await click('meeting-details-summary');
      expect(openSummary).toHaveBeenCalledWith(expect.objectContaining({ key: 'synthetic-meeting-1762362000000' }), SUMMARY, expect.any(Function), {
        origin: 'drawer',
        showPending: true,
      });

      await click('meeting-details-transcript');
      expect(windowOpen).toHaveBeenCalledWith(expect.stringContaining('/meetings/synthetic-meeting-1762362000000'), '_blank', 'noopener,noreferrer');
    });

    it('opens and copies the recording link', async () => {
      await render({}, 'ended');

      (find('meeting-details-recording')?.querySelector('[data-testid="ui-split-button-main"] button') as HTMLButtonElement).click();
      (find('meeting-details-recording')?.querySelector(':scope > button') as HTMLButtonElement).click();
      expect(openRecording).toHaveBeenCalledWith('https://zoom.example/rec');
      expect(copyRecordingLink).toHaveBeenCalledWith('https://zoom.example/rec');
    });

    it('marks an approved summary', async () => {
      meetingService['getPastMeetingSummary'].mockReturnValue(of({ ...SUMMARY, approved: true }));
      await render({}, 'ended');

      expect(text('meeting-details-summary-approved')).toBe('Approved');
      expect(find('meeting-details-summary-pending')).toBeNull();
    });

    it('shows the approval made in the summary dialog here and on the list', async () => {
      await render({}, 'ended');
      await click('meeting-details-summary');
      const onChange = openSummary.mock.calls[0][2] as (summary: PastMeetingSummary) => void;
      onChange({ ...SUMMARY, approved: true });
      await settle();

      expect(applySummaryChange).toHaveBeenCalledWith('synthetic-meeting-1762362000000', { ...SUMMARY, approved: true });

      expect(text('meeting-details-summary-approved')).toBe('Approved');
      expect(find('meeting-details-summary-pending')).toBeNull();
    });

    it('greys out what does not exist', async () => {
      meetingService['getPastMeetingRecording'].mockReturnValue(of({ sessions: [] }));
      meetingService['getPastMeetingTranscript'].mockReturnValue(of({ recording_files: [] }));
      meetingService['getPastMeetingSummary'].mockReturnValue(of({ ...SUMMARY, summary_data: { content: ' ', edited_content: '' } }));
      await render({}, 'ended');

      expect((find('meeting-details-recording-unavailable')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect(text('meeting-details-summary-unavailable')).toBe('AI Summary Not Available');
      expect(text('meeting-details-transcript-unavailable')).toBe('Transcript Unavailable');
    });

    it('shows the private notice instead of tools without access', async () => {
      await render({ invited: false }, 'ended');

      expect(find('meeting-details-tools-card')).toBeNull();
      expect(text('meeting-details-private')).toContain('This is a private meeting');
      expect(meetingService['getPastMeetingSummary']).not.toHaveBeenCalled();
    });
  });
});
