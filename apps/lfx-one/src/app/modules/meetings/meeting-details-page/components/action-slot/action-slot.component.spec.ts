// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import {
  ActionSlotKind,
  Meeting,
  MeetingDetailsLoadStatus,
  MeetingOccurrence,
  MeetingLeaveRequest,
  MeetingPrivacyState,
  MeetingTimeState,
  MeetingViewerRole,
} from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddToCalendarComponent } from '../../../components/add-to-calendar/add-to-calendar.component';
import { PublicRegistrationModalComponent } from '../../../components/public-registration-modal/public-registration-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingGuestJoinComponent } from '../guest-join/guest-join.component';
import { MeetingJoinActionComponent } from '../join-action/join-action.component';
import { MeetingRsvpCardComponent } from '../rsvp-card/rsvp-card.component';
import { MeetingActionSlotComponent } from './action-slot.component';

// The Join control has its own spec; here it only has to be the one rendered.
@Component({ selector: 'lfx-meeting-join-action', template: '<span data-testid="join-action-stub"></span>' })
class JoinActionStubComponent {}

@Component({ selector: 'lfx-meeting-guest-join', template: '<span data-testid="guest-join-stub"></span>' })
class GuestJoinStubComponent {}

@Component({ selector: 'lfx-meeting-rsvp-card', template: '<span data-testid="rsvp-card-stub"></span>' })
class RsvpCardStubComponent {}

// V1's Add to calendar is reused unchanged and tested in its own spec; here only where it renders.
@Component({ selector: 'lfx-add-to-calendar', template: '<span data-testid="add-to-calendar-stub"></span>' })
class AddToCalendarStubComponent {
  public readonly meeting = input<Meeting>();
  public readonly currentOccurrence = input<MeetingOccurrence | null>(null);
}

const SIGN_IN_HREF = '/login?returnTo=https%3A%2F%2Fapp.example%2Fmeetings%2Fmeeting-1';
const KINDS: ActionSlotKind[] = ['join', 'rsvp', 'register', 'invitation-required', 'guest-join', 'tools', 'no-access', 'rsvp-unavailable', 'none'];

// The slot renders the state service's decision; which kind each viewer gets is the resolver's,
// tested in `meeting-view-model.utils.spec.ts`, and the inputs the service feeds it in its own spec.
describe('MeetingActionSlotComponent', () => {
  let fixture: ComponentFixture<MeetingActionSlotComponent>;
  let actionSlot: WritableSignal<ActionSlotKind | null>;
  let viewerRole: WritableSignal<MeetingViewerRole | null>;
  let privacy: WritableSignal<MeetingPrivacyState | null>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let joinsInWindow: WritableSignal<boolean>;
  let meeting: WritableSignal<Meeting | undefined>;
  let pastAccessKnown: WritableSignal<boolean>;
  let markRegistered: ReturnType<typeof vi.fn>;
  let dialogClose: Subject<{ registered: boolean } | undefined>;
  let openDialog: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let showAddToCalendar: WritableSignal<boolean>;
  let showLeaveMeeting: WritableSignal<boolean>;
  let canLeaveMeeting: WritableSignal<boolean>;
  let leaveRequest: WritableSignal<MeetingLeaveRequest | null>;
  let status: WritableSignal<MeetingDetailsLoadStatus>;
  let markLeft: ReturnType<typeof vi.fn>;
  let markLeaveIncomplete: ReturnType<typeof vi.fn>;
  let consumeLeaveRequest: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let removeMyMeetingRegistration: ReturnType<typeof vi.fn>;
  let clearConfirmedMeetingRsvps: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;

  const open: MeetingPrivacyState = { icon: '', label: 'Public', openToPublic: true, restricted: false, visibility: MeetingVisibility.PUBLIC };
  const restricted: MeetingPrivacyState = {
    icon: '',
    label: 'Private (Restricted)',
    openToPublic: false,
    restricted: true,
    visibility: MeetingVisibility.PRIVATE,
  };

  beforeEach(async () => {
    actionSlot = signal<ActionSlotKind | null>('join');
    viewerRole = signal<MeetingViewerRole | null>('registrant');
    privacy = signal<MeetingPrivacyState | null>(open);
    timeState = signal<MeetingTimeState | null>('live');
    joinsInWindow = signal(true);
    meeting = signal<Meeting | undefined>({ id: 'meeting-1', early_join_time_minutes: 15 } as Meeting);
    pastAccessKnown = signal(true);
    markRegistered = vi.fn();
    dialogClose = new Subject();
    openDialog = vi.fn().mockReturnValue({ onClose: dialogClose.asObservable(), onDestroy: dialogClose.asObservable() });
    add = vi.fn();
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    showAddToCalendar = signal(false);
    showLeaveMeeting = signal(false);
    canLeaveMeeting = signal(true);
    leaveRequest = signal<MeetingLeaveRequest | null>(null);
    status = signal<MeetingDetailsLoadStatus>('ready');
    markLeft = vi.fn();
    markLeaveIncomplete = vi.fn();
    consumeLeaveRequest = vi.fn(() => leaveRequest.set(null));
    // A real service, so `<p-confirmDialog>` can subscribe to it; only `confirm` is observed.
    const confirmationService = new ConfirmationService();
    confirm = vi.spyOn(confirmationService, 'confirm').mockImplementation(() => confirmationService) as unknown as ReturnType<typeof vi.fn>;
    removeMyMeetingRegistration = vi.fn().mockReturnValue(of({ remaining_registrant_ids: [] }));
    clearConfirmedMeetingRsvps = vi.fn();
    refreshUserMeetings = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingActionSlotComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: {
            actionSlot,
            viewerRole,
            privacy,
            timeState,
            joinsInWindow,
            meeting,
            pastAccessKnown,
            markRegistered,
            selectedOccurrence,
            showAddToCalendar,
            showLeaveMeeting,
            canLeaveMeeting,
            leaveRequest,
            status,
            leaving: signal(false),
            markLeft,
            markLeaveIncomplete,
            consumeLeaveRequest,
            signInHref: signal(SIGN_IN_HREF),
          },
        },
        {
          provide: UserService,
          useValue: {
            user: signal({ sub: 'auth0|ada', name: 'Ada Example', email: 'ada@acme-motors.example' }),
            viewerUsername: signal('ada'),
            clearConfirmedMeetingRsvps,
            refreshUserMeetings,
          },
        },
        { provide: MeetingService, useValue: { removeMyMeetingRegistration } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: MessageService, useValue: { add } },
      ],
    })
      .overrideComponent(MeetingActionSlotComponent, {
        remove: { imports: [AddToCalendarComponent, MeetingJoinActionComponent, MeetingGuestJoinComponent, MeetingRsvpCardComponent] },
        add: { imports: [AddToCalendarStubComponent, JoinActionStubComponent, GuestJoinStubComponent, RsvpCardStubComponent] },
      })
      .overrideComponent(MeetingActionSlotComponent, {
        set: {
          providers: [
            { provide: DialogService, useValue: { open: openDialog } },
            { provide: ConfirmationService, useValue: confirmationService },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingActionSlotComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => (query(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  function render(kind: ActionSlotKind, role: MeetingViewerRole = 'registrant'): void {
    actionSlot.set(kind);
    viewerRole.set(role);
    fixture.detectChanges();
  }

  // FR-020 / SC-004: one slot, always with its kind, for every kind.
  it.each(KINDS)('renders exactly one slot carrying data-kind="%s"', (kind) => {
    render(kind);

    const slots = fixture.nativeElement.querySelectorAll('[data-testid="meeting-action-slot"]');
    expect(slots.length).toBe(1);
    expect(slots[0].getAttribute('data-kind')).toBe(kind);
  });

  it.each(KINDS.filter((kind) => kind !== 'join' && kind !== 'rsvp' && kind !== 'none'))('explains the %s kind instead of leaving the rail empty', (kind) => {
    render(kind);

    expect(text('meeting-action-message')).not.toBe('');
  });

  it('renders the Join control for the join kind', () => {
    expect(query('join-action-stub')).not.toBeNull();
    expect(query('meeting-action-message')).toBeNull();
  });

  it('renders nothing inside the none kind, but still renders the slot', () => {
    joinsInWindow.set(false);
    render('none');

    const slot = query('meeting-action-slot');
    expect(slot?.getAttribute('data-kind')).toBe('none');
    expect(slot?.textContent?.trim()).toBe('');
  });

  it('renders no slot before the meeting has loaded', () => {
    actionSlot.set(null);
    fixture.detectChanges();

    expect(query('meeting-action-slot')).toBeNull();
  });

  describe('the public explainer', () => {
    it('shows under Join on a meeting anyone with the link can join', () => {
      expect(text('meeting-action-join-explainer')).toBe('Public meeting. Anyone with this link can join.');
    });

    it('is absent on a restricted meeting', () => {
      privacy.set(restricted);
      fixture.detectChanges();

      expect(query('meeting-action-join-explainer')).toBeNull();
    });

    it('is absent when the viewer cannot join', () => {
      render('register', 'outsider');

      expect(query('meeting-action-join-explainer')).toBeNull();
    });
  });

  describe('sign in', () => {
    it.each([
      ['guest-join', 'visitor'],
      ['register', 'visitor'],
      ['tools', 'visitor'],
    ] as [ActionSlotKind, MeetingViewerRole][])('offers sign-in, back to this page, for %s to a %s', (kind, role) => {
      render(kind, role);

      expect(query('meeting-action-sign-in')?.querySelector('a')?.getAttribute('href')).toBe(SIGN_IN_HREF);
    });

    it.each([
      ['register', 'outsider'],
      ['tools', 'registrant'],
    ] as [ActionSlotKind, MeetingViewerRole][])('does not offer sign-in for %s to a signed-in %s', (kind, role) => {
      render(kind, role);

      expect(query('meeting-action-sign-in')).toBeNull();
    });
  });

  it('asks a visitor to sign in for the artifacts of an ended meeting', () => {
    render('tools', 'visitor');

    expect(text('meeting-action-message')).toBe('This meeting has ended. Sign in to see its recording and summary.');
  });

  // V1's line; the recording section below says what the meeting produced.
  it("tells a signed-in viewer of an ended meeting only that it has ended, as V1's banner does", () => {
    render('tools', 'registrant');

    expect(text('meeting-action-message')).toBe('This meeting has ended.');
  });

  describe('no-access', () => {
    it('says the details are private once the past endpoint has said so', () => {
      render('no-access', 'outsider');

      expect(query('meeting-action-slot')?.textContent).toContain("This meeting's details are private");
    });

    // An upcoming load that ended on the clock was never asked about access.
    it('only says the meeting has ended when access was never asked', () => {
      pastAccessKnown.set(false);
      render('no-access', 'outsider');

      expect(text('meeting-action-message')).toBe('This meeting has ended.');
      expect(query('meeting-action-slot')?.textContent).not.toContain('private');
    });
  });

  // E2-05: the rsvp kind is its own card (tested in its spec).
  it('renders the RSVP card for the rsvp kind', () => {
    render('rsvp');

    expect(query('rsvp-card-stub')).not.toBeNull();
    expect(query('meeting-action-message')).toBeNull();
  });

  // N-01 (FR-026, SC-005): a meeting that predates RSVP tracking says so, with no RSVP control.
  it('explains a meeting without RSVP tracking, and offers nothing to answer', () => {
    render('rsvp-unavailable');

    expect(query('meeting-rsvp-unavailable-state')?.textContent).toContain("You're invited");
    expect(text('meeting-action-message')).toBe("RSVPs aren't tracked for this meeting, so there's nothing to answer.");
    // No control at all, and nothing that carries an answer.
    expect(fixture.nativeElement.querySelector('button, input')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-my-rsvp]')).toBeNull();
  });

  // The join rule is the hint's alone, so the two never disagree.
  it('leaves when to join to the early-join hint', () => {
    timeState.set('before');
    render('rsvp-unavailable');

    expect(text('meeting-action-join-hint')).toBe('You can join up to 15 minutes before the start time.');
    expect(text('meeting-action-message')).not.toContain('join');
  });

  // E2-06 (FR-025).
  it('offers an anonymous visitor in the window sign-in, or the guest form', () => {
    render('guest-join', 'visitor');

    expect(query('meeting-action-sign-in')).not.toBeNull();
    expect(query('guest-join-stub')).not.toBeNull();
  });

  // E2-02 (FR-021).
  describe('register', () => {
    beforeEach(() => {
      meeting.set({ id: 'meeting-1', title: 'Acme Weekly Sync' } as Meeting);
      render('register', 'outsider');
    });

    it('says what registering gets the viewer', () => {
      expect(text('meeting-action-message')).toBe("Register to add yourself to the guest list. You'll get the invitation and can RSVP.");
    });

    it('opens the shared registration dialog for this meeting', () => {
      query('meeting-action-register-button')?.querySelector('button')?.click();

      expect(openDialog).toHaveBeenCalledWith(
        PublicRegistrationModalComponent,
        expect.objectContaining({
          header: 'Register for Meeting',
          data: expect.objectContaining({
            meetingId: 'meeting-1',
            meetingTitle: 'Acme Weekly Sync',
            user: expect.objectContaining({ email: 'ada@acme-motors.example' }),
          }),
        })
      );
    });

    it('moves the page to the registrant state once registered', () => {
      query('meeting-action-register-button')?.querySelector('button')?.click();
      dialogClose.next({ registered: true });

      expect(markRegistered).toHaveBeenCalledWith('meeting-1');
    });

    // #3260: PrimeNG's dialog does not restore focus; the slot hands it back to Register on close.
    it('returns focus to Register once its dialog is gone', () => {
      const destroyed = new Subject<void>();
      openDialog.mockReturnValue({ onClose: dialogClose.asObservable(), onDestroy: destroyed.asObservable() });
      const register = query('meeting-action-register-button')?.querySelector('button') as HTMLButtonElement;
      register.focus();
      register.click();
      register.blur();

      destroyed.next();

      expect(document.activeElement).toBe(register);
    });

    // #3260: Register leaves the slot once registered, so focus moves to the slot's new first control.
    it.each([
      ['its new first control', 'rsvp' as ActionSlotKind],
      // RSVP tracking off: the new state is plain text, so the slot itself takes focus.
      ['the slot itself when the new state has no control', 'rsvp-unavailable' as ActionSlotKind],
    ])('moves focus to %s once registered, since Register is gone', async (_label, next) => {
      markRegistered.mockImplementation(() => actionSlot.set(next));
      query('meeting-action-register-button')?.querySelector('button')?.click();
      dialogClose.next({ registered: true });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('meeting-action-register-button')).toBeNull();
      expect(document.activeElement).not.toBe(document.body);
      expect(fixture.nativeElement.contains(document.activeElement) || document.activeElement === fixture.nativeElement).toBe(true);
    });

    it('keeps the open dialog when PrimeNG refuses a duplicate', () => {
      openDialog.mockReturnValue(null);

      expect(() => query('meeting-action-register-button')?.querySelector('button')?.click()).not.toThrow();
    });

    it('ignores a registration that completes after the slot has gone', () => {
      query('meeting-action-register-button')?.querySelector('button')?.click();
      fixture.destroy();
      dialogClose.next({ registered: true });

      expect(markRegistered).not.toHaveBeenCalled();
    });

    it('moves no focus for a registration that completes after the page moved to another meeting', async () => {
      query('meeting-action-register-button')?.querySelector('button')?.click();
      const elsewhere = document.createElement('button');
      document.body.append(elsewhere);
      elsewhere.focus();
      meeting.set({ id: 'meeting-2' } as Meeting);

      dialogClose.next({ registered: true });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('leaves the page alone when the dialog closes without registering', () => {
      query('meeting-action-register-button')?.querySelector('button')?.click();
      dialogClose.next(undefined);

      expect(markRegistered).not.toHaveBeenCalled();
    });

    it('prompts a visitor to sign in instead', () => {
      render('register', 'visitor');

      expect(query('meeting-action-register-button')).toBeNull();
      expect(query('meeting-action-sign-in')).not.toBeNull();
    });
  });

  // E2-03 (FR-022).
  describe('invitation required', () => {
    beforeEach(() => {
      meeting.set({
        id: 'meeting-1',
        title: 'Acme Weekly Sync',
        start_time: '2026-10-09T17:00:00Z',
        owner: { username: 'ada', email: 'ada@acme-motors.example', name: 'Ada Example' },
      } as Meeting);
      privacy.set(restricted);
      render('invitation-required', 'outsider');
    });

    it('says an invitation is needed, with its contract testid', () => {
      expect(query('meeting-invitation-required-state')?.textContent).toContain('Invitation required');
      expect(text('meeting-action-message')).toBe('This meeting is limited to invited guests. Ask the organizer for an invitation to join.');
    });

    it('lets the viewer email the organizer about this meeting', () => {
      const href = query('meeting-invitation-required-contact')?.querySelector('a')?.getAttribute('href') ?? '';

      expect(href.startsWith('mailto:ada@acme-motors.example?')).toBe(true);
      expect(decodeURIComponent(href)).toContain('Acme Weekly Sync');
      expect(decodeURIComponent(href)).toContain('/meetings/meeting-1');
      expect(decodeURIComponent(href)).toContain('Oct 9, 2026');
      expect(query('meeting-invitation-required-support')).toBeNull();
    });

    it("names the selected occurrence's date, not the series start", () => {
      selectedOccurrence.set({ occurrence_id: '2', start_time: '2026-10-16T17:00:00Z', duration: 60 } as MeetingOccurrence);
      fixture.detectChanges();

      const href = decodeURIComponent(query('meeting-invitation-required-contact')?.querySelector('a')?.getAttribute('href') ?? '');
      expect(href).toContain('Oct 16, 2026');
      expect(href).not.toContain('Oct 9, 2026');
    });

    it('offers the support chat when the organizer has no usable email', () => {
      meeting.set({ id: 'meeting-1', title: 'Acme Weekly Sync', owner: { username: 'ada', name: 'Ada Example' } } as Meeting);
      fixture.detectChanges();

      expect(query('meeting-invitation-required-contact')).toBeNull();
      query('meeting-invitation-required-support')?.click();
      // No Intercom app id in the test runtime config, so the directive reports support as unavailable.
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Support Unavailable' }));
    });
  });

  // The early-join rule, moved from the time banner (decided on #3297).
  describe('the early-join hint', () => {
    beforeEach(() => {
      timeState.set('before');
      render('rsvp');
    });

    it("states the meeting's own early-join minutes before the window", () => {
      expect(text('meeting-action-join-hint')).toBe('You can join up to 15 minutes before the start time.');
    });

    it('falls back to the default when the meeting sets none', () => {
      meeting.set({ id: 'meeting-1' } as Meeting);
      fixture.detectChanges();

      expect(text('meeting-action-join-hint')).toBe('You can join up to 10 minutes before the start time.');
    });

    it('is absent for a viewer who will not be able to join', () => {
      joinsInWindow.set(false);
      fixture.detectChanges();

      expect(query('meeting-action-join-hint')).toBeNull();
    });

    it('is absent once the window is open', () => {
      timeState.set('live');
      render('join');

      expect(query('meeting-action-join-hint')).toBeNull();
    });
  });
  describe('add to calendar', () => {
    it("renders V1's Add to calendar under the slot for the selected occurrence when the state service offers it", () => {
      const occurrence = { occurrence_id: 'occ-2', start_time: '2026-11-03T15:00:00Z' } as MeetingOccurrence;
      selectedOccurrence.set(occurrence);
      showAddToCalendar.set(true);
      render('rsvp');

      const calendar = fixture.debugElement.query(By.directive(AddToCalendarStubComponent));
      expect(calendar).not.toBeNull();
      expect(calendar.componentInstance.meeting()).toBe(meeting());
      expect(calendar.componentInstance.currentOccurrence()).toBe(occurrence);
    });

    it('renders no Add to calendar when the state service does not offer it', () => {
      render('rsvp');

      expect(query('add-to-calendar-stub')).toBeNull();
    });
  });

  describe('Remove Myself', () => {
    const acceptConfirmation = (): void => (confirm.mock.calls.at(-1)?.[0] as { accept: () => void }).accept();

    it("offers V1's Remove Myself when the state service allows it", () => {
      render('rsvp');
      expect(query('meeting-action-leave-button')).toBeNull();

      showLeaveMeeting.set(true);
      fixture.detectChanges();

      expect(text('meeting-action-leave-button')).toBe('Remove Myself');
    });

    it("asks V1's Remove Yourself confirmation, and removes nothing until it is accepted", () => {
      showLeaveMeeting.set(true);
      meeting.set({ id: 'meeting-1', title: 'Weekly Sync' } as Meeting);
      render('rsvp');

      query('meeting-action-leave-button')?.querySelector('button')?.click();

      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Remove Yourself', acceptLabel: 'Remove Me', rejectLabel: 'Cancel' }));
      expect(removeMyMeetingRegistration).not.toHaveBeenCalled();

      acceptConfirmation();

      expect(removeMyMeetingRegistration).toHaveBeenCalledWith('meeting-1', 'meeting-join');
    });

    it('takes the viewer off the page after a complete removal', () => {
      showLeaveMeeting.set(true);
      render('rsvp');
      query('meeting-action-leave-button')?.querySelector('button')?.click();
      acceptConfirmation();

      expect(clearConfirmedMeetingRsvps).toHaveBeenCalledWith('meeting-1', 'auth0|ada', { remaining_registrant_ids: [] });
      expect(markLeft).toHaveBeenCalledWith('meeting-1');
      expect(add).toHaveBeenCalledWith({ severity: 'success', summary: 'Removed', detail: 'You have been removed from this meeting.' });
    });

    // #3260: Remove Myself leaves the slot on success, so focus moves to the slot's new first control.
    it('hands focus to the slot once Remove Myself is gone', async () => {
      markLeft.mockImplementation(() => showLeaveMeeting.set(false));
      showLeaveMeeting.set(true);
      render('rsvp');
      const button = query('meeting-action-leave-button')?.querySelector('button') as HTMLButtonElement;
      button.focus();
      button.click();
      acceptConfirmation();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query('meeting-action-leave-button')).toBeNull();
      expect(document.activeElement).not.toBe(document.body);
      expect(fixture.nativeElement.contains(document.activeElement) || document.activeElement === fixture.nativeElement).toBe(true);
    });

    it('keeps the viewer invited, and warns, when some registrations remain', () => {
      removeMyMeetingRegistration.mockReturnValue(of({ remaining_registrant_ids: ['r-2'] }));
      showLeaveMeeting.set(true);
      render('rsvp');
      query('meeting-action-leave-button')?.querySelector('button')?.click();
      acceptConfirmation();

      expect(markLeaveIncomplete).toHaveBeenCalledWith('meeting-1');
      expect(markLeft).not.toHaveBeenCalled();
      expect(refreshUserMeetings).toHaveBeenCalledWith(false);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Removal incomplete' }));
    });

    it("reports a failed removal with V1's fallback message", () => {
      removeMyMeetingRegistration.mockReturnValue(throwError(() => new Error('boom')));
      showLeaveMeeting.set(true);
      render('rsvp');
      query('meeting-action-leave-button')?.querySelector('button')?.click();
      acceptConfirmation();

      expect(markLeft).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith({ severity: 'error', summary: 'Error', detail: 'Unable to remove you from this meeting. Please try again.' });
    });

    it('ignores a removal that completes after the page moved to another meeting', () => {
      showLeaveMeeting.set(true);
      const pending = new Subject<{ remaining_registrant_ids: string[] }>();
      removeMyMeetingRegistration.mockReturnValue(pending.asObservable());
      render('rsvp');
      query('meeting-action-leave-button')?.querySelector('button')?.click();
      acceptConfirmation();

      meeting.set({ id: 'meeting-2' } as Meeting);
      pending.next({ remaining_registrant_ids: [] });

      // The removal is still recorded for meeting-1 (session-wide; `markLeft` keeps meeting-2's page as
      // it is), but the toast and focus belong to a page that has moved on.
      expect(markLeft).toHaveBeenCalledWith('meeting-1');
      expect(markLeft).not.toHaveBeenCalledWith('meeting-2');
      expect(add).not.toHaveBeenCalled();
    });

    describe('from a ?action=leave link', () => {
      it('drops the param and asks to confirm, attributed to the email link, once the meeting is ready', async () => {
        status.set('loading');
        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: false });
        fixture.detectChanges();
        await fixture.whenStable();
        expect(confirm).not.toHaveBeenCalled();

        status.set('ready');
        fixture.detectChanges();
        await fixture.whenStable();

        expect(consumeLeaveRequest).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledTimes(1);
        acceptConfirmation();
        expect(removeMyMeetingRegistration).toHaveBeenCalledWith('meeting-1', 'email-link');
      });

      // The page outlives in-app navigations: a second link must prompt again.
      it('asks again for a later link, once the first has been handled', async () => {
        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: false });
        fixture.detectChanges();
        await fixture.whenStable();
        expect(confirm).toHaveBeenCalledTimes(1);

        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: false });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(consumeLeaveRequest).toHaveBeenCalledTimes(2);
        expect(confirm).toHaveBeenCalledTimes(2);
      });

      it('tells a viewer who is not registered so, without a confirmation', async () => {
        canLeaveMeeting.set(false);
        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: false });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(consumeLeaveRequest).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
        expect(add).toHaveBeenCalledWith({ severity: 'info', summary: 'Not registered', detail: 'You are not registered for this meeting.' });
      });

      // V1, seeded with the same meeting, showed this toast on its first render, before the swap.
      it("does not repeat V1's Not registered toast for a link V1 has handled", async () => {
        canLeaveMeeting.set(false);
        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: true });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(consumeLeaveRequest).toHaveBeenCalledTimes(1);
        expect(add).not.toHaveBeenCalled();
      });

      it('asks nothing while the page shows another meeting than the link named', async () => {
        meeting.set({ id: 'meeting-2' } as Meeting);
        leaveRequest.set({ meetingId: 'meeting-1', handledByV1: false });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(consumeLeaveRequest).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
      });
    });
  });
});
