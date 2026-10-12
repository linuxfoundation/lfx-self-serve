// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, Component, input, output, signal } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { Meeting, MeetingOccurrence, MeetingRegistrant, MeetingRegistrationRemovalResult, MeetingRsvp, User } from '@lfx-one/shared/interfaces';
import { MeetingInviteeAttendeesComponent } from '@app/modules/meetings/components/meeting-invitee-attendees/meeting-invitee-attendees.component';
import { MeetingRsvpDetailsComponent } from '@app/modules/meetings/components/meeting-rsvp-details/meeting-rsvp-details.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingCardComponent } from './meeting-card.component';

const MEETING = { id: 'meeting-1', project_uid: 'project-1', project_slug: 'acme', organizer: true } as Meeting;

/**
 * Covers the edit-permission re-check the edit button runs before opening the composer.
 * @description `meeting().organizer` is a snapshot of what the list payload said when the card
 * rendered, so an organizer whose access was revoked since then still sees an edit button. Opening
 * the composer on that stale flag walks the organizer through a whole edit that upstream will reject
 * on save, so the card re-asks before opening — of the meeting itself, which is the object the API's
 * own guard is evaluated against. No `ProjectContextService` is provided below, so a probe that went
 * back to project permissions instead would fail to inject rather than quietly pass.
 */
describe('MeetingCardComponent — edit-access re-check', () => {
  let composerOpen: ReturnType<typeof vi.fn>;
  let toastAdd: ReturnType<typeof vi.fn>;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getMeeting: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  /**
   * `MEETING_V2_ENABLED_FLAG`, stated per test.
   * @description The probe below runs on both sides of the flag — it is a permission re-check, not a
   * v2 feature — but only the flag-on branch opens the composer; with it off the same allowed probe
   * navigates to the pre-v2 editor instead. Both branches are covered, so each case says which one
   * it is rather than inheriting a default from the real service (which answers `false` here).
   */
  const meetingsV2Enabled = signal(true);

  /** Mounts the card over `meeting` with an empty template — this suite exercises the handler, not the markup. */
  async function mount(meeting: Meeting = MEETING, pinned: MeetingOccurrence | null = null): Promise<MeetingCardComponent> {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            authenticated: signal(false),
            viewerUsername: signal(null),
            meetingFeedIdentity: signal(''),
            refreshUserMeetings: vi.fn(),
            clearConfirmedMeetingRsvps: vi.fn(),
            isMeetingRsvpCurrent: vi.fn(() => true),
          },
        },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled } },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: Router, useValue: { navigate } },
        { provide: ConfirmationService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            removedRegistrationMeetingIds: signal<ReadonlySet<string>>(new Set()),
            markRegistrationRemoved: vi.fn(),
            clearRemovedRegistration: vi.fn(),
            getMeetingDetail,
            getMeeting,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPastMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: '' })),
          },
        },
      ],
    });
    // Empty template: the 512-line card markup mounts a dozen child components that have nothing to
    // do with this handler. providers: [] drops the component's own ConfirmationService so the stub
    // above is the one injected.
    TestBed.overrideComponent(MeetingCardComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingCardComponent);
    fixture.componentRef.setInput('meetingInput', meeting);
    fixture.componentRef.setInput('occurrenceInput', pinned);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  beforeEach(() => {
    meetingsV2Enabled.set(true);
    composerOpen = vi.fn();
    toastAdd = vi.fn();
    navigate = vi.fn();
    getMeetingDetail = vi.fn().mockReturnValue(of({ ...MEETING, organizer: true }));
    getMeeting = vi.fn().mockReturnValue(of(MEETING));
  });

  it('opens the composer once a fresh read still reports the viewer as organizer', async () => {
    const component = await mount();

    component.onEditMeeting();

    // `skipCache` is the whole point: the cached payload is the one the stale flag came from.
    expect(getMeetingDetail).toHaveBeenCalledWith('meeting-1', { skipCache: true });
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('refuses to open the composer for an organizer whose access has since been revoked', async () => {
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    // The stale `organizer: true` on the card is exactly the case this exists for: the edit would be
    // rejected on save, after the organizer had already redone the work.
    expect(composerOpen).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Editing unavailable' }));
  });

  it('opens for an organizer the meeting grants but no project permission would', async () => {
    // A committee writer inherits `organizer` on the meeting while holding nothing at project level.
    // Re-deriving the answer from the project denied exactly this person an edit the API allows.
    getMeetingDetail.mockReturnValue(of({ id: 'meeting-1', organizer: true } as Meeting));
    const component = await mount({ id: 'meeting-1', organizer: true } as Meeting);

    component.onEditMeeting();

    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: undefined });
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('says the check failed rather than claiming the permission was revoked', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => new Error('network')));
    const component = await mount();

    component.onEditMeeting();

    expect(composerOpen).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Could not open the editor' }));
    expect(component.checkingEditAccess()).toBe(false);
  });

  it('holds the button disabled for the length of the probe and ignores a second click', async () => {
    const probe = new Subject<Meeting>();
    getMeetingDetail.mockReturnValue(probe as unknown as Observable<Meeting>);
    const component = await mount();

    component.onEditMeeting();

    expect(component.checkingEditAccess()).toBe(true);

    // A second click while the first probe is in flight must not queue a second request — otherwise
    // two composers race to open over the same meeting.
    component.onEditMeeting();
    expect(getMeetingDetail).toHaveBeenCalledTimes(1);

    probe.next({ ...MEETING, organizer: true });
    probe.complete();

    expect(component.checkingEditAccess()).toBe(false);
    expect(composerOpen).toHaveBeenCalledTimes(1);
  });

  it('releases the button after a denied probe so the organizer can retry', async () => {
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    expect(component.checkingEditAccess()).toBe(false);
  });

  it('navigates to the pre-v2 editor instead of the composer while the flag is off', async () => {
    meetingsV2Enabled.set(false);
    const component = await mount({ ...MEETING, is_foundation: false } as Meeting);

    component.onEditMeeting();

    // The pre-v2 editor is a page, not an overlay, so the context the composer would have been
    // handed as arguments has to travel in the URL instead: `project` is what `writerGuard` resolves
    // write access from, and the tier picks the lensed path.
    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'meetings', 'meeting-1', 'edit'], { queryParams: { project: 'acme' } });
    expect(composerOpen).not.toHaveBeenCalled();
  });

  it('carries the group through to the pre-v2 editor for a committee-scoped meeting', async () => {
    meetingsV2Enabled.set(false);
    const meeting = { ...MEETING, is_foundation: true, committees: [{ uid: 'committee-1' }] } as Meeting;
    getMeetingDetail.mockReturnValue(of({ ...meeting, organizer: true }));
    const component = await mount(meeting);

    component.onEditMeeting();

    expect(navigate).toHaveBeenCalledWith(['/', 'foundation', 'meetings', 'meeting-1', 'edit'], {
      queryParams: { project: 'acme', committee_uid: 'committee-1' },
    });
  });

  it('falls back to the flat edit path when the meeting tier is unenriched', async () => {
    meetingsV2Enabled.set(false);
    const component = await mount();

    component.onEditMeeting();

    // `is_foundation` absent means the list payload never said which tier this meeting belongs to;
    // the flat path exists so the redirect guard can work it out rather than guessing wrong here.
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'meeting-1', 'edit'], { queryParams: { project: 'acme' } });
  });

  describe('recurring meetings', () => {
    const OCCURRENCE = { occurrence_id: '1893456000', start_time: '2030-01-01T00:00:00.000Z', duration: 30 };
    const RECURRING = { ...MEETING, recurrence: { type: 2, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as unknown as Meeting;

    let dialogOpen: ReturnType<typeof vi.fn>;
    let dialogResults: Subject<unknown>[];

    /** Mounts over a recurring meeting and makes each `dialogService.open` hand back its own close stream. */
    async function mountRecurring(pinned: MeetingOccurrence | null = null): Promise<MeetingCardComponent> {
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true }));
      dialogResults = [];
      dialogOpen = vi.fn(() => {
        const onClose = new Subject<unknown>();
        dialogResults.push(onClose);
        return { onClose };
      });
      TestBed.overrideProvider(DialogService, { useValue: { open: dialogOpen } });
      return mount(RECURRING, pinned);
    }

    it('asks which scope to edit before opening any editor', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();

      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1].data).toEqual(expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000' }) }));
      expect(composerOpen).not.toHaveBeenCalled();
    });

    it('opens the series editor when the organizer picks the whole series', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'series' });

      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });

    it('opens the composer on the picked occurrence when the organizer picks a single one', async () => {
      const later = { occurrence_id: '1893542400', start_time: '2030-01-02T00:00:00.000Z', duration: 30 };
      const component = await mountRecurring();
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [OCCURRENCE, later] }));

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'occurrence', occurrenceId: '1893542400' });

      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1', occurrenceId: '1893542400' });
    });

    it('keeps the pre-v2 reschedule dialog for a single occurrence while the flag is off', async () => {
      meetingsV2Enabled.set(false);
      const component = await mountRecurring();
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'occurrence', occurrenceId: '1893456000' });

      expect(composerOpen).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(2);
      expect(dialogOpen.mock.calls[1][1].data).toEqual(expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000' }) }));

      const moved = { ...OCCURRENCE, occurrence_id: '1893542400', start_time: '2030-01-02T00:00:00.000Z' };
      getMeeting.mockReturnValue(of({ ...RECURRING, occurrences: [moved] }));
      dialogResults[1].next({ confirmed: true, start_time: '2030-01-02T00:00:00.000Z' });

      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Occurrence updated' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
      // A host that never binds `meetingDeleted` (the committee meetings list) still sees the new time.
      expect(getMeeting).toHaveBeenCalledWith('meeting-1');
      expect(component.currentOccurrence()?.occurrence_id).toBe('1893542400');
    });

    it('still finds a pinned occurrence whose id was written in milliseconds', async () => {
      const component = await mountRecurring({ ...OCCURRENCE, occurrence_id: '1893456000000' } as MeetingOccurrence);

      component.onEditMeeting();

      expect(toastAdd).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1].data.occurrence.occurrence_id).toBe('1893456000');
    });

    it('takes the shown occurrence values from the fresh read, not the list payload the card rendered with', async () => {
      const component = await mountRecurring();
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [{ ...OCCURRENCE, duration: 45 }] }));

      component.onEditMeeting();

      expect(dialogOpen.mock.calls[0][1].data).toEqual(
        expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000', duration: 45 }) })
      );
    });

    it('refreshes instead of retargeting a later slot when the shown occurrence was cancelled in another tab', async () => {
      const later = { occurrence_id: '1894060800', start_time: '2030-01-08T00:00:00.000Z', duration: 30 };
      const component = await mountRecurring();
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [OCCURRENCE, later], cancelled_occurrences: ['1893456000'] }));

      component.onEditMeeting();

      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Occurrence changed' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it('shows the occurrence duration rather than the series duration', async () => {
      const component = await mount({ ...RECURRING, duration: 60, occurrences: [{ ...OCCURRENCE, duration: 30 }] } as unknown as Meeting);

      expect(component.meetingDuration()).toBe(30);
    });

    it('hands both dialogs the fresh meeting, so a changed series timezone is the one the form uses', async () => {
      meetingsV2Enabled.set(false);
      const component = await mountRecurring();
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, timezone: 'America/New_York' }));

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'occurrence' });

      expect(dialogOpen.mock.calls[0][1].data.meeting.timezone).toBe('America/New_York');
      expect(dialogOpen.mock.calls[1][1].data.meeting.timezone).toBe('America/New_York');
    });

    it('refreshes instead of opening a ghost slot when the pinned occurrence is gone from the fresh read', async () => {
      // Parent pinned this card to an occurrence another organizer has since moved.
      const component = await mountRecurring(OCCURRENCE as MeetingOccurrence);
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [{ ...OCCURRENCE, occurrence_id: '1893542400' }] }));

      component.onEditMeeting();

      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Occurrence changed' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the scope dialog is dismissed', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();
      dialogResults[0].next(undefined);

      expect(composerOpen).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });
  });

  it('still re-checks access before the pre-v2 editor, and still refuses a revoked organizer', async () => {
    meetingsV2Enabled.set(false);
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    // Turning the flag off must not turn the permission re-check off with it — the stale
    // `organizer: true` on the card reaches the pre-v2 editor exactly the same way.
    expect(getMeetingDetail).toHaveBeenCalledWith('meeting-1', { skipCache: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Editing unavailable' }));
  });
});

@Component({ selector: 'lfx-rsvp-button-group', template: '' })
class RsvpButtonGroupStubComponent {
  public readonly meeting = input<Meeting>();
  public readonly occurrenceId = input<string | undefined>();
  public readonly rsvpChanged = output<MeetingRsvp>();
}

@Component({ selector: 'lfx-meeting-invitee-attendees', template: '' })
class MeetingInviteeAttendeesStubComponent {
  public readonly meeting = input<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
}

/**
 * Covers which invitee panels the card renders, at the template boundary.
 * @description The attendee preview is gated by `show_meeting_attendees` alone, so it must render even
 * when the meeting collects no RSVPs. The outer condition once required RSVP collection too, which hid
 * the preview; the attendee component's own spec cannot catch that because it mounts the child directly.
 */
describe('MeetingCardComponent — invitee panels', () => {
  const INVITED = {
    id: 'meeting-1',
    project_uid: 'project-1',
    title: 'Weekly sync',
    start_time: '2030-01-01T10:00:00.000Z',
    duration: 30,
    timezone: 'UTC',
    invited: true,
    organizer: false,
  } as unknown as Meeting;

  async function render(meeting: Meeting): Promise<HTMLElement> {
    // The card's animate-on-scroll directive needs IntersectionObserver, which jsdom lacks.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        provideRouter([]),
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            authenticated: signal(true),
            viewerUsername: signal(null),
            meetingFeedIdentity: signal(''),
            refreshUserMeetings: vi.fn(),
            clearConfirmedMeetingRsvps: vi.fn(),
            isMeetingRsvpCurrent: vi.fn(() => true),
          },
        },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: MeetingComposerService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            removedRegistrationMeetingIds: signal<ReadonlySet<string>>(new Set()),
            markRegistrationRemoved: vi.fn(),
            clearRemovedRegistration: vi.fn(),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPastMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: '' })),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingCardComponent, {
      remove: { imports: [RsvpButtonGroupComponent, MeetingInviteeAttendeesComponent] },
      add: { imports: [RsvpButtonGroupStubComponent, MeetingInviteeAttendeesStubComponent] },
    });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingCardComponent);
    fixture.componentRef.setInput('meetingInput', meeting);
    fixture.detectChanges();
    for (const block of await fixture.getDeferBlocks()) {
      await block.render(DeferBlockState.Complete);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows attendees without RSVP buttons when the meeting collects no RSVPs', async () => {
    const card = await render({ ...INVITED, is_invite_responses_enabled: false, show_meeting_attendees: true } as Meeting);

    expect(card.querySelector('lfx-meeting-invitee-attendees')).not.toBeNull();
    expect(card.querySelector('lfx-rsvp-button-group')).toBeNull();
  });

  it('shows RSVP buttons without attendees when Show Attendees is off', async () => {
    const card = await render({ ...INVITED, is_invite_responses_enabled: true, show_meeting_attendees: false } as Meeting);

    expect(card.querySelector('lfx-rsvp-button-group')).not.toBeNull();
    expect(card.querySelector('lfx-meeting-invitee-attendees')).toBeNull();
  });

  it('hides attendees on a Board meeting that still carries a legacy opt-in', async () => {
    const card = await render({ ...INVITED, meeting_type: 'Board', is_invite_responses_enabled: true, show_meeting_attendees: true } as Meeting);

    expect(card.querySelector('lfx-rsvp-button-group')).not.toBeNull();
    expect(card.querySelector('lfx-meeting-invitee-attendees')).toBeNull();
  });
});

/**
 * Covers the "remove myself" action: when the card offers it, what the confirm leads to, and how it
 * settles. Registration enrichment may reach the client, but removal still takes the meeting id
 * alone — the BFF resolves and authorizes the viewer's registrations.
 */
describe('MeetingCardComponent — remove myself', () => {
  const INVITEE = { id: 'meeting-1', project_uid: 'project-1', organizer: false, invited: true, title: 'TAC Sync' } as Meeting;

  let toastAdd: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let removeMyMeetingRegistration: ReturnType<typeof vi.fn>;
  let removedIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let registrationClose$: Subject<{ registered: boolean }>;
  let rsvpButtons: RsvpButtonGroupComponent | undefined;

  async function mount(
    meeting: Meeting = INVITEE,
    options: { authenticated?: boolean; past?: boolean; fetchedRsvp?: MeetingRsvp } = {}
  ): Promise<MeetingCardComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: vi.fn((url: string) => of(url === '/api/user/meetings' ? [meeting] : { profile: {} })) } },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: LensService, useValue: { activeLens: signal('me') } },
        { provide: MeetingComposerService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: DialogService, useValue: { open: vi.fn(() => ({ onClose: registrationClose$ })) } },
        {
          provide: MeetingService,
          useValue: {
            removedRegistrationMeetingIds: removedIds,
            markRegistrationRemoved: (id: string) => removedIds.update((ids) => new Set(ids).add(id)),
            clearRemovedRegistration: (id: string) => removedIds.update((ids) => new Set([...ids].filter((saved) => saved !== id))),
            removeMyMeetingRegistration,
            getPastMeetingRecording: vi.fn().mockReturnValue(of(null)),
            getPastMeetingSummary: vi.fn().mockReturnValue(of(null)),
            getPastMeetingTranscript: vi.fn().mockReturnValue(of(null)),
            getMeeting: vi.fn().mockReturnValue(of(meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPastMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: '' })),
            getMeetingRsvpForCurrentUser: vi.fn(() => of(options.fetchedRsvp ?? null)),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingCardComponent, {
      set: {
        template: options.fetchedRsvp ? '<lfx-rsvp-button-group [meeting]="rsvpMeeting()" (rsvpChanged)="onRsvpChanged($event)" />' : '',
        imports: options.fetchedRsvp ? [RsvpButtonGroupComponent] : [],
        providers: [],
      },
    });
    await TestBed.compileComponents();
    const userService = TestBed.inject(UserService);
    userService.user.set({ sub: 'synthetic-subject', username: 'synthetic-viewer', email: 'synthetic@example.com' } as User);
    userService.authenticated.set(options.authenticated ?? true);

    const fixture = TestBed.createComponent(MeetingCardComponent);
    fixture.componentRef.setInput('meetingInput', meeting);
    fixture.componentRef.setInput('pastMeeting', options.past ?? false);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    if (options.fetchedRsvp) rsvpButtons = fixture.debugElement.query(By.directive(RsvpButtonGroupComponent)).componentInstance;

    return fixture.componentInstance;
  }

  beforeEach(() => {
    toastAdd = vi.fn();
    confirm = vi.fn();
    removeMyMeetingRegistration = vi.fn().mockReturnValue(of({ removed_registrant_ids: [], remaining_registrant_ids: [] }));
    removedIds = signal<ReadonlySet<string>>(new Set());
    registrationClose$ = new Subject<{ registered: boolean }>();
    rsvpButtons = undefined;
  });

  it.each([{ sub: 'synthetic-other', username: 'synthetic-viewer' }, null])(
    "removes the previous viewer's card-local confirmations from an organizer overview after identity changes to %s",
    async (nextUser) => {
      const component = await mount({ ...INVITEE, organizer: true });
      const users = TestBed.inject(UserService);
      const rsvp: MeetingRsvp = {
        id: 'synthetic-viewer-answer',
        meeting_id: INVITEE.id,
        registrant_id: 'synthetic-viewer-registration',
        username: 'synthetic-viewer',
        email: 'synthetic@example.com',
        response_type: 'accepted',
        scope: 'all',
        created_at: '2026-10-12T10:00:00Z',
      };
      component.onRsvpChanged(rsvp);
      users.recordConfirmedMeetingRsvp(rsvp);
      expect(component.overviewConfirmedRsvps()).toContainEqual(rsvp);

      users.user.set(nextUser as User | null);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.confirmedRsvps()).toEqual([]);
      expect(component.overviewConfirmedRsvps()).toEqual([]);
    }
  );

  it("resets local confirmations on LFID changes without discarding the same subject's service-owned response", async () => {
    const component = await mount({ ...INVITEE, organizer: true });
    const users = TestBed.inject(UserService);
    const rsvp: MeetingRsvp = {
      id: 'synthetic-lfid-answer',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-viewer-registration',
      username: 'synthetic-viewer',
      email: 'synthetic@example.com',
      response_type: 'maybe',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    };
    component.onRsvpChanged(rsvp);
    users.recordConfirmedMeetingRsvp(rsvp);
    users.user.set({ ...users.user(), username: 'canonical-viewer' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component.confirmedRsvps()).toEqual([]);
    expect(component.overviewConfirmedRsvps()).toEqual([rsvp]);

    component.onRsvpChanged(rsvp);
    users.user.set({ ...users.user(), name: 'Updated display name' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component.confirmedRsvps()).toEqual([rsvp]);
  });

  it('offers the action to a signed-in invitee of an upcoming meeting', async () => {
    const component = await mount();

    expect(component.canLeaveMeeting()).toBe(true);
  });

  it.each([
    ['an organizer', { ...INVITEE, organizer: true } as Meeting, {}],
    ['someone who is not invited', { ...INVITEE, invited: false } as Meeting, {}],
    ['a past meeting', INVITEE, { past: true }],
    ['an anonymous viewer', INVITEE, { authenticated: false }],
  ])('does not offer the action to %s', async (_label, meeting, options) => {
    const component = await mount(meeting, options);

    expect(component.canLeaveMeeting()).toBe(false);
  });

  it('does not offer the action to someone invited through a committee, but still shows they are registered', async () => {
    const component = await mount({ ...INVITEE, invited_via_committee: true } as Meeting);

    expect(component.isRegisteredAttendee()).toBe(true);
    expect(component.canLeaveMeeting()).toBe(false);
  });

  it('keeps the action hidden on a card rebuilt after the list refetched a stale invited flag', async () => {
    removedIds.set(new Set(['meeting-1']));

    const component = await mount();

    expect(component.canLeaveMeeting()).toBe(false);
  });

  it('says the removal covers every occurrence', async () => {
    const component = await mount();

    component.confirmLeaveMeeting();

    expect(confirm.mock.calls[0][0].message).toContain('any occurrence');
  });

  it('asks for confirmation first and removes only once it is accepted', async () => {
    const component = await mount();

    component.confirmLeaveMeeting();

    expect(removeMyMeetingRegistration).not.toHaveBeenCalled();
    confirm.mock.calls[0][0].accept();
    expect(removeMyMeetingRegistration).toHaveBeenCalledWith('meeting-1');
  });

  it('stops offering the action and tells the list to refresh once removed', async () => {
    const component = await mount();
    const deleted = vi.fn();
    component.meetingDeleted.subscribe(deleted);

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();

    expect(component.canLeaveMeeting()).toBe(false);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('shows the BFF message when it rejected the request itself, such as a committee-added registrant', async () => {
    removeMyMeetingRegistration.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'Leave the committee instead.' } }))
    );
    const component = await mount();

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();

    expect(component.canLeaveMeeting()).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: expect.stringContaining('Leave the committee instead.') }));
  });

  it('shows generic copy for any other failure and keeps the action available', async () => {
    removeMyMeetingRegistration.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: 'boom' })));
    const component = await mount();

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();

    expect(component.canLeaveMeeting()).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Unable to remove you from this meeting. Please try again.' }));
  });

  it.each([true, false])('preserves only live-registration confirmations after a leave/rejoin attempt (success=%s)', async (success) => {
    const rsvp = {
      id: 'synthetic-old-response',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-old-registration',
      username: 'synthetic-viewer',
      email: 'synthetic@example.com',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    const supplied = { ...INVITEE, visibility: 'public', my_rsvp: rsvp, my_registrant_ids: [rsvp.registrant_id] } as Meeting;
    if (success) removeMyMeetingRegistration.mockReturnValue(of({ removed_registrant_ids: [rsvp.registrant_id], remaining_registrant_ids: [] }));
    if (!success) removeMyMeetingRegistration.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const component = await mount(supplied);
    const userService = TestBed.inject(UserService);
    userService.recordConfirmedMeetingRsvp(rsvp);
    component.onRsvpChanged(rsvp);
    let rows: Meeting[] = [];
    const subscription = userService.getUserMeetings().subscribe((meetings) => (rows = meetings));

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();

    if (success) {
      expect(component.confirmedRsvps()).toEqual([]);
      expect(component.rsvpMeeting().my_rsvp).toBeNull();
      expect(component.overviewConfirmedRsvps()).toEqual([]);
      expect(rows[0].my_rsvp).toBeNull();
      component.registerForMeeting();
      registrationClose$.next({ registered: true });
      expect(component.isRegisteredAttendee()).toBe(true);
      // The still-mounted card's list input and detail refetch both keep the old indexed answer.
      expect(component.rsvpMeeting().my_rsvp).toBeNull();
      component.onRsvpChanged({ ...rsvp, id: 'synthetic-late-old-acknowledgement' });
      userService.recordConfirmedMeetingRsvp(rsvp);
      expect(component.confirmedRsvps()).toEqual([]);
      expect(rows[0].my_rsvp).toBeNull();
    } else {
      expect(component.confirmedRsvps()).toEqual([rsvp]);
      expect(component.rsvpMeeting().my_rsvp).toEqual(rsvp);
      expect(rows[0].my_rsvp).toEqual(rsvp);
      expect(component.canLeaveMeeting()).toBe(true);
    }
    subscription.unsubscribe();
  });

  it('keeps the surviving registration and its response after partial removal without removing the card', async () => {
    const removed = {
      id: 'synthetic-removed-answer',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-removed-registration',
      response_type: 'accepted',
      scope: 'single',
      occurrence_id: '4099766400',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    const survivor = { ...removed, id: 'synthetic-surviving-answer', registrant_id: 'synthetic-surviving-registration', response_type: 'maybe' } as MeetingRsvp;
    removeMyMeetingRegistration.mockReturnValue(of({ removed_registrant_ids: [removed.registrant_id], remaining_registrant_ids: [survivor.registrant_id] }));
    const component = await mount({ ...INVITEE, my_rsvp: removed, my_registrant_ids: [removed.registrant_id, survivor.registrant_id] });
    const users = TestBed.inject(UserService);
    users.recordConfirmedMeetingRsvp(removed);
    const savedSurvivor = users.recordConfirmedMeetingRsvp(survivor)!;
    component.onRsvpChanged(removed);
    component.onRsvpChanged(savedSurvivor);
    const deleted = vi.fn();
    component.meetingDeleted.subscribe(deleted);

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();

    expect(component.canLeaveMeeting()).toBe(true);
    expect(removedIds()).toEqual(new Set());
    expect(deleted).not.toHaveBeenCalled();
    expect(component.confirmedRsvps()).toEqual([savedSurvivor]);
    expect(users.confirmedMeetingRsvps(INVITEE.id)).toEqual([savedSurvivor]);
    expect(component.overviewConfirmedRsvps()).toContainEqual(savedSurvivor);
    expect(component.overviewConfirmedRsvps()).not.toContainEqual(removed);
    expect(users.isMeetingRsvpCurrent(removed, component.meeting())).toBe(false);
    expect(users.isMeetingRsvpCurrent(savedSurvivor, component.meeting())).toBe(true);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('restores a fresh-load survivor response in the card controls and active personal feed after partial removal', async () => {
    const removed = {
      id: 'synthetic-removed-answer',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-removed-registration',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T12:00:00Z',
    } as MeetingRsvp;
    const survivor = {
      ...removed,
      id: 'synthetic-survivor-answer',
      registrant_id: 'synthetic-survivor-registration',
      response_type: 'maybe',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    removeMyMeetingRegistration.mockReturnValue(
      of({ removed_registrant_ids: [removed.registrant_id], remaining_registrant_ids: [survivor.registrant_id], remaining_rsvps: [survivor] })
    );
    const component = await mount(
      { ...INVITEE, is_invite_responses_enabled: true, my_rsvp: removed, my_registrant_ids: [removed.registrant_id, survivor.registrant_id] },
      { fetchedRsvp: removed }
    );
    const users = TestBed.inject(UserService);
    let rows: Meeting[] = [];
    const subscription = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    expect(rsvpButtons?.selectedResponse()).toBe('accepted');
    expect(users.confirmedMeetingRsvps(INVITEE.id)).toEqual([]);

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(rows[0].my_rsvp).toEqual(survivor);
    expect(rsvpButtons?.selectedResponse()).toBe('maybe');
    expect(component.overviewConfirmedRsvps()).toContainEqual(survivor);
    expect(component.canLeaveMeeting()).toBe(true);
    subscription.unsubscribe();
  });

  it('does not clear another effective subject when an earlier removal completes late', async () => {
    const removal$ = new Subject<MeetingRegistrationRemovalResult>();
    removeMyMeetingRegistration.mockReturnValue(removal$);
    const component = await mount();
    const userService = TestBed.inject(UserService);
    const rsvp = {
      id: 'synthetic-old-response',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-registration',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    userService.recordConfirmedMeetingRsvp(rsvp, 'synthetic-subject');
    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();
    userService.user.set({ sub: 'synthetic-other', username: 'synthetic-viewer' } as User);
    userService.recordConfirmedMeetingRsvp({ ...rsvp, id: 'synthetic-other-response', response_type: 'maybe' }, 'synthetic-other');
    let rows: Meeting[] = [];
    const subscription = userService.getUserMeetings().subscribe((meetings) => (rows = meetings));

    removal$.next({ removed_registrant_ids: [rsvp.registrant_id], remaining_registrant_ids: [] });

    expect(rows[0].my_rsvp?.response_type).toBe('maybe');
    expect(component.canLeaveMeeting()).toBe(true);
    expect(removedIds()).toEqual(new Set());
    subscription.unsubscribe();
  });

  it('ends a fetched-only registration before rejoining even when the RSVP child stays mounted', async () => {
    const rsvp = {
      id: 'synthetic-fetched-response',
      meeting_id: INVITEE.id,
      registrant_id: 'synthetic-fetched-registration',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    removeMyMeetingRegistration.mockReturnValue(of({ removed_registrant_ids: [rsvp.registrant_id], remaining_registrant_ids: [] }));
    const component = await mount({ ...INVITEE, visibility: 'public', is_invite_responses_enabled: true } as Meeting, { fetchedRsvp: rsvp });
    expect(rsvpButtons?.selectedResponse()).toBe('accepted');

    component.confirmLeaveMeeting();
    confirm.mock.calls[0][0].accept();
    expect(rsvpButtons?.selectedResponse()).toBeNull();
    component.registerForMeeting();
    registrationClose$.next({ registered: true });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component.isRegisteredAttendee()).toBe(true);
    expect(rsvpButtons?.selectedResponse()).toBeNull();
    expect(component.confirmedRsvps()).toEqual([]);
  });
});

describe('MeetingCardComponent — RSVP cache freshness', () => {
  it.each([
    [false, true, 'me'],
    [true, true, 'me'],
    [false, false, 'me'],
    [true, false, 'me'],
    [true, true, 'foundation'],
    [true, true, 'project'],
  ] as const)('keeps successful responses through stale reads and remounts (organizer=%s, success=%s, lens=%s)', async (organizer, success, sourceLens) => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    const toastAdd = vi.fn();
    const activeLens = signal<string>(sourceLens);
    TestBed.configureTestingModule({
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LensService, useValue: { activeLens } },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: MeetingComposerService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(MeetingCardComponent, { add: { providers: [] } });
    await TestBed.compileComponents();
    const meetingService = TestBed.inject(MeetingService);
    vi.spyOn(meetingService, 'getMeetingAttachments').mockReturnValue(of([]));
    vi.spyOn(meetingService, 'getMeetingRegistrants').mockReturnValue(
      of([
        {
          uid: 'synthetic-registrant',
          meeting_id: 'synthetic-rsvp',
          email: 'synthetic@example.com',
          first_name: 'Synthetic',
          last_name: 'Guest',
          rsvp: null,
        } as MeetingRegistrant,
      ])
    );
    const userService = TestBed.inject(UserService);
    userService.user.set({ sub: 'synthetic-subject', username: 'viewer', email: 'synthetic@example.com' } as User);
    userService.authenticated.set(true);
    await TestBed.inject(ApplicationRef).whenStable();

    const http = TestBed.inject(HttpTestingController);
    for (const request of http.match('/api/profile')) {
      request.flush({ profile: {} });
    }
    const meeting = {
      id: 'synthetic-rsvp',
      project_uid: 'synthetic-project',
      title: 'Synthetic RSVP meeting',
      start_time: '2099-01-01T10:00:00Z',
      duration: 30,
      timezone: 'UTC',
      invited: true,
      organizer,
      is_invite_responses_enabled: true,
      show_meeting_attendees: false,
      my_rsvp: null,
    } as Meeting;
    let pendingIds: string[] = [];
    const subscription = userService.getUserMeetings().subscribe((meetings) => {
      pendingIds = meetings.filter((row) => row.is_invite_responses_enabled && !row.my_rsvp).map((row) => row.id);
    });
    http.expectOne('/api/user/meetings').flush([meeting]);
    expect(pendingIds).toEqual(['synthetic-rsvp']);

    const fixture = TestBed.createComponent(MeetingCardComponent);
    fixture.componentRef.setInput('meetingInput', meeting);
    fixture.detectChanges();
    for (const block of await fixture.getDeferBlocks()) {
      await block.render(DeferBlockState.Complete);
    }
    fixture.detectChanges();
    for (const request of http.match('/api/meetings/synthetic-rsvp/rsvp/me')) {
      request.flush(null);
    }
    const buttons = fixture.debugElement.query(By.directive(RsvpButtonGroupComponent)).componentInstance as RsvpButtonGroupComponent;
    buttons.handleRsvpClick('accepted');
    const write = http.expectOne('/api/meetings/synthetic-rsvp/rsvp');
    const rsvp: MeetingRsvp = {
      id: 'synthetic-response',
      meeting_id: meeting.id,
      registrant_id: 'synthetic-registrant',
      username: 'viewer',
      email: 'synthetic@example.com',
      created_at: '2099-01-01T00:00:00Z',
      response_type: 'accepted',
      scope: 'all',
    };
    if (success) {
      write.flush(rsvp);
      if (sourceLens === 'me') {
        http.expectOne('/api/user/meetings').flush([{ ...meeting, my_rsvp: rsvp }]);
      } else {
        http.expectNone('/api/user/meetings');
      }
      if (sourceLens === 'me') expect(pendingIds).toEqual([]);
      expect(buttons.selectedResponse()).toBe('accepted');
      expect(fixture.componentInstance.confirmedRsvps()).toEqual([expect.objectContaining({ response_type: 'accepted', scope: 'all' })]);
    } else {
      write.flush({ error: 'Synthetic write rejected' }, { status: 403, statusText: 'Forbidden' });
      http.expectNone('/api/user/meetings');
      expect(pendingIds).toEqual(['synthetic-rsvp']);
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'RSVP Failed' }));
      expect(buttons.selectedResponse()).toBeNull();
      expect(fixture.componentInstance.confirmedRsvps()).toEqual([]);
    }
    fixture.detectChanges();
    for (const request of http.match('/api/meetings/synthetic-rsvp/rsvp/me')) {
      request.flush(success ? rsvp : null);
    }
    if (organizer) {
      const overview = fixture.debugElement.query(By.directive(MeetingRsvpDetailsComponent)).componentInstance as MeetingRsvpDetailsComponent;
      expect(overview.acceptedCount()).toBe(success ? 1 : 0);
      expect(overview.registrants()[0].rsvp?.response_type ?? null).toBe(success ? 'accepted' : null);
    }
    if (organizer && success) {
      fixture.destroy();
      // Recreated in the same lens from a row without `my_rsvp` (as Foundation/Project rows are), while the index is still stale.
      const sameLens = TestBed.createComponent(MeetingCardComponent);
      sameLens.componentRef.setInput('meetingInput', meeting);
      sameLens.detectChanges();
      for (const block of await sameLens.getDeferBlocks()) {
        await block.render(DeferBlockState.Complete);
      }
      sameLens.detectChanges();
      for (const request of http.match('/api/meetings/synthetic-rsvp/rsvp/me')) {
        request.flush(null);
      }
      const sameLensButtons = sameLens.debugElement.query(By.directive(RsvpButtonGroupComponent)).componentInstance as RsvpButtonGroupComponent;
      const sameLensOverview = sameLens.debugElement.query(By.directive(MeetingRsvpDetailsComponent)).componentInstance as MeetingRsvpDetailsComponent;
      expect(sameLensButtons.selectedResponse()).toBe('accepted');
      expect(sameLensOverview.acceptedCount()).toBe(1);
      sameLens.destroy();
      let returningMeeting: Meeting = { ...meeting, my_rsvp: rsvp };
      if (sourceLens !== 'me') {
        subscription.unsubscribe();
        activeLens.set('me');
        let returningRows: Meeting[] = [];
        const returning = userService.getUserMeetings().subscribe((rows) => (returningRows = rows));
        http.expectOne('/api/user/meetings').flush([meeting]);
        returningMeeting = returningRows[0];
        expect(returningMeeting.my_rsvp?.response_type).toBe('accepted');
        returning.unsubscribe();
      }
      const recreated = TestBed.createComponent(MeetingCardComponent);
      recreated.componentRef.setInput('meetingInput', returningMeeting);
      recreated.detectChanges();
      for (const block of await recreated.getDeferBlocks()) {
        await block.render(DeferBlockState.Complete);
      }
      recreated.detectChanges();
      for (const request of http.match('/api/meetings/synthetic-rsvp/rsvp/me')) {
        request.flush(null);
      }
      const overview = recreated.debugElement.query(By.directive(MeetingRsvpDetailsComponent)).componentInstance as MeetingRsvpDetailsComponent;
      expect(overview.acceptedCount()).toBe(1);
      expect(overview.registrants()[0].rsvp?.response_type).toBe('accepted');
      recreated.destroy();
    }
    for (const request of http.match('/api/profile')) {
      request.flush({ profile: {} });
    }
    http.verify();
    subscription.unsubscribe();
  });
});
