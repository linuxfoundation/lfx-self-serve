// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { RecurrenceType } from '@lfx-one/shared/enums';
import {
  BatchRegistrantOperationResponse,
  Meeting,
  MeetingDetailsState,
  MeetingHomeRow,
  MeetingHostCandidate,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRegistrantWithState,
  MeetingRsvp,
  MeetingSelfGuest,
  PastMeetingParticipant,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingSelfInviteService } from '@services/meeting-self-invite.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { BehaviorSubject, NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingEditScopeModalComponent } from '../../meeting-edit-scope-modal/meeting-edit-scope-modal.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';
import { MeetingDetailsGuestsComponent } from './meeting-details-guests.component';

const meeting = (overrides: Partial<Meeting> = {}): Meeting =>
  ({
    id: 'synthetic-meeting',
    project_uid: 'p-1',
    organizers: ['org@acme.example'],
    committees: [],
    is_invite_responses_enabled: true,
    organizer: true,
    ...overrides,
  }) as Meeting;

const OCCURRENCE = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const row = (value: Meeting): MeetingHomeRow => ({
  key: 'row',
  meeting: value,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: null,
  startTime: '2050-01-01T09:00:00.000Z',
  durationMinutes: 30,
});

const registrants: MeetingRegistrant[] = [
  {
    uid: 'r-1',
    first_name: 'Ada',
    last_name: 'Lane',
    email: 'org@acme.example',
    host: true,
    type: 'direct',
    job_title: 'Lead',
    org_name: 'Acme',
    linkedin_profile: 'https://linkedin.example/in/ada',
  },
  {
    uid: 'r-2',
    first_name: 'Bo',
    last_name: 'Kim',
    email: 'bo@acme.example',
    host: false,
    type: 'committee',
    committee_uid: 'c-1',
    committee_voting_status: 'Voting Rep',
    rsvp: { response_type: 'accepted' },
  },
  { uid: 'r-3', first_name: 'Cy', last_name: 'Ng', email: 'cy@acme.example', host: false, type: 'direct', rsvp: { response_type: 'declined' } },
] as MeetingRegistrant[];

describe('MeetingDetailsGuestsComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsGuestsComponent>;
  let state: WritableSignal<MeetingDetailsState>;
  let current: WritableSignal<Meeting>;
  let organizer: WritableSignal<boolean>;
  let canViewGuests: WritableSignal<boolean>;
  let meetingService: Record<string, ReturnType<typeof vi.fn>> & { removedRegistrationMeetingIds?: WritableSignal<ReadonlySet<string>> };
  let removedIds: WritableSignal<ReadonlySet<string>>;
  let occurrence: WritableSignal<MeetingOccurrence | null>;
  let hosts: WritableSignal<readonly MeetingHostCandidate[]>;
  let guestCount: WritableSignal<number | null>;
  let listedSelfRegistrantUids: WritableSignal<readonly string[]>;
  let participantsVersion: WritableSignal<number>;
  let removedUids: WritableSignal<ReadonlySet<string>>;
  let composerOpen: ReturnType<typeof vi.fn>;
  let modalOpen: ReturnType<typeof vi.fn>;
  let closeDialog: ReturnType<typeof vi.fn>;
  let dialogClosed: Subject<void>;
  let confirmedRsvps: WritableSignal<MeetingRsvp[]>;
  let toastShow: ReturnType<typeof vi.fn>;
  let refreshList: ReturnType<typeof vi.fn<() => void>>;
  let markSelfInvited: ReturnType<typeof vi.fn>;
  let selfGuest$: BehaviorSubject<MeetingSelfGuest | null>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const names = (): string[] => all('meeting-details-guests-name').map((name) => name.textContent?.trim() ?? '');
  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(MeetingDetailsGuestsComponent);
    await fixture.whenStable();
  };
  const component = () => fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    state = signal<MeetingDetailsState>('far');
    current = signal(meeting());
    organizer = signal(true);
    canViewGuests = signal(true);
    occurrence = signal(null);
    hosts = signal([]);
    guestCount = signal(null);
    listedSelfRegistrantUids = signal([]);
    participantsVersion = signal(0);
    removedUids = signal(new Set<string>());
    removedIds = signal(new Set<string>());
    selfGuest$ = new BehaviorSubject<MeetingSelfGuest | null>(null);
    meetingService = {
      getMeetingDetail: vi.fn(() => of(current())),
      getMyMeetingRegistrants: vi.fn(() => of(registrants)),
      clearRemovalIfReinvited: vi.fn(),
      clearRemovedRegistration: vi.fn(() => removedIds.set(new Set())),
      stripMetadata: vi.fn((id: string, guest: MeetingRegistrantWithState) => MeetingService.prototype.stripMetadata.call({}, id, guest)),
      getPastMeetingParticipants: vi.fn(() =>
        of([
          { uid: 'p-1', first_name: 'Ada', last_name: 'Lane', email: 'ada@acme.example', host: false, is_attended: false, is_invited: true },
        ] as PastMeetingParticipant[])
      ),
    };
    meetingService.removedRegistrationMeetingIds = removedIds;
    composerOpen = vi.fn();
    modalOpen = vi.fn(() => ({ closed: of({ proceed: true, scope: 'series' }) }));
    dialogClosed = new Subject<void>();
    closeDialog = vi.fn(() => dialogClosed.next());
    confirmedRsvps = signal([]);
    toastShow = vi.fn();
    refreshList = vi.fn();
    markSelfInvited = vi.fn();

    TestBed.configureTestingModule({
      imports: [MeetingDetailsGuestsComponent],
      providers: [
        {
          provide: MeetingDetailsContext,
          useValue: {
            meeting: current,
            state,
            organizer,
            canViewGuests,
            shownRow: computed(() =>
              occurrence() ? { ...row(current()), occurrence: occurrence(), occurrenceId: occurrence()?.occurrence_id ?? null } : row(current())
            ),
            occurrence,
            hosts,
            guestCount,
            removedRegistrantUids: removedUids,
            savedRsvps: confirmedRsvps,
            listedSelfRegistrantUids,
            pastMeetingId: signal('synthetic-past-id'),
            participantsVersion,
            refreshList,
            refreshParticipants: vi.fn(() => {
              participantsVersion.update((version) => version + 1);
              refreshList();
            }),
          },
        },
        { provide: MeetingService, useValue: meetingService },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn(() => of([])) } },
        {
          provide: UserService,
          useValue: {
            authenticated: signal(true),
            viewerUsername: signal('viewer'),
            user: signal({ email: 'bo@acme.example' }),
            refreshUserMeetings: vi.fn(),
            confirmedMeetingRsvps: () => confirmedRsvps(),
            getMeetingSelfGuest: vi.fn(() => selfGuest$),
          },
        },
        MeetingsHomeEditService,
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: UiModalService, useValue: { open: modalOpen } },
        { provide: UiToastService, useValue: { show: toastShow } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: MeetingDetailsSource, useValue: { hostRef: { close: closeDialog, closed: dialogClosed }, markSelfInvited } },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lists registrants from the viewer-scoped endpoint with roles, details and the viewer marked', async () => {
    await render();

    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', true, undefined, false, false);
    expect(query('meeting-details-guests-linkedin')?.getAttribute('href')).toBe('https://linkedin.example/in/ada');
    expect(query('meeting-details-guests-voting')?.textContent?.trim()).toBe('Voting Rep');
    expect(query('meeting-details-guests-email')).toBeNull();
    expect(guestCount()).toBe(3);
    expect(hosts().map((host) => host.email)).toEqual(['org@acme.example']);
    expect(names()).toEqual(['Bo Kim (You)', 'Ada Lane', 'Cy Ng']);
    expect(all('meeting-details-guests-role').map((badge) => badge.textContent?.trim())).toEqual(['Organizer']);
    expect(query('meeting-details-guests-meta')?.textContent?.trim()).toBe('Lead · Acme');
    const avatars = all('meeting-details-guests-row').map((row) => row.querySelector('lfx-ui-avatar')?.getAttribute('aria-label'));
    expect(avatars).toEqual(['RSVP: Yes', 'RSVP: No response', 'RSVP: No']);
    expect(query('meeting-details-guests-add')).not.toBeNull();
  });

  it('hides Add Guests from an invitee', async () => {
    organizer.set(false);
    await render();

    expect(all('meeting-details-guests-row')).toHaveLength(3);
    expect(query('meeting-details-guests-add')).toBeNull();
  });

  it('lists participants once the meeting has ended', async () => {
    state.set('ended');
    await render();

    expect(meetingService['getPastMeetingParticipants']).toHaveBeenCalledWith('synthetic-past-id');
    expect(all('meeting-details-guests-row')).toHaveLength(1);
    expect(query('meeting-details-guests-email')?.textContent?.trim()).toBe('ada@acme.example');
    expect(query('meeting-details-guests-search')?.querySelector('input')?.getAttribute('placeholder')).toBe('Search participants');
  });

  it('reloads the participants in place when they change, keeping the rows and count until the new list lands', async () => {
    state.set('ended');
    await render();
    expect(guestCount()).toBe(1);

    const next = new Subject<PastMeetingParticipant[]>();
    meetingService['getPastMeetingParticipants'].mockReturnValueOnce(next);
    participantsVersion.set(1);
    await fixture.whenStable();
    expect(query('meeting-details-guests-loading')).toBeNull();
    expect(all('meeting-details-guests-row')).toHaveLength(1);
    expect(guestCount()).toBe(1);

    next.next([
      { uid: 'p-1', first_name: 'Ada', last_name: 'Lane', email: 'ada@acme.example', host: false, is_attended: true, is_invited: true },
      { uid: 'p-2', first_name: 'Bo', last_name: 'Kim', email: 'bo@acme.example', host: false, is_attended: true, is_invited: false },
    ] as PastMeetingParticipant[]);
    await fixture.whenStable();
    expect(all('meeting-details-guests-row')).toHaveLength(2);
    expect(guestCount()).toBe(2);
  });

  it('shows no participants when the past meeting record does not exist yet', async () => {
    meetingService['getPastMeetingParticipants'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    state.set('ended');
    await render();

    expect(query('meeting-details-guests-empty')).not.toBeNull();
    expect(query('meeting-details-guests-error')).toBeNull();
  });

  it('lets a Voting Reps filter apply on its own', async () => {
    current.set(meeting({ committees: [{ uid: 'c-1', name: 'Steering', allowed_voting_statuses: ['voting_rep'] }] }));
    state.set('ended');
    await render();

    component()['setDraft']('voting', 'reps');
    expect(component()['draftChanged']()).toBe(true);
  });

  it('applies an answer the viewer saved in the drawer to their row', async () => {
    await render();
    const status = () => (component()['load']() as { rows: { uid: string; status: string }[] }).rows.find((row) => row.uid === 'r-2')?.status;
    expect(status()).toBe('yes');

    confirmedRsvps.set([{ registrant_id: 'r-2', response_type: 'declined', scope: 'all' } as MeetingRsvp]);
    await fixture.whenStable();
    expect(status()).toBe('no');
    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenCalledTimes(1);
  });

  it("drops the viewer's row, count and host entry once they remove themselves", async () => {
    meetingService['getMyMeetingRegistrants'].mockReturnValueOnce(of(registrants.map((person) => (person.uid === 'r-2' ? { ...person, host: true } : person))));
    await render();
    expect(guestCount()).toBe(3);
    expect(
      hosts()
        .map((person) => person.email)
        .sort()
    ).toEqual(['bo@acme.example', 'org@acme.example']);
    expect(listedSelfRegistrantUids()).toEqual(['r-2']);

    removedIds.set(new Set(['synthetic-meeting']));
    await fixture.whenStable();
    expect(guestCount()).toBe(2);
    expect(names()).not.toContain('Bo Kim (You)');
    expect(hosts().map((person) => person.email)).toEqual(['org@acme.example']);
    expect(meetingService['clearRemovalIfReinvited']).toHaveBeenCalledWith('synthetic-meeting', ['r-2']);
    expect(listedSelfRegistrantUids()).toEqual([]);
  });

  it('drops guests the drawer already removed when the tab mounts', async () => {
    removedUids.set(new Set(['r-3']));
    await render();
    expect(names()).not.toContain('Cy Ng');
    expect(guestCount()).toBe(2);
  });

  it('clears the count and hosts when the list becomes hidden', async () => {
    await render();
    expect(guestCount()).toBe(3);

    canViewGuests.set(false);
    await fixture.whenStable();
    expect(guestCount()).toBeNull();
    expect(hosts()).toEqual([]);
  });

  it('forgets the viewer listing while another date loads and once the list is hidden', async () => {
    current.set(meeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as Partial<Meeting>));
    await render();
    expect(listedSelfRegistrantUids()).toEqual(['r-2']);

    meetingService['getMyMeetingRegistrants'].mockReturnValueOnce(NEVER);
    occurrence.set(OCCURRENCE);
    await fixture.whenStable();
    expect(listedSelfRegistrantUids()).toEqual([]);

    occurrence.set(null);
    await fixture.whenStable();
    expect(listedSelfRegistrantUids()).toEqual(['r-2']);

    canViewGuests.set(false);
    await fixture.whenStable();
    expect(listedSelfRegistrantUids()).toEqual([]);
  });

  it('shows the hidden state without fetching when the list is not shared', async () => {
    canViewGuests.set(false);
    await render();

    expect(query('meeting-details-guests-hidden')).not.toBeNull();
    expect(meetingService['getMyMeetingRegistrants']).not.toHaveBeenCalled();
  });

  it('shows one flat list and filters by group and status through the applied draft', async () => {
    current.set(meeting({ committees: [{ uid: 'c-1', name: 'Steering' }] }));
    await render();

    expect(all('meeting-details-guests-row')).toHaveLength(3);
    const close = vi.fn();
    component()['setDraft']('group', 'direct');
    component()['apply'](close);
    await fixture.whenStable();
    expect(close).toHaveBeenCalled();
    expect(names()).toEqual(['Ada Lane', 'Cy Ng']);

    component()['setDraft']('status', 'no');
    component()['apply'](close);
    await fixture.whenStable();
    expect(names()).toEqual(['Cy Ng']);
    expect(all('meeting-details-guests-chip').map((chip) => chip.textContent?.trim())).toEqual(['RSVP status: No', 'Group: Direct invite']);
  });

  it('applies the search 300ms after typing stops, and offers a reset when nothing matches', async () => {
    const settle = async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await fixture.whenStable();
    };
    await render();
    (fixture.componentInstance as unknown as { query: WritableSignal<string> }).query.set('nobody');
    await settle(100);
    expect(all('meeting-details-guests-row')).toHaveLength(3);

    await settle(300);
    expect(query('meeting-details-guests-no-match')).not.toBeNull();
    query('meeting-details-guests-reset')?.querySelector('button')?.click();
    await settle(350);
    expect(all('meeting-details-guests-row')).toHaveLength(3);
  });

  it('shows the toolbar fade only while the toolbar is stuck', async () => {
    let notify: IntersectionObserverCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public observe = observe;
        public disconnect = disconnect;
        public constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
      }
    );
    const entry = (isIntersecting: boolean, top: number, width = 400) =>
      [{ isIntersecting, boundingClientRect: { top, width }, rootBounds: { top: 50 } }] as unknown as IntersectionObserverEntry[];
    await render();

    expect(observe).toHaveBeenCalled();
    expect(query('meeting-details-guests-toolbar-fade')).toBeNull();
    notify(entry(false, 20), {} as IntersectionObserver);
    await fixture.whenStable();
    expect(query('meeting-details-guests-toolbar-fade')).not.toBeNull();
    notify(entry(true, 60), {} as IntersectionObserver);
    await fixture.whenStable();
    expect(query('meeting-details-guests-toolbar-fade')).toBeNull();
    notify(entry(false, 900), {} as IntersectionObserver);
    await fixture.whenStable();
    expect(query('meeting-details-guests-toolbar-fade')).toBeNull();
    // A hidden tab reports an empty rect at the top.
    notify(entry(false, 0, 0), {} as IntersectionObserver);
    await fixture.whenStable();
    expect(query('meeting-details-guests-toolbar-fade')).toBeNull();
  });

  it('drops an RSVP filter once the meeting ends', async () => {
    state.set('live');
    await render();
    component()['setDraft']('status', 'yes');
    component()['apply'](vi.fn());
    await fixture.whenStable();
    expect(all('meeting-details-guests-chip')).toHaveLength(1);

    state.set('ended');
    await fixture.whenStable();
    expect(all('meeting-details-guests-chip')).toHaveLength(0);
    expect(all('meeting-details-guests-row')).toHaveLength(1);
  });

  it('keeps the list when the fresh detail replaces the meeting unchanged', async () => {
    await render();
    current.set({ ...current() });
    await fixture.whenStable();

    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenCalledTimes(1);
    expect(query('meeting-details-guests-loading')).toBeNull();
  });

  it('shows the empty state when nobody is invited', async () => {
    meetingService['getMyMeetingRegistrants'].mockReturnValueOnce(of([]));
    await render();

    expect(query('meeting-details-guests-empty')).not.toBeNull();
    expect(all('meeting-details-guests-row')).toHaveLength(0);
  });

  it('shows an error with a retry that refetches', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    meetingService['getMyMeetingRegistrants'].mockReturnValueOnce(throwError(() => new Error('boom')));
    await render();

    expect(logError).toHaveBeenCalled();

    expect(query('meeting-details-guests-error')).not.toBeNull();
    query('meeting-details-guests-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(all('meeting-details-guests-row')).toHaveLength(3);
  });

  it('closes the drawer and opens the editor at Guests after the permission re-check', async () => {
    await render();
    query('meeting-details-guests-add')?.querySelector('button')?.click();

    expect(closeDialog).toHaveBeenCalled();
    expect(meetingService['getMeetingDetail'].mock.invocationCallOrder[0]).toBeLessThan(closeDialog.mock.invocationCallOrder[0]);
    expect(meetingService['getMeetingDetail']).toHaveBeenCalledWith('synthetic-meeting', { skipCache: true });
    expect(modalOpen).not.toHaveBeenCalled();
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'p-1', section: 'guests' });
  });

  it('asks a series row without a date for answers across all dates, and a dated row for that date', async () => {
    current.set(meeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as Partial<Meeting>));
    await render();
    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenLastCalledWith('synthetic-meeting', true, undefined, false, true);

    occurrence.set(OCCURRENCE);
    await fixture.whenStable();
    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenLastCalledWith('synthetic-meeting', true, '2525245200', false, false);
  });

  it('asks the scope of a recurring meeting before opening the editor at Guests', async () => {
    current.set(meeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as Partial<Meeting>));
    occurrence.set(OCCURRENCE);
    await render();
    query('meeting-details-guests-add')?.querySelector('button')?.click();

    expect(modalOpen).toHaveBeenCalledWith(
      MeetingEditScopeModalComponent,
      expect.objectContaining({ data: expect.objectContaining({ occurrence: OCCURRENCE }) })
    );
    expect(modalOpen.mock.invocationCallOrder[0]).toBeLessThan(closeDialog.mock.invocationCallOrder[0]);
    expect(modalOpen.mock.invocationCallOrder[0]).toBeLessThan(composerOpen.mock.invocationCallOrder[0]);
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'p-1', section: 'guests' });
  });

  describe('organizer guest actions', () => {
    const cy = registrants[2];
    const confirmWith = (accept: boolean) => modalOpen.mockReturnValueOnce({ closed: of(accept), close: vi.fn() });
    const roles = (): string[] => all('meeting-details-guests-role').map((badge) => badge.textContent?.trim() ?? '');

    it('offers actions on every upcoming registrant row, keeping committee rows off removal', async () => {
      await render();

      expect(all('meeting-details-guests-actions')).toHaveLength(3);
      const actions = (fixture.componentInstance as unknown as { rowActions: () => Map<string, unknown> }).rowActions();
      expect(actions.get('r-1')).toEqual({ resend: true, host: false, remove: true });
      expect(actions.get('r-2')).toEqual({ resend: true, host: true, remove: false });
    });

    it('offers none to an invitee or once the meeting has ended', async () => {
      organizer.set(false);
      await render();
      expect(all('meeting-details-guests-actions')).toHaveLength(0);

      organizer.set(true);
      state.set('ended');
      await fixture.whenStable();
      expect(all('meeting-details-guests-actions')).toHaveLength(0);
    });

    it('resends after the confirmation and names the guest in the toast', async () => {
      meetingService['resendMeetingInvitation'] = vi.fn(() => of({ message: 'ok' }));
      await render();
      confirmWith(true);
      component()['confirmResend'](cy);

      expect(modalOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          role: 'alertdialog',
          data: expect.objectContaining({ heading: 'Resend invitation', message: 'Resend the meeting invitation to Cy Ng?' }),
        })
      );
      expect(meetingService['resendMeetingInvitation']).toHaveBeenCalledWith('synthetic-meeting', 'r-3');
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting invitation resent to Cy Ng' });
    });

    it('shows the server reason when a resend fails', async () => {
      meetingService['resendMeetingInvitation'] = vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Invite limit reached' } }))
      );
      await render();
      confirmWith(true);
      component()['confirmResend'](cy);

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: 'Error', description: 'Invite limit reached' }));
    });

    it('makes a guest a host without confirming, re-labels the row and refreshes the list', async () => {
      meetingService['getChangedFields'] = vi.fn((guest: Parameters<MeetingService['getChangedFields']>[0]) =>
        MeetingService.prototype.getChangedFields.call({}, guest)
      );
      meetingService['updateMeetingRegistrants'] = vi.fn(() => of({ successes: [], failures: [], summary: { total: 1, successful: 1, failed: 0 } }));
      await render();
      const scoped = { ...cy, occurrence: '2525245200', user_id: 'u-3', username: 'cyng', avatar_url: 'https://avatars.example/cy.png' };
      component()['toggleHost'](scoped);
      await fixture.whenStable();

      expect(modalOpen).not.toHaveBeenCalled();
      const [[meetingId, [update]]] = meetingService['updateMeetingRegistrants'].mock.calls;
      expect(meetingId).toBe('synthetic-meeting');
      expect(update.uid).toBe('r-3');
      expect(update.changes).toMatchObject({ host: true, occurrence_id: '2525245200', user_id: 'u-3', username: 'cyng' });
      expect(update.changes).not.toHaveProperty('avatar_url');
      expect(roles()).toEqual(['Organizer', 'Host']);
      expect(refreshList).toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Cy Ng is now a meeting host' });
    });

    it('moves a guest to the host position as soon as the change saves, then back once removed', async () => {
      const al = { ...cy, uid: 'r-4', first_name: 'Al', last_name: 'Fox', email: 'al@acme.example' } as MeetingRegistrant;
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, al]));
      meetingService['getChangedFields'] = vi.fn(() => ({}));
      meetingService['updateMeetingRegistrants'] = vi.fn(() => of({ successes: [], failures: [], summary: { total: 1, successful: 1, failed: 0 } }));
      await render();
      expect(names()).toEqual(['Bo Kim (You)', 'Ada Lane', 'Al Fox', 'Cy Ng']);

      component()['toggleHost'](cy);
      await fixture.whenStable();
      expect(names()).toEqual(['Bo Kim (You)', 'Ada Lane', 'Cy Ng', 'Al Fox']);
      expect(query('meeting-details-guests-loading')).toBeNull();
      expect(meetingService['getMyMeetingRegistrants']).toHaveBeenCalledTimes(1);
      expect(
        hosts()
          .map((person) => person.email)
          .sort()
      ).toEqual(['cy@acme.example', 'org@acme.example']);

      component()['toggleHost']({ ...cy, host: true });
      await fixture.whenStable();
      expect(names()).toEqual(['Bo Kim (You)', 'Ada Lane', 'Al Fox', 'Cy Ng']);
      expect(hosts().map((person) => person.email)).toEqual(['org@acme.example']);
    });

    it('reports an upstream host failure', async () => {
      meetingService['getChangedFields'] = vi.fn(() => ({}));
      meetingService['updateMeetingRegistrants'] = vi.fn(() =>
        of({ successes: [], failures: [{ input: null, error: { message: 'Rejected' } }], summary: { total: 1, successful: 0, failed: 1 } })
      );
      await render();
      component()['toggleHost'](cy);

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'Rejected' }));
      expect(refreshList).not.toHaveBeenCalled();
    });

    it('removes a guest only after the confirmation and hides the row at once', async () => {
      meetingService['deleteMeetingRegistrants'] = vi.fn(() => of({ successes: ['r-3'], failures: [], summary: { total: 1, successful: 1, failed: 0 } }));
      await render();

      confirmWith(false);
      component()['confirmRemove'](cy);
      expect(meetingService['deleteMeetingRegistrants']).not.toHaveBeenCalled();

      confirmWith(true);
      component()['confirmRemove'](cy);
      await fixture.whenStable();
      expect(modalOpen).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({ heading: 'Remove guest', message: 'Are you sure you want to remove Cy Ng from this meeting?', danger: true }),
        })
      );
      expect(meetingService['deleteMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', ['r-3']);
      expect(removedUids()).toEqual(new Set(['r-3']));
      expect(names()).toEqual(['Bo Kim (You)', 'Ada Lane']);
      expect(guestCount()).toBe(2);
      expect(refreshList).toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Cy Ng removed from the meeting' });
    });

    it('shows the empty state once the last guest is removed', async () => {
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([cy]));
      meetingService['deleteMeetingRegistrants'] = vi.fn(() => of({ successes: ['r-3'], failures: [], summary: { total: 1, successful: 1, failed: 0 } }));
      await render();
      confirmWith(true);
      component()['confirmRemove'](cy);
      await fixture.whenStable();

      expect(query('meeting-details-guests-empty')).not.toBeNull();
      expect(query('meeting-details-guests-no-match')).toBeNull();
      expect(guestCount()).toBe(0);
    });

    it('drops a removal confirmed after the date has ended', async () => {
      const closed = new Subject<boolean>();
      meetingService['deleteMeetingRegistrants'] = vi.fn(() => of({ successes: ['r-3'], failures: [], summary: { total: 1, successful: 1, failed: 0 } }));
      await render();
      modalOpen.mockReturnValueOnce({ closed, close: vi.fn() });
      component()['confirmRemove'](cy);

      state.set('ended');
      await fixture.whenStable();
      closed.next(true);
      expect(meetingService['deleteMeetingRegistrants']).not.toHaveBeenCalled();
    });

    it('reports the reason a rejected host change gives', async () => {
      meetingService['getChangedFields'] = vi.fn(() => ({}));
      meetingService['updateMeetingRegistrants'] = vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Hosts must have a Zoom account.' } }))
      );
      await render();
      component()['toggleHost'](cy);

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'Hosts must have a Zoom account.' }));
    });

    it('reports the reason a rejected removal gives', async () => {
      meetingService['deleteMeetingRegistrants'] = vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                successes: [],
                failures: [{ input: 'r-3', error: { message: 'Committee members cannot be removed.' } }],
                summary: { total: 1, successful: 0, failed: 1 },
              },
            })
        )
      );
      await render();
      confirmWith(true);
      component()['confirmRemove'](cy);
      await fixture.whenStable();

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'Committee members cannot be removed.' }));
    });

    it('keeps the fallback when every removal failed on an upstream server error', async () => {
      const failure = { message: 'upstream exploded', details: { statusCode: 503 } };
      meetingService['deleteMeetingRegistrants'] = vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { successes: [], failures: [{ input: 'r-3', error: failure }], summary: { total: 1, successful: 0, failed: 1 } },
            })
        )
      );
      await render();
      confirmWith(true);
      component()['confirmRemove'](cy);
      await fixture.whenStable();

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'Failed to remove guest. Please try again.' }));
    });

    it('keeps the row when the removal fails', async () => {
      meetingService['deleteMeetingRegistrants'] = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 })));
      await render();
      confirmWith(true);
      component()['confirmRemove'](cy);
      await fixture.whenStable();

      expect(all('meeting-details-guests-row')).toHaveLength(3);
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'Failed to remove guest. Please try again.' }));
    });
  });

  describe('add myself (#5798)', () => {
    const SELF: MeetingSelfGuest = {
      email: 'pat.doe@acme-motors.example',
      first_name: 'Pat',
      last_name: 'Doe',
      job_title: 'Engineer',
      org_name: 'Acme Motors',
      username: 'viewer',
      avatar_url: 'https://avatars.example/pat.png',
      matchEmails: ['pat.doe@acme-motors.example', 'pat@vendor-corp.example'],
    };
    const added: MeetingRegistrant = {
      ...registrants[2],
      uid: 'self-1',
      email: SELF.email,
      first_name: SELF.first_name,
      last_name: SELF.last_name,
      username: SELF.username,
      avatar_url: SELF.avatar_url,
      occurrence_id: null,
    };
    const success: BatchRegistrantOperationResponse<MeetingRegistrant> = {
      summary: { successful: 1, failed: 0, total: 1 },
      successes: [added],
      failures: [],
    };
    const clickSelf = () => query('meeting-details-guests-add-self')?.querySelector('button')?.click();
    const recurring = () => {
      current.set(meeting({ recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as Partial<Meeting>));
      occurrence.set(OCCURRENCE);
    };

    beforeEach(() => {
      selfGuest$.next(SELF);
      TestBed.inject(UserService).user.update((user) => (user ? { ...user, email: 'pat@vendor-corp.example' } : null));
      meetingService['addMeetingRegistrants'] = vi.fn(() => of(success));
    });

    it.each([false, true])('offers the action with an empty list: %s', async (empty) => {
      if (empty) meetingService['getMyMeetingRegistrants'].mockReturnValue(of([]));
      await render();
      expect(query('meeting-details-guests-add-self')?.textContent).toContain('Add myself');
      clickSelf();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
      expect(names()).toContain('Pat Doe (You)');
      expect(guestCount()).toBe(empty ? 1 : 4);
      expect(listedSelfRegistrantUids()).toContain('self-1');
    });

    it('sends the preferred email and profile details as a direct, non-host guest, and restores focus', async () => {
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', [
        {
          meeting_id: 'synthetic-meeting',
          email: SELF.email,
          first_name: 'Pat',
          last_name: 'Doe',
          host: false,
          job_title: 'Engineer',
          org_name: 'Acme Motors',
          username: 'viewer',
          avatar_url: SELF.avatar_url,
        },
      ]);
      expect(modalOpen).not.toHaveBeenCalled();
      expect(refreshList).toHaveBeenCalled();
      expect(markSelfInvited).toHaveBeenCalledWith('synthetic-meeting', ['self-1']);
      expect(document.activeElement).toBe(query('meeting-details-guests-add')?.querySelector('button'));
    });

    it.each([' Pat@Vendor-Corp.example ', 'PAT.DOE@ACME-MOTORS.EXAMPLE'])('hides for a listed alias, even behind a filter: %s', async (email) => {
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([{ ...registrants[1], email }]));
      await render();
      component()['setDraft']('role', 'host');
      component()['apply'](vi.fn());
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it('hides when the user is listed under another address with their LFID, as the "You" row shows', async () => {
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([{ ...registrants[1], email: 'work@acme-motors.example', username: 'Viewer' }]));
      await render();
      expect(names()).toContain(`${registrants[1].first_name} ${registrants[1].last_name} (You)`);
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it.each(['invitee', 'ended', 'hidden', 'loading', 'error', 'missing name', 'missing identity'])('does not offer or submit for %s', async (condition) => {
      if (condition === 'invitee') organizer.set(false);
      if (condition === 'ended') state.set('ended');
      if (condition === 'hidden') canViewGuests.set(false);
      if (condition === 'loading') meetingService['getMyMeetingRegistrants'].mockReturnValue(NEVER);
      if (condition === 'error') meetingService['getMyMeetingRegistrants'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      if (condition === 'missing name') selfGuest$.next({ ...SELF, last_name: '' });
      if (condition === 'missing identity') selfGuest$.next(null);
      await render();
      expect(query('meeting-details-guests-add-self')).toBeNull();
      component()['addSelf']();
      expect(meetingService['addMeetingRegistrants']).not.toHaveBeenCalled();
      if (condition === 'invitee' || condition === 'ended') expect(TestBed.inject(UserService).getMeetingSelfGuest).not.toHaveBeenCalled();
    });

    it('prevents a second submit while the first is pending', async () => {
      const response = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
      meetingService['addMeetingRegistrants'].mockReturnValue(response);
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')?.querySelector('button')?.disabled).toBe(true);
      component()['addSelf']();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledTimes(1);
      response.next(success);
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it('hides and blocks self-add while another entry point owns the shared pending guard', async () => {
      await render();
      const invite = TestBed.inject(MeetingSelfInviteService);
      const response = new Subject<void>();
      invite.withPendingInvite$('synthetic-meeting', () => response).subscribe();
      await fixture.whenStable();

      expect(query('meeting-details-guests-add-self')).toBeNull();
      component()['addSelf']();
      expect(meetingService['addMeetingRegistrants']).not.toHaveBeenCalled();

      response.complete();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).not.toBeNull();
    });

    it.each(['success', 'failure'])('keeps a confirmed write alive after destruction and skips late %s view updates', async (outcome) => {
      const response = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
      meetingService['addMeetingRegistrants'].mockReturnValue(response);
      await render();
      clickSelf();
      const refreshParticipants = TestBed.inject(MeetingDetailsContext).refreshParticipants;
      vi.mocked(refreshParticipants).mockClear();
      toastShow.mockClear();
      fixture.destroy();

      expect(response.observed).toBe(true);
      const invite = TestBed.inject(MeetingSelfInviteService);
      expect(invite.isPending('synthetic-meeting')).toBe(true);
      const competingWrite = vi.fn(() => of(success));
      invite.withPendingInvite$('synthetic-meeting', competingWrite).subscribe();
      invite.add$('synthetic-meeting').subscribe();
      expect(competingWrite).not.toHaveBeenCalled();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledTimes(1);
      if (outcome === 'success') {
        response.next(success);
        expect(meetingService['clearRemovedRegistration']).toHaveBeenCalledWith('synthetic-meeting');
        expect(markSelfInvited).toHaveBeenCalledWith('synthetic-meeting', ['self-1']);
      } else {
        response.error(new HttpErrorResponse({ status: 503 }));
      }
      expect(response.observed).toBe(false);
      expect(invite.isPending('synthetic-meeting')).toBe(false);
      expect(refreshParticipants).not.toHaveBeenCalled();
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('does not update a replacement meeting when a self-add finishes late', async () => {
      const response = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
      meetingService['addMeetingRegistrants'].mockReturnValue(response);
      await render();
      clickSelf();
      current.set(meeting({ id: 'replacement-meeting' }));
      await fixture.whenStable();
      const refreshParticipants = TestBed.inject(MeetingDetailsContext).refreshParticipants;
      vi.mocked(refreshParticipants).mockClear();
      toastShow.mockClear();
      response.next(success);
      await fixture.whenStable();

      expect(meetingService['clearRemovedRegistration']).toHaveBeenCalledWith('synthetic-meeting');
      expect(refreshParticipants).not.toHaveBeenCalled();
      expect(toastShow).not.toHaveBeenCalled();
      expect(query('meeting-details-guests-add-self')).not.toBeNull();
    });

    it.each(['network', 'batch'])('keeps the button and supports retry after a %s failure', async (failure) => {
      const failed = { ...success, summary: { successful: 0, failed: 1, total: 1 }, successes: [] };
      const response = failure === 'network' ? throwError(() => new HttpErrorResponse({ status: 503 })) : of(failed);
      meetingService['addMeetingRegistrants'].mockReturnValueOnce(response);
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).not.toBeNull();
      expect(guestCount()).toBe(3);
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
      expect(markSelfInvited).not.toHaveBeenCalled();
      clickSelf();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it('does not invite when the recurring scope choice is cancelled', async () => {
      recurring();
      modalOpen.mockReturnValueOnce({ closed: of(undefined), close: vi.fn() });
      await render();
      clickSelf();
      expect(modalOpen).toHaveBeenCalled();
      expect(meetingService['addMeetingRegistrants']).not.toHaveBeenCalled();
      expect(closeDialog).not.toHaveBeenCalled();
    });

    it('invites to the whole recurring series when chosen', async () => {
      recurring();
      modalOpen.mockReturnValueOnce({ closed: of('all'), close: vi.fn() });
      await render();
      clickSelf();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', [
        expect.not.objectContaining({ occurrence_id: expect.anything() }),
      ]);
    });

    it('invites only the selected occurrence with a seconds-based id', async () => {
      recurring();
      occurrence.set({ ...OCCURRENCE, occurrence_id: '2525245200000' });
      modalOpen.mockReturnValueOnce({ closed: of('occurrence'), close: vi.fn() });
      meetingService['addMeetingRegistrants'].mockReturnValue(of({ ...success, successes: [{ ...added, occurrence_id: OCCURRENCE.occurrence_id }] }));
      await render();
      clickSelf();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', [expect.objectContaining({ occurrence_id: '2525245200' })]);
      await fixture.whenStable();
      occurrence.set({ ...OCCURRENCE, occurrence_id: '2525850000', start_time: '2050-01-15T09:00:00.000Z' });
      await fixture.whenStable();
      // Like the composer, eligibility is meeting-wide, even when the invitation targets just one date.
      expect(query('meeting-details-guests-add-self')).toBeNull();
      expect(names()).toContain('Pat Doe (You)');
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, { ...added, occurrence_id: OCCURRENCE.occurrence_id }]));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
      expect(guestCount()).toBe(4);
    });

    it('renders the real scope dialog and confirms the radio choice through its buttons', async () => {
      recurring();
      const modal = TestBed.runInInjectionContext(() => new UiModalService());
      modalOpen.mockImplementationOnce((template) => modal.open(template));
      await render();
      clickSelf();
      await fixture.whenStable();
      const dialog = document.querySelector<HTMLElement>('[data-testid="meeting-details-guests-self-scope"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.querySelector('[role="combobox"]')?.textContent).toContain('2050');
      dialog?.querySelector<HTMLInputElement>('[data-testid="meeting-details-guests-self-scope-all"] input')?.click();
      await fixture.whenStable();
      dialog?.querySelector<HTMLButtonElement>('[data-testid="meeting-details-guests-self-scope-confirm"] button')?.click();
      await fixture.whenStable();
      expect(meetingService['addMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', [
        expect.not.objectContaining({ occurrence_id: expect.anything() }),
      ]);
      expect(document.querySelector('[data-testid="meeting-details-guests-self-scope"]')).toBeNull();
    });

    it('rechecks permission when the scope dialog closes', async () => {
      recurring();
      const closed = new Subject<string>();
      modalOpen.mockReturnValueOnce({ closed, close: vi.fn() });
      await render();
      clickSelf();
      component()['addSelf']();
      expect(modalOpen).toHaveBeenCalledTimes(1);
      organizer.set(false);
      closed.next('all');
      expect(meetingService['addMeetingRegistrants']).not.toHaveBeenCalled();
    });

    it.each([
      ['self-1', null],
      ['self-1', OCCURRENCE.occurrence_id],
      ['', null],
      ['', OCCURRENCE.occurrence_id],
    ] as const)('retires an acknowledged self-add after external deletion, returned UID: %s, scope: %s', async (uid, occurrenceId) => {
      recurring();
      modalOpen.mockReturnValueOnce({ closed: of(occurrenceId ? 'occurrence' : 'all'), close: vi.fn() });
      meetingService['addMeetingRegistrants'].mockReturnValue(of({ ...success, successes: [{ ...added, uid, occurrence_id: occurrenceId }] }));
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(guestCount()).toBe(4);

      // An otherwise successful but still stale roster must preserve the unacknowledged addition.
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(4);

      const indexed = {
        ...added,
        email: ` ${SELF.email.toUpperCase()} `,
        occurrence_id: null,
        occurrence: occurrenceId ? String(Number(occurrenceId) * 1000) : '',
      };
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, indexed]));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      expect(listedSelfRegistrantUids()).toEqual(['self-1']);

      // A deletion elsewhere sets no local tombstone. The next complete roster is authoritative.
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of(registrants));
      occurrence.set({ ...OCCURRENCE, occurrence_id: '2525850000', start_time: '2050-01-15T09:00:00.000Z' });
      await fixture.whenStable();
      expect(guestCount()).toBe(3);
      expect(names()).not.toContain('Pat Doe (You)');
      expect(listedSelfRegistrantUids()).toEqual([]);
      expect(query('meeting-details-guests-add-self')).not.toBeNull();
    });

    it.each([null, '2525850000'])('keeps a UID-less hint when the indexed invite targets another scope: %s', async (otherScope) => {
      recurring();
      modalOpen.mockReturnValueOnce({ closed: of('occurrence'), close: vi.fn() });
      meetingService['addMeetingRegistrants'].mockReturnValue(of({ ...success, successes: [] }));
      await render();
      clickSelf();
      await fixture.whenStable();
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, { ...added, occurrence_id: null, occurrence: otherScope }]));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(5);

      meetingService['getMyMeetingRegistrants'].mockReturnValue(of(registrants));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it('keeps an unacknowledged self-add through a failed roster reload', async () => {
      await render();
      clickSelf();
      await fixture.whenStable();
      meetingService['getMyMeetingRegistrants'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of(registrants));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it.each([false, true])('does not resurrect a removed self-add after re-inviting, indexed before removal: %s', async (indexed) => {
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      if (indexed) {
        meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, added]));
        participantsVersion.update((version) => version + 1);
        await fixture.whenStable();
        expect(guestCount()).toBe(4);
      }
      // Actual Remove Myself sets the meeting-level marker, not the context's per-row marker.
      removedIds.set(new Set(['synthetic-meeting']));
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).not.toBeNull();
      expect(guestCount()).toBe(3);
      const reinvited = { ...added, uid: 'self-2' };
      meetingService['addMeetingRegistrants'].mockReturnValue(of({ ...success, successes: [reinvited] }));
      clickSelf();
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      expect(names().filter((name) => name === 'Pat Doe (You)')).toHaveLength(1);
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([...registrants, reinvited]));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(4);
      expect(listedSelfRegistrantUids()).toEqual(['self-2']);
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });

    it('does not send row writes with an invented UID when a successful batch omits details', async () => {
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([]));
      meetingService['addMeetingRegistrants'].mockReturnValue(of({ ...success, successes: [] }));
      await render();
      clickSelf();
      await fixture.whenStable();
      expect(query('meeting-details-guests-add-self')).toBeNull();
      expect(query('meeting-details-guests-actions')).toBeNull();
      meetingService['getMyMeetingRegistrants'].mockReturnValue(of([added]));
      participantsVersion.update((version) => version + 1);
      await fixture.whenStable();
      expect(guestCount()).toBe(1);
      expect(query('meeting-details-guests-actions')).not.toBeNull();
      removedIds.set(new Set(['synthetic-meeting']));
      await fixture.whenStable();
      clickSelf();
      await fixture.whenStable();
      // The old indexed UID cannot hide the replacement while its response also lacks a UID.
      expect(guestCount()).toBe(1);
      expect(names()).toEqual(['Pat Doe (You)']);
      expect(query('meeting-details-guests-add-self')).toBeNull();
    });
  });
});
