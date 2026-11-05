// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { RecurrenceType } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingDetailsState,
  MeetingHomeRow,
  MeetingHostCandidate,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeetingParticipant,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingEditScopeModalComponent } from '../../meeting-edit-scope-modal/meeting-edit-scope-modal.component';
import { MeetingDetailsContext } from '../meeting-details.context';
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
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;
  let removedIds: WritableSignal<ReadonlySet<string>>;
  let occurrence: WritableSignal<MeetingOccurrence | null>;
  let hosts: WritableSignal<readonly MeetingHostCandidate[]>;
  let guestCount: WritableSignal<number | null>;
  let composerOpen: ReturnType<typeof vi.fn>;
  let modalOpen: ReturnType<typeof vi.fn>;
  let closeDialog: ReturnType<typeof vi.fn>;
  let dialogClosed: Subject<void>;
  let confirmedRsvps: WritableSignal<MeetingRsvp[]>;

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
    removedIds = signal(new Set<string>());
    meetingService = {
      getMeetingDetail: vi.fn(() => of(current())),
      getMyMeetingRegistrants: vi.fn(() => of(registrants)),
      getPastMeetingParticipants: vi.fn(() =>
        of([
          { uid: 'p-1', first_name: 'Ada', last_name: 'Lane', email: 'ada@acme.example', host: false, is_attended: false, is_invited: true },
        ] as PastMeetingParticipant[])
      ),
    };
    composerOpen = vi.fn();
    modalOpen = vi.fn(() => ({ closed: of({ proceed: true, scope: 'series' }) }));
    dialogClosed = new Subject<void>();
    closeDialog = vi.fn(() => dialogClosed.next());
    confirmedRsvps = signal([]);

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
            pastMeetingId: signal('synthetic-past-id'),
          },
        },
        { provide: MeetingService, useValue: { ...meetingService, removedRegistrationMeetingIds: removedIds } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn(() => of([])) } },
        {
          provide: UserService,
          useValue: {
            viewerUsername: signal('viewer'),
            user: signal({ email: 'bo@acme.example' }),
            refreshUserMeetings: vi.fn(),
            confirmedMeetingRsvps: () => confirmedRsvps(),
          },
        },
        MeetingsHomeEditService,
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: UiModalService, useValue: { open: modalOpen } },
        { provide: UiToastService, useValue: { show: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: DialogRef, useValue: { close: closeDialog, closed: dialogClosed } },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lists registrants from the viewer-scoped endpoint with roles, details, totals and the viewer marked', async () => {
    await render();

    expect(meetingService['getMyMeetingRegistrants']).toHaveBeenCalledWith('synthetic-meeting', true, undefined, false, false);
    expect(query('meeting-details-guests-summary')?.textContent).toMatch(/Meeting Guests\s*3 guests/);
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
    expect(query('meeting-details-guests-summary')?.textContent).toContain('0 attended / 1 invited');
    expect(query('meeting-details-guests-search')?.querySelector('input')?.getAttribute('placeholder')).toBe('Search participants');
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
    expect(hosts().map((person) => person.email)).toEqual(['org@acme.example', 'bo@acme.example']);

    removedIds.set(new Set(['synthetic-meeting']));
    await fixture.whenStable();
    expect(guestCount()).toBe(2);
    expect(names()).not.toContain('Bo Kim (You)');
    expect(hosts().map((person) => person.email)).toEqual(['org@acme.example']);
  });

  it('clears the count and hosts when the list becomes hidden', async () => {
    await render();
    expect(guestCount()).toBe(3);

    canViewGuests.set(false);
    await fixture.whenStable();
    expect(guestCount()).toBeNull();
    expect(hosts()).toEqual([]);
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
    expect(closeDialog.mock.invocationCallOrder[0]).toBeLessThan(meetingService['getMeetingDetail'].mock.invocationCallOrder[0]);
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
    expect(modalOpen.mock.invocationCallOrder[0]).toBeLessThan(composerOpen.mock.invocationCallOrder[0]);
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'p-1', section: 'guests' });
  });
});
