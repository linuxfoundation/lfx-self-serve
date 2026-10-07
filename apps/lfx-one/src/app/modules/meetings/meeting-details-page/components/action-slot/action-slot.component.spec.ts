// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { ActionSlotKind, Meeting, MeetingOccurrence, MeetingPrivacyState, MeetingTimeState, MeetingViewerRole, RsvpResponse } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicRegistrationModalComponent } from '../../../components/public-registration-modal/public-registration-modal.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingGuestJoinComponent } from '../guest-join/guest-join.component';
import { MeetingJoinActionComponent } from '../join-action/join-action.component';
import { MeetingActionSlotComponent } from './action-slot.component';

// The Join control has its own spec; here it only has to be the one rendered.
@Component({ selector: 'lfx-meeting-join-action', template: '<span data-testid="join-action-stub"></span>' })
class JoinActionStubComponent {}

@Component({ selector: 'lfx-meeting-guest-join', template: '<span data-testid="guest-join-stub"></span>' })
class GuestJoinStubComponent {}

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
  let myRsvp: WritableSignal<RsvpResponse | null | undefined>;
  let myRsvpAttr: WritableSignal<string | null>;
  let markRegistered: ReturnType<typeof vi.fn>;
  let dialogClose: Subject<{ registered: boolean } | undefined>;
  let openDialog: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;

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
    myRsvp = signal<RsvpResponse | null | undefined>(undefined);
    myRsvpAttr = signal<string | null>(null);
    markRegistered = vi.fn();
    dialogClose = new Subject();
    openDialog = vi.fn().mockReturnValue({ onClose: dialogClose.asObservable() });
    add = vi.fn();
    selectedOccurrence = signal<MeetingOccurrence | null>(null);

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
            myRsvp,
            myRsvpAttr,
            markRegistered,
            selectedOccurrence,
            signInHref: signal(SIGN_IN_HREF),
          },
        },
        { provide: UserService, useValue: { user: signal({ name: 'Ada Example', email: 'ada@acme-motors.example' }) } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: MessageService, useValue: { add } },
      ],
    })
      .overrideComponent(MeetingActionSlotComponent, {
        remove: { imports: [MeetingJoinActionComponent, MeetingGuestJoinComponent] },
        add: { imports: [JoinActionStubComponent, GuestJoinStubComponent] },
      })
      .overrideComponent(MeetingActionSlotComponent, { set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] } })
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

  it.each(KINDS.filter((kind) => kind !== 'join' && kind !== 'none'))('explains the %s kind instead of leaving the rail empty', (kind) => {
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

  // E2-04 (FR-023): until E2-05's card, the rsvp kind's line names the viewer's own answer.
  it.each([
    [undefined, "You're invited to this meeting."],
    [null, "You're invited to this meeting. You haven't replied yet."],
    ['accepted', "You're going."],
    ['maybe', 'You replied maybe.'],
    ['declined', "You can't attend."],
  ] as [RsvpResponse | null | undefined, string][])('says the RSVP is %s', (answer, message) => {
    myRsvp.set(answer);
    render('rsvp');

    expect(text('meeting-action-message')).toBe(message);
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
});
