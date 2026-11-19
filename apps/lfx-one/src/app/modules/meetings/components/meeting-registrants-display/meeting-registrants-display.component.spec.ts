// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FormControl, FormGroup } from '@angular/forms';
import {
  Meeting,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRegistrantWithState,
  MeetingSelfGuest,
  PastMeeting,
  PastMeetingParticipant,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BehaviorSubject, Observable, of, Subject, take, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRegistrantsDisplayComponent } from './meeting-registrants-display.component';

const PAST_MEETING = { id: 'past-meeting-1', meeting_and_occurrence_id: 'past-meeting-1:1700000000' } as PastMeeting;

function participant(email: string): PastMeetingParticipant {
  return { uid: `participant-${email}`, email, first_name: 'Ada', last_name: 'Byron' } as PastMeetingParticipant;
}

/**
 * Covers the count a past-meeting drawer reports back to the card that opened it.
 * @description A past meeting's participant list is the only one this component self-fetches, and for
 * a while it was also the only one that never told the parent what it found — the card's drawer header
 * sat at `0 participants` over a list that was plainly showing people. The parent cannot compute the
 * number itself: `participant_count` on the row is the scheduled-registrant count, not who turned up.
 * So the emit below is the whole contract, and these tests hold both halves of it — that it fires with
 * the fetched total, and that a failed fetch stays silent rather than reporting a total of zero.
 */
describe('MeetingRegistrantsDisplayComponent — past-participant total', () => {
  let getPastMeetingParticipants: ReturnType<typeof vi.fn>;
  let emitted: number[];

  /**
   * Mounts the drawer body over a past meeting with an empty template.
   * @description The count is emitted from the fetch pipeline, not the markup, and the real template
   * mounts avatars, badges and two filter selects that have nothing to say about it.
   */
  async function mount(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            getPastMeetingParticipants,
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingRegistrantsDisplayComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', PAST_MEETING);
    fixture.componentRef.setInput('pastMeeting', true);
    fixture.componentInstance.totalCountChange.subscribe((total: number) => emitted.push(total));
    // `visible` is what arms the fetch — a drawer that was never opened must not fetch at all.
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    emitted = [];
    getPastMeetingParticipants = vi.fn().mockReturnValue(of([participant('ada@acme-motors.example'), participant('grace@acme-motors.example')]));
  });

  it('reports how many participants the fetch returned', async () => {
    await mount();

    expect(getPastMeetingParticipants).toHaveBeenCalledWith('past-meeting-1:1700000000');
    expect(emitted).toEqual([2]);
  });

  it('says nothing when the participants fetch fails', async () => {
    getPastMeetingParticipants.mockReturnValue(throwError(() => new Error('boom')));

    await mount();

    // The emit sits ahead of the `catchError` that substitutes `[]`, so a failure never reaches it.
    // That silence is load-bearing: the parent holds a `null` until it hears a number, and falls back
    // to the meeting's own count meanwhile. An emit here would overwrite that fallback with a zero and
    // state, as a fact, that nobody attended.
    expect(emitted).toEqual([]);
  });
});

describe('MeetingRegistrantsDisplayComponent — open add form on show', () => {
  async function mount(openAddFormOnShow: boolean) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            getPastMeetingParticipants: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingRegistrantsDisplayComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', { id: 'meeting-1' });
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.componentRef.setInput('showAddRegistrant', true);
    fixture.componentRef.setInput('openAddFormOnShow', openAddFormOnShow);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const showAddForm = (fixture: Awaited<ReturnType<typeof mount>>): boolean => fixture.componentInstance.showAddForm();

  it('opens the add form once the drawer becomes visible', async () => {
    const fixture = await mount(true);
    expect(showAddForm(fixture)).toBe(false);

    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();

    expect(showAddForm(fixture)).toBe(true);
  });

  it('leaves the add form closed when not asked to open it', async () => {
    const fixture = await mount(false);

    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();

    expect(showAddForm(fixture)).toBe(false);
  });
});

const RECURRING_MEETING = { id: 'meeting-1', timezone: 'UTC', recurrence: { type: 2, repeat_interval: 1 } } as unknown as Meeting;
const OCCURRENCE = { occurrence_id: '1893492000', start_time: '2030-01-01T10:00:00.000Z', duration: 30 } as MeetingOccurrence;
const GUEST = { meeting_id: 'meeting-1', email: 'ada@acme-motors.example', first_name: 'Ada', last_name: 'Byron', host: false };

/**
 * Covers which dates a guest added from the drawer is invited to.
 * @description Upstream reads a blank `occurrence` as "every occurrence", so the default must send
 * none, and "this date only" must send the occurrence the host is showing. A one-off meeting has no
 * dates to choose between, so it never offers the choice.
 */
describe('MeetingRegistrantsDisplayComponent — guest invite scope', () => {
  let addMeetingRegistrants: ReturnType<typeof vi.fn>;

  async function mount(meeting: Meeting, occurrence: MeetingOccurrence | null): Promise<MeetingRegistrantsDisplayComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () =>
              new FormGroup({ email: new FormControl(GUEST.email), first_name: new FormControl('Ada'), last_name: new FormControl('Byron') }),
            stripMetadata: () => ({ ...GUEST }),
            addMeetingRegistrants,
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingRegistrantsDisplayComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', meeting);
    fixture.componentRef.setInput('occurrence', occurrence);
    // A parent-supplied list keeps the drawer from self-fetching; the add path is the same either way.
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    addMeetingRegistrants = vi.fn().mockReturnValue(of({ summary: { successful: 1, failed: 0, total: 1 }, successes: [], failures: [] }));
  });

  it('invites to every occurrence by default', async () => {
    const component = await mount(RECURRING_MEETING, OCCURRENCE);

    component.onAddRegistrant();

    expect(addMeetingRegistrants).toHaveBeenCalledWith('meeting-1', [GUEST]);
  });

  it('invites to the shown occurrence only when that is chosen', async () => {
    const component = await mount(RECURRING_MEETING, OCCURRENCE);

    component.inviteScopeForm.setValue({ scope: 'occurrence' });
    component.onAddRegistrant();

    expect(addMeetingRegistrants).toHaveBeenCalledWith('meeting-1', [{ ...GUEST, occurrence_id: '1893492000' }]);
  });

  it('offers no choice for a one-off meeting', async () => {
    const component = await mount({ ...RECURRING_MEETING, recurrence: null } as Meeting, OCCURRENCE);

    expect(component.scopeOccurrence()).toBeNull();
  });

  it('offers no choice when the host shows no specific occurrence', async () => {
    const component = await mount(RECURRING_MEETING, null);

    expect(component.scopeOccurrence()).toBeNull();
  });
});

/**
 * Covers the organizer filter and the collapsible sections of the guests drawer.
 * @description The organizer filter keeps only host-flagged people, on both the upcoming list
 * (parent-supplied registrants) and the past list (self-fetched participants). The member and guest
 * sections collapse independently so a long member list doesn't bury the guests below it.
 */
describe('MeetingRegistrantsDisplayComponent — organizer filter and collapsible sections', () => {
  const registrant = (uid: string, host: boolean, type = 'direct') =>
    ({ uid, meeting_id: 'meeting-1', email: `${uid}@acme-motors.example`, first_name: uid, last_name: 'Tester', host, type }) as unknown as MeetingRegistrant;

  async function mount(options: { past?: boolean; registrants?: MeetingRegistrant[]; participants?: PastMeetingParticipant[]; organizers?: string[] }) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            getPastMeetingParticipants: vi.fn().mockReturnValue(of(options.participants ?? [])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingRegistrantsDisplayComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    const meeting = options.past ? PAST_MEETING : { id: 'meeting-1' };
    fixture.componentRef.setInput('meeting', { ...meeting, organizers: options.organizers ?? [] });
    fixture.componentRef.setInput('pastMeeting', !!options.past);
    if (!options.past) {
      fixture.componentRef.setInput('initialRegistrants', options.registrants ?? []);
    }
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  // An organizer is a host already, so the role filter treats the two as separate groups: `organizer` is the
  // meeting's listed organizers, and `host` is host-flagged guests who are not one of them.
  const ORGANIZER_EMAIL = 'ada@acme-motors.example';

  it('lists everyone while the role filter is on "all"', async () => {
    const component = await mount({ registrants: [registrant('ada', true), registrant('grace', false)], organizers: [ORGANIZER_EMAIL] });

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['ada', 'grace']);
  });

  it('keeps only listed organizers when the role filter is Organizers', async () => {
    const component = await mount({
      registrants: [registrant('ada', true), registrant('grace', true), registrant('linus', false)],
      organizers: [ORGANIZER_EMAIL],
    });

    component.organizerFilterControl.setValue('organizer');

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['ada']);
  });

  it('keeps only hosts who are not organizers when the role filter is Hosts', async () => {
    const component = await mount({
      registrants: [registrant('ada', true), registrant('grace', true), registrant('linus', false)],
      organizers: [ORGANIZER_EMAIL],
    });

    component.organizerFilterControl.setValue('host');

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['grace']);
  });

  it('matches an organizer by username as well as email, ignoring case', async () => {
    const named = { ...registrant('ada', false), username: 'Ada-Tester' } as MeetingRegistrant;
    const component = await mount({ registrants: [named, registrant('grace', false)], organizers: ['ada-tester'] });

    component.organizerFilterControl.setValue('organizer');

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['ada']);
  });

  it('labels a listed organizer as an organizer even when their host flag is off', async () => {
    const component = await mount({
      registrants: [registrant('ada', false), registrant('grace', true), registrant('linus', false)],
      organizers: [ORGANIZER_EMAIL],
    });

    const roles = component['guestRoles']();

    expect(roles.get('ada')).toBe('organizer');
    expect(roles.get('grace')).toBe('host');
    expect(roles.get('linus')).toBeNull();
  });

  it('applies the role filter to both the member and guest sections', async () => {
    const component = await mount({
      registrants: [registrant('ada', true, 'committee'), registrant('grace', false, 'committee'), registrant('linus', true), registrant('ken', false)],
      organizers: [ORGANIZER_EMAIL],
    });

    component.organizerFilterControl.setValue('organizer');
    expect(component.committeeFilteredRegistrants().map((r) => r.uid)).toEqual(['ada']);
    expect(component.directFilteredRegistrants().map((r) => r.uid)).toEqual([]);

    component.organizerFilterControl.setValue('host');
    expect(component.committeeFilteredRegistrants().map((r) => r.uid)).toEqual([]);
    expect(component.directFilteredRegistrants().map((r) => r.uid)).toEqual(['linus']);
  });

  it('splits organizers from hosts among past participants', async () => {
    const participants = [
      { ...participant('ada@acme-motors.example'), host: true },
      { ...participant('grace@acme-motors.example'), host: true },
      { ...participant('linus@acme-motors.example'), host: false },
    ] as PastMeetingParticipant[];
    const component = await mount({ past: true, participants, organizers: [ORGANIZER_EMAIL] });

    expect(component.filteredPastParticipants()).toHaveLength(3);

    component.organizerFilterControl.setValue('organizer');
    expect(component.filteredPastParticipants().map((p) => p.email)).toEqual(['ada@acme-motors.example']);

    component.organizerFilterControl.setValue('host');
    expect(component.filteredPastParticipants().map((p) => p.email)).toEqual(['grace@acme-motors.example']);
  });

  it('starts with both sections expanded and collapses each independently', async () => {
    const component = await mount({});

    expect(component.membersCollapsed()).toBe(false);
    expect(component.guestsCollapsed()).toBe(false);

    component.toggleMembersCollapsed();
    expect(component.membersCollapsed()).toBe(true);
    expect(component.guestsCollapsed()).toBe(false);

    component.toggleGuestsCollapsed();
    expect(component.guestsCollapsed()).toBe(true);

    component.toggleMembersCollapsed();
    expect(component.membersCollapsed()).toBe(false);
    expect(component.guestsCollapsed()).toBe(true);
  });
});

describe('MeetingRegistrantsDisplayComponent — meeting host toggle', () => {
  const registrant = (uid: string, host: boolean) =>
    ({
      uid,
      meeting_id: 'meeting-1',
      email: `${uid}@acme-motors.example`,
      first_name: uid,
      last_name: 'Tester',
      host,
      type: 'direct',
    }) as unknown as MeetingRegistrant;

  const success = { summary: { successful: 1, failed: 0 }, successes: [], failures: [] };

  async function mount(updateMeetingRegistrants: ReturnType<typeof vi.fn>, registrants: MeetingRegistrant[]) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            // The real builder, so these tests see the body that is actually sent.
            getChangedFields: (guest: MeetingRegistrantWithState) => MeetingService.prototype.getChangedFields.call({}, guest),
            updateMeetingRegistrants,
          },
        },
      ],
    });
    TestBed.overrideComponent(MeetingRegistrantsDisplayComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', { id: 'meeting-1' });
    fixture.componentRef.setInput('initialRegistrants', registrants);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('sends the new host flag for just that guest', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    const component = await mount(update, [registrant('guest-a', false), registrant('guest-b', false)]);

    component.onToggleHost(registrant('guest-b', false));

    expect(update).toHaveBeenCalledTimes(1);
    const [meetingId, updates] = update.mock.calls[0];
    expect(meetingId).toBe('meeting-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].uid).toBe('guest-b');
    expect(updates[0].changes).toMatchObject({ meeting_id: 'meeting-1', email: 'guest-b@acme-motors.example', first_name: 'guest-b', host: true });
  });

  it('sends an occurrence-scoped guest back with the scope it already has', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    // The query-service index spells the scope `occurrence` and never `occurrence_id`.
    const scoped = { ...registrant('guest-a', false), occurrence: '1700000000' } as unknown as MeetingRegistrant;
    const component = await mount(update, [scoped]);

    component.onToggleHost(scoped);

    expect(update.mock.calls[0][1][0].changes.occurrence_id).toBe('1700000000');
  });

  it('names the host toggle after the email when the guest has no name', async () => {
    const nameless = { ...registrant('guest-a', false), first_name: '', last_name: '' } as MeetingRegistrant;
    const namelessHost = { ...registrant('guest-b', true), first_name: '', last_name: '' } as MeetingRegistrant;
    const component = await mount(vi.fn(), [nameless, namelessHost, registrant('guest-c', false)]);

    const labels = component['hostToggleLabels']();

    expect(labels.get('guest-a')).toBe('Make guest-a@acme-motors.example a meeting host');
    expect(labels.get('guest-b')).toBe('Remove guest-b@acme-motors.example as meeting host');
    expect(labels.get('guest-c')).toBe('Make guest-c Tester a meeting host');
  });

  it('shows the change at once and lists hosts first', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    const component = await mount(update, [registrant('guest-a', false), registrant('guest-b', false)]);

    component.onToggleHost(registrant('guest-b', false));

    expect(component.registrants().map((r) => [r.uid, r.host])).toEqual([
      ['guest-b', true],
      ['guest-a', false],
    ]);
  });

  it('asks the owner of the list to reload after a successful change', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    const component = await mount(update, [registrant('guest-a', false)]);
    const reload = vi.fn();
    component.refreshRequested.subscribe(reload);

    component.onToggleHost(registrant('guest-a', false));

    expect(reload).toHaveBeenCalledWith(0);
  });

  it('does not ask for a reload when the update fails', async () => {
    const update = vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 1 }, successes: [], failures: [] }));
    const component = await mount(update, [registrant('guest-a', false)]);
    const reload = vi.fn();
    component.refreshRequested.subscribe(reload);

    component.onToggleHost(registrant('guest-a', false));

    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the list alone when the update fails', async () => {
    const update = vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 1 }, successes: [], failures: [{ error: { message: 'nope' } }] }));
    const component = await mount(update, [registrant('guest-a', false)]);

    component.onToggleHost(registrant('guest-a', false));

    expect(component.registrants()[0].host).toBe(false);
  });

  it('leaves the list alone when the request errors', async () => {
    const update = vi.fn().mockReturnValue(throwError(() => new Error('network')));
    const component = await mount(update, [registrant('guest-a', false)]);

    component.onToggleHost(registrant('guest-a', false));

    expect(component.registrants()[0].host).toBe(false);
  });

  it('ignores a guest the server has not confirmed yet', async () => {
    const update = vi.fn();
    const component = await mount(update, []);

    component.onToggleHost(registrant('optimistic-1', false));

    expect(update).not.toHaveBeenCalled();
  });
});

describe('MeetingRegistrantsDisplayComponent — guest rows on mobile (#4864)', () => {
  const registrant = (overrides: Partial<MeetingRegistrant>): MeetingRegistrant =>
    ({
      uid: 'r-1',
      email: 'secret@acme-motors.example',
      first_name: 'Ada',
      last_name: 'Byron',
      type: 'direct',
      invite_accepted: null,
      rsvp: null,
      ...overrides,
    }) as MeetingRegistrant;

  async function mount(registrants: MeetingRegistrant[]) {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({}),
            getPastMeetingParticipants: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', { id: 'meeting-1', is_invite_responses_enabled: true });
    fixture.componentRef.setInput('initialRegistrants', registrants);
    fixture.componentRef.setInput('showAddRegistrant', true);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const text = (fixture: Awaited<ReturnType<typeof mount>>, testId: string): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${testId}"]`)).map((el) => (el.textContent ?? '').trim());

  it('shows a non-empty name for a registrant with no first or last name, without revealing their email', async () => {
    const fixture = await mount([registrant({ uid: 'blank', first_name: '', last_name: '' })]);

    expect(text(fixture, 'registrant-display-name')).toEqual(['Guest']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('secret@acme-motors.example');
  });

  it('labels an invite decline differently from an RSVP decline', async () => {
    const fixture = await mount([
      registrant({ uid: 'invite', invite_accepted: false }),
      registrant({ uid: 'rsvp', invite_accepted: null, rsvp: { response_type: 'declined' } as MeetingRegistrant['rsvp'] }),
    ]);

    expect(text(fixture, 'registrant-status-label').sort()).toEqual(['Declined', 'Invite declined']);
  });

  it('offers the overflow menu the same actions as the desktop buttons', async () => {
    const fixture = await mount([registrant({ uid: 'r-1' })]);
    const component = fixture.componentInstance as unknown as {
      buildRowActionMenuItems: (r: MeetingRegistrant) => { label: string }[];
    };

    const desktopButtons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid^="registrant-display-resend-"], [data-testid^="registrant-display-host-toggle-"], [data-testid^="registrant-display-remove-"]'
    );
    const menuLabels = component.buildRowActionMenuItems(registrant({ uid: 'r-1' })).map((item) => item.label);

    expect(desktopButtons.length).toBe(3);
    expect(menuLabels).toEqual(['Resend invite', 'Make host', 'Remove']);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="registrant-display-actions-r-1"]')).not.toBeNull();
  });
});

/**
 * "Add myself" (#5798) in the guests drawer of a meeting card or the join page.
 * @description The drawer saves each guest straight away, so the button sends the create call itself:
 * as a non-host guest carrying the user's LFID and avatar, to the dates the "Invite to" choice names.
 * It is offered only once the list has loaded and while the user is not on it under a known email or
 * their LFID, and the identity lookup waits until the drawer is open, so a page of closed card drawers
 * makes no calls.
 */
describe('MeetingRegistrantsDisplayComponent — add myself', () => {
  const SELF_GUEST: MeetingSelfGuest = {
    email: 'pat.doe@acme-motors.example',
    first_name: 'Pat',
    last_name: 'Doe',
    job_title: 'Engineer',
    org_name: 'Acme Motors',
    username: 'pdoe',
    avatar_url: 'https://avatars.acme-motors.example/pdoe.png',
    matchEmails: ['pat.doe@acme-motors.example', 'pat@vendor-corp.example'],
  };
  const SUCCESS = { summary: { successful: 1, failed: 0, total: 1 }, successes: [], failures: [] };

  let getMeetingSelfGuest: ReturnType<typeof vi.fn>;
  let addMeetingRegistrants: ReturnType<typeof vi.fn>;
  let refreshRequested: ReturnType<typeof vi.fn<(count: number) => void>>;
  let removedMeetingIds: ReturnType<typeof signal<ReadonlySet<string>>>;

  const listed = (email: string): MeetingRegistrant =>
    ({ uid: `reg-${email}`, email, first_name: 'Listed', last_name: 'Guest', type: 'direct', invite_accepted: null }) as MeetingRegistrant;

  async function mount(
    options: {
      registrants?: MeetingRegistrant[];
      meeting?: Meeting;
      occurrence?: MeetingOccurrence | null;
      visible?: boolean;
      /** The drawer's own fetch, as on a meeting card, instead of a parent-supplied list. */
      fetched?: Observable<MeetingRegistrant[]>;
    } = {}
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UserService, useValue: { getMeetingSelfGuest } },
        { provide: CommitteeService, useValue: { getCommitteeMembers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: MeetingService,
          useValue: {
            removedRegistrationMeetingIds: removedMeetingIds,
            clearRemovedRegistration: vi.fn((id: string) => removedMeetingIds.update((ids) => new Set([...ids].filter((saved) => saved !== id)))),
            createRegistrantFormGroup: () => new FormGroup({}),
            // The real builder, so these tests see the body that is actually sent.
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => MeetingService.prototype.stripMetadata.call({}, meetingUid, guest),
            addMeetingRegistrants,
            deleteMeetingRegistrants: vi.fn().mockReturnValue(of({ ...SUCCESS, successes: ['saved-self'] })),
            getMeetingRegistrants: vi.fn().mockReturnValue(options.fetched ?? of([])),
            getMyMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRegistrantsDisplayComponent);
    fixture.componentRef.setInput('meeting', options.meeting ?? ({ id: 'meeting-1', timezone: 'UTC' } as Meeting));
    fixture.componentRef.setInput('occurrence', options.occurrence ?? null);
    // A parent-supplied list, as on the join page, unless the test has the drawer fetch its own.
    if (!options.fetched) {
      fixture.componentRef.setInput('initialRegistrants', options.registrants ?? []);
    }
    fixture.componentRef.setInput('showAddRegistrant', true);
    fixture.componentRef.setInput('visible', options.visible ?? true);
    fixture.componentInstance.refreshRequested.subscribe(refreshRequested);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="registrant-display-add-self"]');
    return { fixture, button };
  }

  beforeEach(() => {
    getMeetingSelfGuest = vi.fn().mockReturnValue(new BehaviorSubject<MeetingSelfGuest | null>(SELF_GUEST));
    addMeetingRegistrants = vi.fn().mockReturnValue(of(SUCCESS));
    refreshRequested = vi.fn<(count: number) => void>();
    removedMeetingIds = signal<ReadonlySet<string>>(new Set());
  });

  it('looks the user up only once the drawer opens', async () => {
    const { fixture, button } = await mount({ visible: false });
    expect(getMeetingSelfGuest).not.toHaveBeenCalled();

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getMeetingSelfGuest).toHaveBeenCalledTimes(1);
    expect(button()).not.toBeNull();
  });

  it('is hidden when the user is already listed under another of their emails', async () => {
    const { button } = await mount({ registrants: [listed('Pat@Vendor-Corp.example')] });

    expect(button()).toBeNull();
  });

  it('is hidden when the user is listed under another address with their LFID', async () => {
    const { button } = await mount({ registrants: [{ ...listed('work@acme-motors.example'), username: 'PDoe' }] });

    expect(button()).toBeNull();
  });

  it('is offered once the drawer fetch loads without the user', async () => {
    const { button } = await mount({ fetched: of([listed('someone@acme-motors.example')]) });

    expect(button()).not.toBeNull();
    expect(TestBed.inject(MeetingService).getMeetingRegistrants).toHaveBeenCalledWith('meeting-1', false, undefined, true, undefined, true, false);
  });

  it('is hidden when the drawer fetch failed, since the list may be incomplete', async () => {
    const { button } = await mount({ fetched: throwError(() => new Error('upstream down')) });

    expect(button()).toBeNull();
  });

  it('hides the action after a parent-supplied roster fails, then restores it after recovery', async () => {
    const { fixture, button } = await mount();
    expect(button()).not.toBeNull();

    fixture.componentRef.setInput('initialRegistrantsFailed', true);
    fixture.detectChanges();
    expect(button()).toBeNull();

    fixture.componentInstance.onAddSelf();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();

    fixture.componentRef.setInput('initialRegistrantsFailed', false);
    fixture.detectChanges();
    expect(button()).not.toBeNull();
  });

  it('is hidden when the profile lacks a last name, since the add needs both names', async () => {
    getMeetingSelfGuest.mockReturnValue(of({ ...SELF_GUEST, last_name: '' }));
    const { button } = await mount();

    expect(button()).toBeNull();
  });

  it('is hidden while the host shows the user as a guest, even before the roster lists them', async () => {
    const { fixture, button } = await mount({ registrants: [listed('someone@acme-motors.example')] });
    expect(button()).not.toBeNull();

    fixture.componentRef.setInput('selfInvited', true);
    fixture.detectChanges();
    expect(button()).toBeNull();

    fixture.componentInstance.onAddSelf();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();

    fixture.componentRef.setInput('selfInvited', false);
    fixture.detectChanges();
    expect(button()).not.toBeNull();
  });

  it('blocks self-add while the card invite is pending and restores it after failure', async () => {
    const { fixture, button } = await mount();
    fixture.componentRef.setInput('selfInvitePending', true);
    fixture.detectChanges();
    expect(button()).toBeNull();
    fixture.componentInstance.onAddSelf();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    fixture.componentRef.setInput('selfInvitePending', false);
    fixture.detectChanges();
    expect(button()).not.toBeNull();
  });

  it('merges a card-saved row, preserves its count through stale loads, and deduplicates indexed UIDs', async () => {
    const roster$ = new BehaviorSubject<MeetingRegistrant[]>([listed('one@example.com'), listed('two@example.com'), listed('three@example.com')]);
    const { fixture } = await mount({ fetched: roster$.pipe(take(1)), meeting: { id: 'meeting-1', timezone: 'UTC', registrant_count: 3 } as Meeting });
    const saved = { ...listed(SELF_GUEST.email), uid: 'saved-self', meeting_id: 'meeting-1' };
    const total = vi.fn();
    const delta = vi.fn();
    fixture.componentInstance.totalCountChange.subscribe(total);
    fixture.componentInstance.registrantsCountChange.subscribe(delta);
    const rowsChanged = vi.fn();
    fixture.componentInstance.registrantsChange.subscribe(rowsChanged);
    fixture.componentRef.setInput('confirmedRegistrants', [saved]);
    fixture.componentRef.setInput('confirmedCountAdjustment', 1);
    fixture.componentRef.setInput('selfInvited', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(4);
    expect(total).toHaveBeenLastCalledWith(4);
    expect(delta).toHaveBeenLastCalledWith(0);
    expect(rowsChanged).toHaveBeenLastCalledWith(expect.arrayContaining([saved]));

    roster$.next([...roster$.value, saved]);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants().filter((row) => row.uid === saved.uid)).toHaveLength(1);
    expect(total).toHaveBeenLastCalledWith(4);

    const extra = { ...listed('extra@example.com'), uid: 'saved-extra', meeting_id: 'meeting-1' };
    addMeetingRegistrants.mockReturnValueOnce(of({ ...SUCCESS, successes: [extra] }));
    const form = fixture.componentInstance.addRegistrantForm;
    form.addControl('email', new FormControl(extra.email));
    form.addControl('first_name', new FormControl('Extra'));
    form.addControl('last_name', new FormControl('Guest'));
    fixture.componentInstance.onAddRegistrant();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(total).toHaveBeenLastCalledWith(5);
    expect(delta).toHaveBeenLastCalledWith(1);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    fixture.componentInstance.onRequestRemoveGuest(extra);
    confirm.mock.calls[0][0].accept?.();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(total).toHaveBeenLastCalledWith(4);
    expect(delta).toHaveBeenLastCalledWith(0);

    fixture.componentRef.setInput('confirmedRegistrants', []);
    fixture.componentRef.setInput('confirmedRemovedRegistrantIds', ['saved-self']);
    fixture.componentRef.setInput('confirmedCountAdjustment', 0);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(3);
    expect(total).toHaveBeenLastCalledWith(3);
    expect(delta).toHaveBeenLastCalledWith(0);
    expect(rowsChanged.mock.lastCall?.[0]).toHaveLength(3);
    expect(rowsChanged.mock.lastCall?.[0].map((row: MeetingRegistrant) => row.uid)).not.toContain('saved-self');
  });

  it.each([false, true])('uses the refreshed roster as the baseline without count fields, with a card-saved guest: %s', async (cardSaved) => {
    const original = [listed('one@example.com'), listed('two@example.com'), listed('three@example.com')];
    const saved = { ...listed(SELF_GUEST.email), uid: 'saved-self', meeting_id: 'meeting-1' };
    const extra = { ...listed('extra@example.com'), uid: 'saved-extra', meeting_id: 'meeting-1' };
    const { fixture } = await mount({ fetched: of(original) });
    const total = vi.fn();
    const delta = vi.fn();
    fixture.componentInstance.totalCountChange.subscribe(total);
    fixture.componentInstance.registrantsCountChange.subscribe(delta);
    if (cardSaved) {
      fixture.componentRef.setInput('confirmedRegistrants', [saved]);
      fixture.componentRef.setInput('confirmedCountAdjustment', 1);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(total).toHaveBeenLastCalledWith(4);
    }

    const indexed = cardSaved ? [...original, saved] : original;
    const getRoster = vi.mocked(TestBed.inject(MeetingService).getMeetingRegistrants);
    getRoster.mockReturnValueOnce(of([...indexed, extra]));
    addMeetingRegistrants.mockReturnValueOnce(of({ ...SUCCESS, successes: [extra] }));
    const form = fixture.componentInstance.addRegistrantForm;
    form.addControl('email', new FormControl(extra.email));
    form.addControl('first_name', new FormControl('Extra'));
    form.addControl('last_name', new FormControl('Guest'));
    fixture.componentInstance.onAddRegistrant();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(indexed.length + 1);
    expect(total).toHaveBeenLastCalledWith(indexed.length + 1);
    expect(delta).toHaveBeenLastCalledWith(cardSaved ? -1 : 0);

    getRoster.mockReturnValueOnce(of(indexed));
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    fixture.componentInstance.onRequestRemoveGuest(extra);
    confirm.mock.calls[0][0].accept?.();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(indexed.length);
    expect(total).toHaveBeenLastCalledWith(indexed.length);
    expect(delta).toHaveBeenLastCalledWith(cardSaved ? -1 : 0);
  });

  it.each([false, true])('preserves a card-confirmed deletion with a stale roster: %s', async (stale) => {
    const removed = listed('removed@example.com');
    const remaining = [listed('one@example.com'), listed('two@example.com')];
    const { fixture } = await mount({
      fetched: of(stale ? [...remaining, removed] : remaining),
      meeting: { id: 'meeting-1', timezone: 'UTC', registrant_count: 3 } as Meeting,
    });
    const total = vi.fn();
    const delta = vi.fn();
    fixture.componentInstance.totalCountChange.subscribe(total);
    fixture.componentInstance.registrantsCountChange.subscribe(delta);
    fixture.componentRef.setInput('confirmedCountAdjustment', -1);
    fixture.componentRef.setInput('confirmedRemovedRegistrantIds', [removed.uid]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual(expect.arrayContaining(remaining));
    expect(fixture.componentInstance.registrants()).toHaveLength(2);
    expect(total).toHaveBeenLastCalledWith(2);
    expect(delta).toHaveBeenLastCalledWith(0);
  });

  it.each([
    { uid: '', fetched: false },
    { uid: '', fetched: true },
    { uid: 'optimistic-rejoin', fetched: false },
    { uid: 'optimistic-rejoin', fetched: true },
  ])('keeps a re-invitation while a known deleted row remains indexed: %j', async ({ uid, fetched }) => {
    const old = { ...listed(SELF_GUEST.email), uid: 'deleted-self' };
    const rejoined = { ...old, uid };
    const indexed = { ...old, uid: 'new-self' };
    const options = fetched ? { fetched: of([old]) } : { registrants: [old] };
    const { fixture } = await mount(options);
    fixture.componentRef.setInput('confirmedRemovedRegistrantIds', ['deleted-self']);
    fixture.componentRef.setInput('confirmedRegistrants', [rejoined]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([rejoined]);

    const refresh = async (rows: MeetingRegistrant[]): Promise<void> => {
      if (fetched) {
        vi.mocked(TestBed.inject(MeetingService).getMeetingRegistrants).mockReturnValueOnce(of(rows));
        fixture.componentRef.setInput('visible', false);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.componentRef.setInput('visible', true);
      } else fixture.componentRef.setInput('initialRegistrants', rows);
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await refresh([old, indexed]);
    expect(fixture.componentInstance.registrants()).toEqual([indexed]);
    await refresh([old]);
    expect(fixture.componentInstance.registrants()).toEqual([]);
  });

  it.each(['saved-self', '', 'optimistic-self'])('does not resurrect a parent-saved row after indexing acknowledges it then drops it: %j', async (uid) => {
    const saved = { ...listed(SELF_GUEST.email), uid };
    const { fixture } = await mount();
    fixture.componentRef.setInput('confirmedRegistrants', [saved]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([saved]);
    fixture.componentRef.setInput('initialRegistrants', [{ ...saved, uid: 'saved-self', email: saved.email.toUpperCase() }]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants().map((row) => row.uid)).toEqual(['saved-self']);
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([]);
    const nextWrite = { ...saved };
    fixture.componentRef.setInput('confirmedRegistrants', [nextWrite]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual(uid && !uid.startsWith('optimistic-') ? [] : [nextWrite]);
  });

  it('retires only the acknowledged invitation scope when fallback UIDs are empty', async () => {
    const allDates = { ...listed(SELF_GUEST.email), uid: '', occurrence_id: null };
    const singleDate = { ...allDates, occurrence_id: '4071031200' };
    const indexed = { ...allDates, uid: 'indexed-self' };
    const { fixture } = await mount();
    fixture.componentRef.setInput('confirmedRegistrants', [allDates, singleDate]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(2);
    fixture.componentRef.setInput('initialRegistrants', [indexed]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual(expect.arrayContaining([indexed, singleDate]));
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([singleDate]);
  });

  it('is hidden when the drawer cannot add guests', async () => {
    const { fixture, button } = await mount();
    fixture.componentRef.setInput('showAddRegistrant', false);
    fixture.detectChanges();

    expect(button()).toBeNull();
  });

  it('saves the user as a non-host guest with their LFID and avatar, to every occurrence by default', async () => {
    const { fixture, button } = await mount();

    button()?.querySelector('button')?.click();
    fixture.detectChanges();

    expect(addMeetingRegistrants).toHaveBeenCalledWith('meeting-1', [
      {
        meeting_id: 'meeting-1',
        email: 'pat.doe@acme-motors.example',
        first_name: 'Pat',
        last_name: 'Doe',
        host: false,
        job_title: 'Engineer',
        org_name: 'Acme Motors',
        username: 'pdoe',
        avatar_url: 'https://avatars.acme-motors.example/pdoe.png',
      },
    ]);
    expect(refreshRequested).toHaveBeenCalledWith(1);
  });

  it('invites to the shown occurrence only when that is chosen', async () => {
    const { fixture } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });

    fixture.componentInstance.inviteScopeForm.setValue({ scope: 'occurrence' });
    fixture.componentInstance.onAddSelf();

    expect(addMeetingRegistrants.mock.calls[0][1][0]).toMatchObject({ occurrence_id: '1893492000' });
  });

  it('disappears once added, before the parent list reloads, and leaves the add form alone', async () => {
    const { fixture, button } = await mount();
    const form = fixture.componentInstance.addRegistrantForm;
    const reset = vi.spyOn(form, 'reset');

    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(button()).toBeNull();
    expect(reset).not.toHaveBeenCalled();
  });

  it('retains the successful self-add across close/reopen while the parent roster is stale', async () => {
    const { fixture, button } = await mount();
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(button()).toBeNull();
    fixture.componentInstance.onAddSelf();
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  it('does not carry a successful add into another meeting', async () => {
    const { fixture, button } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    expect(button()).toBeNull();

    fixture.componentRef.setInput('meeting', { ...RECURRING_MEETING, id: 'meeting-2' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
  });

  it.each(['all', 'occurrence'])('retains a successful %s invite across date switches without changing its scope', async (scope) => {
    const { fixture, button } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    fixture.componentInstance.inviteScopeForm.setValue({ scope });
    fixture.componentInstance.onAddSelf();
    fixture.componentRef.setInput('occurrence', { ...OCCURRENCE, occurrence_id: '1894096800' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.registrants()).toHaveLength(1);
    expect(fixture.componentInstance.registrants()[0]).toMatchObject({
      email: SELF_GUEST.email,
      occurrence_id: scope === 'occurrence' ? '1893492000' : null,
    });
    expect(button()).toBeNull();
    fixture.componentInstance.onAddSelf();
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  it.each(['all', 'occurrence'])('accepts a late %s invite success after changing the displayed date', async (scope) => {
    const response = new Subject<typeof SUCCESS>();
    addMeetingRegistrants.mockReturnValue(response);
    const { fixture, button } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    fixture.componentInstance.inviteScopeForm.setValue({ scope });
    fixture.componentInstance.onAddSelf();
    fixture.componentRef.setInput('occurrence', { ...OCCURRENCE, occurrence_id: '1894096800' });
    fixture.detectChanges();
    await fixture.whenStable();
    response.next(SUCCESS);
    fixture.detectChanges();

    expect(selfAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        email: SELF_GUEST.email,
        occurrence_id: scope === 'occurrence' ? '1893492000' : null,
      })
    );
    expect(refreshRequested).toHaveBeenCalledWith(1);
    expect(button()).toBeNull();
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('retires the retained self-row after Remove Myself and permits a fresh invite, previously indexed: %s', async (indexed) => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'saved-self' }] }));
    const { fixture, button } = await mount();
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    const oldRow = fixture.componentInstance.registrants()[0];
    if (indexed) fixture.componentRef.setInput('initialRegistrants', [oldRow]);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    await fixture.whenStable();

    removedMeetingIds.set(new Set(['meeting-1']));
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
    removedMeetingIds.set(new Set());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([]);

    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'reinvited-self' }] }));
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.registrants().map((row) => row.uid)).toEqual(['reinvited-self']);
    expect(button()).toBeNull();
  });

  it('retires an optimistic row once its UID is indexed instead of resurrecting it after a later removal', async () => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'saved-self' }] }));
    const { fixture, button } = await mount();
    fixture.componentInstance.onAddSelf();
    const saved = fixture.componentInstance.registrants()[0];
    fixture.componentRef.setInput('initialRegistrants', [saved]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
  });

  it('filters a stale indexed self-row after Remove Myself and does not restore it when the marker clears', async () => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'saved-self' }] }));
    const { fixture, button } = await mount();
    fixture.componentInstance.onAddSelf();
    const saved = fixture.componentInstance.registrants()[0];
    fixture.componentRef.setInput('initialRegistrants', [saved]);
    fixture.detectChanges();
    await fixture.whenStable();
    removedMeetingIds.set(new Set(['meeting-1']));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
    removedMeetingIds.set(new Set());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toEqual([]);
  });

  it.each([false, true])('reports successful self-row deletion with remaining self registrations: %s', async (remaining) => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'saved-self' }] }));
    const { fixture } = await mount();
    fixture.componentInstance.onAddSelf();
    const saved = fixture.componentInstance.registrants()[0];
    const otherSelf = { ...listed('other-self@vendor-corp.example'), uid: 'other-self', username: SELF_GUEST.username, type: 'committee' as const };
    fixture.componentRef.setInput('initialRegistrants', remaining ? [saved, otherSelf] : [saved]);
    fixture.detectChanges();
    await fixture.whenStable();
    const selfRemoved = vi.fn();
    fixture.componentInstance.selfRemoved.subscribe(selfRemoved);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    fixture.componentInstance.onRequestRemoveGuest(saved);
    confirm.mock.calls[0][0].accept?.();
    fixture.detectChanges();

    expect(selfRemoved).toHaveBeenCalledWith({
      meeting_id: 'meeting-1',
      removed_registrant_ids: ['saved-self'],
      remaining_registrant_ids: remaining ? ['other-self'] : [],
    });
    expect(TestBed.inject(MeetingService).deleteMeetingRegistrants).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants().map((row) => row.uid)).toEqual(remaining ? ['other-self'] : []);
  });

  it('does not report a self-removal when the backend delete fails', async () => {
    const saved = { ...listed(SELF_GUEST.email), uid: 'saved-self', username: SELF_GUEST.username };
    const { fixture } = await mount({ registrants: [saved] });
    vi.mocked(TestBed.inject(MeetingService).deleteMeetingRegistrants).mockReturnValue(throwError(() => new Error('delete failed')));
    const selfRemoved = vi.fn();
    fixture.componentInstance.selfRemoved.subscribe(selfRemoved);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    fixture.componentInstance.onRequestRemoveGuest(saved);
    confirm.mock.calls[0][0].accept?.();
    fixture.detectChanges();
    expect(selfRemoved).not.toHaveBeenCalled();
    expect(fixture.componentInstance.registrants()).toEqual([saved]);
  });

  it('restores focus to Add Guest after an asynchronous roster refresh renders it again', async () => {
    const { fixture, button } = await mount({ fetched: of([]) });
    const refreshed = new Subject<MeetingRegistrant[]>();
    vi.mocked(TestBed.inject(MeetingService).getMeetingRegistrants).mockReturnValue(refreshed);
    const selfButton = button()?.querySelector<HTMLButtonElement>('button');
    selfButton?.focus();
    expect(document.activeElement).toBe(selfButton);
    selfButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="add-registrant-toggle"]')).toBeNull();
    refreshed.next([]);
    refreshed.complete();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-testid="add-registrant-toggle"]'));
  });

  it.each(['close', 'meeting', 'occurrence'])('cancels pending focus restoration after a %s change', async (change) => {
    const { fixture } = await mount({ fetched: of([]), meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    const refreshed = new Subject<MeetingRegistrant[]>();
    vi.mocked(TestBed.inject(MeetingService).getMeetingRegistrants).mockReturnValue(refreshed);
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    await fixture.whenStable();
    if (change === 'close') fixture.componentRef.setInput('visible', false);
    if (change === 'meeting') fixture.componentRef.setInput('meeting', { ...RECURRING_MEETING, id: 'meeting-2' });
    if (change === 'occurrence') fixture.componentRef.setInput('occurrence', { ...OCCURRENCE, occurrence_id: '1894096800' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const otherButton = document.createElement('button');
    document.body.appendChild(otherButton);
    otherButton.focus();
    try {
      refreshed.next([]);
      refreshed.complete();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(otherButton);
    } finally {
      otherButton.remove();
    }
  });

  it.each([false, true])('restores a normal-form self-reinvite without changing its payload, self-fetched: %s', async (selfFetched) => {
    removedMeetingIds.set(new Set(['meeting-1']));
    const old = { ...listed(SELF_GUEST.email), uid: 'old-self', meeting_id: 'meeting-1' };
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'new-self' }] }));
    const { fixture, button } = await mount(selfFetched ? { fetched: of([old]) } : { registrants: [old] });
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    const form = fixture.componentInstance.addRegistrantForm;
    form.addControl('email', new FormControl(SELF_GUEST.email));
    form.addControl('first_name', new FormControl('Manual'));
    form.addControl('last_name', new FormControl('Self'));
    form.addControl('host', new FormControl(true));
    fixture.componentInstance.onAddRegistrant();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(removedMeetingIds().has('meeting-1')).toBe(false);
    expect(TestBed.inject(MeetingService).clearRemovedRegistration).toHaveBeenCalledWith('meeting-1');
    expect(selfAdded).toHaveBeenCalledTimes(1);
    expect(selfAdded).toHaveBeenCalledWith(expect.objectContaining({ uid: 'new-self', email: SELF_GUEST.email }));
    expect(fixture.componentInstance.registrants().map((row) => row.uid)).toEqual(['new-self']);
    expect(button()).toBeNull();
    const submitted = addMeetingRegistrants.mock.calls[0][1][0];
    expect(submitted).toMatchObject({ email: SELF_GUEST.email, first_name: 'Manual', last_name: 'Self', host: true });
    expect(submitted).not.toHaveProperty('username');
    expect(submitted).not.toHaveProperty('avatar_url');
  });

  it('does not clear self-removal state or emit a self-add for another guest added normally', async () => {
    removedMeetingIds.set(new Set(['meeting-1']));
    const { fixture } = await mount();
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    const form = fixture.componentInstance.addRegistrantForm;
    form.addControl('email', new FormControl('another-guest@vendor-corp.example'));
    form.addControl('first_name', new FormControl('Another'));
    form.addControl('last_name', new FormControl('Guest'));
    fixture.componentInstance.onAddRegistrant();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(removedMeetingIds().has('meeting-1')).toBe(true);
    expect(TestBed.inject(MeetingService).clearRemovedRegistration).not.toHaveBeenCalled();
    expect(selfAdded).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'occurrence_id'],
    [null, 'occurrence'],
    ['1893492000', 'occurrence_id'],
    ['1893492000', 'occurrence'],
  ] as const)('retires a UID-less hint after indexing and deletion, invitation scope: %s in %s', async (occurrenceId, scopeField) => {
    const { fixture, button } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    fixture.componentInstance.inviteScopeForm.setValue({ scope: occurrenceId ? 'occurrence' : 'all' });
    fixture.componentInstance.onAddSelf();
    const hint = fixture.componentInstance.registrants()[0];
    expect(hint.uid).toMatch(/^optimistic-/);
    const indexed = {
      ...hint,
      uid: 'indexed-self',
      email: SELF_GUEST.email.toUpperCase(),
      occurrence_id: null,
      [scopeField]: occurrenceId ? String(Number(occurrenceId) * 1000) : null,
    };
    fixture.componentRef.setInput('initialRegistrants', [indexed]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants().map((row) => row.uid)).toEqual(['indexed-self']);

    const selfRemoved = vi.fn();
    fixture.componentInstance.selfRemoved.subscribe(selfRemoved);
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    fixture.componentInstance.onRequestRemoveGuest(indexed);
    confirm.mock.calls[0][0].accept?.();
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(selfRemoved).toHaveBeenCalledWith({ meeting_id: RECURRING_MEETING.id, removed_registrant_ids: ['indexed-self'], remaining_registrant_ids: [] });
    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
    expect(TestBed.inject(MeetingService).deleteMeetingRegistrants).toHaveBeenCalledWith(RECURRING_MEETING.id, ['indexed-self']);
  });

  it('keeps an unindexed hint when only a different invitation scope is indexed', async () => {
    const { fixture } = await mount({ meeting: RECURRING_MEETING, occurrence: OCCURRENCE });
    fixture.componentInstance.inviteScopeForm.setValue({ scope: 'occurrence' });
    fixture.componentInstance.onAddSelf();
    const hint = fixture.componentInstance.registrants()[0];
    const anotherScope = { ...hint, uid: 'other-scope', occurrence_id: null, occurrence: '1894096800' };
    fixture.componentRef.setInput('initialRegistrants', [anotherScope]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.registrants()).toHaveLength(2);
    expect(fixture.componentInstance.registrants().some((row) => row.uid === hint.uid)).toBe(true);

    const matchingScope = { ...hint, uid: 'matching-scope', occurrence_id: null, occurrence: hint.occurrence_id };
    fixture.componentRef.setInput('initialRegistrants', [anotherScope, matchingScope]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.componentInstance
        .registrants()
        .map((row) => row.uid)
        .sort()
    ).toEqual(['matching-scope', 'other-scope']);
  });

  it('keeps submitted identity when a successful response contains only a UID and emits self-add success', async () => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid: 'saved-self' }] }));
    const { fixture, button } = await mount();
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();

    expect(fixture.componentInstance.registrants()[0]).toMatchObject({
      uid: 'saved-self',
      meeting_id: 'meeting-1',
      email: SELF_GUEST.email,
      username: SELF_GUEST.username,
      avatar_url: SELF_GUEST.avatar_url,
      host: false,
    });
    expect(selfAdded).toHaveBeenCalledWith(expect.objectContaining({ uid: 'saved-self', meeting_id: 'meeting-1', email: SELF_GUEST.email }));
    expect(selfAdded).toHaveBeenCalledTimes(1);
    expect(button()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="registrant-display-remove-saved-self"]')).not.toBeNull();
  });

  it.each([undefined, '', 'optimistic-unconfirmed'])('withholds removal for a saved response with unusable UID %s', async (uid) => {
    addMeetingRegistrants.mockReturnValue(of({ ...SUCCESS, successes: [{ uid }] }));
    const { fixture, button } = await mount();
    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();
    const added = fixture.componentInstance.registrants()[0];
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');

    expect(fixture.nativeElement.querySelector('[data-testid^="registrant-display-remove-"]')).toBeNull();
    fixture.componentInstance.onRequestRemoveGuest(added);
    fixture.componentInstance.onRequestRemoveGuest({ ...added, uid: '' });
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.componentInstance.registrants()).toHaveLength(1);
    expect(button()).toBeNull();
  });

  it('lets a pending self-add finish after destruction without emitting or scheduling focus', async () => {
    const response = new Subject<typeof SUCCESS>();
    addMeetingRegistrants.mockReturnValue(response);
    const { fixture } = await mount();
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    fixture.componentInstance.onAddSelf();
    fixture.destroy();

    expect(response.observed).toBe(true);
    expect(() => response.next(SUCCESS)).not.toThrow();
    expect(response.observed).toBe(false);
    expect(selfAdded).not.toHaveBeenCalled();
    expect(refreshRequested).not.toHaveBeenCalled();
  });

  it('ignores a late self-add response after switching meeting context', async () => {
    const response = new Subject<typeof SUCCESS>();
    addMeetingRegistrants.mockReturnValue(response);
    const { fixture, button } = await mount();
    const selfAdded = vi.fn();
    fixture.componentInstance.selfAdded.subscribe(selfAdded);
    fixture.componentInstance.onAddSelf();
    fixture.componentRef.setInput('meeting', { id: 'meeting-2', timezone: 'UTC' });
    fixture.detectChanges();
    await fixture.whenStable();
    response.next(SUCCESS);
    fixture.detectChanges();

    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(button()).not.toBeNull();
    expect(selfAdded).not.toHaveBeenCalled();
  });

  it('stays offered when the add fails', async () => {
    addMeetingRegistrants.mockReturnValue(throwError(() => new Error('upstream down')));
    const { fixture, button } = await mount();

    fixture.componentInstance.onAddSelf();
    fixture.detectChanges();

    expect(button()).not.toBeNull();
  });
});
