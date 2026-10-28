// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Meeting, MeetingOccurrence, MeetingRegistrant, MeetingRegistrantWithState, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
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

  async function mount(options: { past?: boolean; registrants?: MeetingRegistrant[]; participants?: PastMeetingParticipant[] }) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
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
    fixture.componentRef.setInput('meeting', options.past ? PAST_MEETING : { id: 'meeting-1' });
    fixture.componentRef.setInput('pastMeeting', !!options.past);
    if (!options.past) {
      fixture.componentRef.setInput('initialRegistrants', options.registrants ?? []);
    }
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('lists everyone while the organizer filter is on "all"', async () => {
    const component = await mount({ registrants: [registrant('ada', true), registrant('grace', false)] });

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['ada', 'grace']);
  });

  it('keeps only organizers when the organizer filter is set', async () => {
    const component = await mount({ registrants: [registrant('ada', true), registrant('grace', false)] });

    component.organizerFilterControl.setValue('organizer');

    expect(component.filteredRegistrants().map((r) => r.uid)).toEqual(['ada']);
  });

  it('applies the organizer filter to both the member and guest sections', async () => {
    const component = await mount({
      registrants: [registrant('ada', true, 'committee'), registrant('grace', false, 'committee'), registrant('linus', true), registrant('ken', false)],
    });

    component.organizerFilterControl.setValue('organizer');

    expect(component.committeeFilteredRegistrants().map((r) => r.uid)).toEqual(['ada']);
    expect(component.directFilteredRegistrants().map((r) => r.uid)).toEqual(['linus']);
  });

  it('keeps only organizers among past participants', async () => {
    const participants = [
      { ...participant('ada@acme-motors.example'), host: true },
      { ...participant('grace@acme-motors.example'), host: false },
    ] as PastMeetingParticipant[];
    const component = await mount({ past: true, participants });

    expect(component.filteredPastParticipants()).toHaveLength(2);

    component.organizerFilterControl.setValue('organizer');

    expect(component.filteredPastParticipants().map((p) => p.email)).toEqual(['ada@acme-motors.example']);
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
    const component = await mount(update, [registrant('ada', false), registrant('grace', false)]);

    component.onToggleHost(registrant('grace', false));

    expect(update).toHaveBeenCalledTimes(1);
    const [meetingId, updates] = update.mock.calls[0];
    expect(meetingId).toBe('meeting-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].uid).toBe('grace');
    expect(updates[0].changes).toMatchObject({ meeting_id: 'meeting-1', email: 'grace@acme-motors.example', first_name: 'grace', host: true });
  });

  it('sends an occurrence-scoped guest back with the scope it already has', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    // The query-service index spells the scope `occurrence` and never `occurrence_id`.
    const scoped = { ...registrant('ada', false), occurrence: '1700000000' } as unknown as MeetingRegistrant;
    const component = await mount(update, [scoped]);

    component.onToggleHost(scoped);

    expect(update.mock.calls[0][1][0].changes.occurrence_id).toBe('1700000000');
  });

  it('names the host toggle after the email when the guest has no name', async () => {
    const component = await mount(vi.fn(), []);
    const nameless = { ...registrant('ada', false), first_name: '', last_name: '' } as MeetingRegistrant;

    expect(component['hostToggleLabel'](nameless)).toBe('Make ada@acme-motors.example a meeting host');
    expect(component['hostToggleLabel']({ ...nameless, host: true })).toBe('Remove ada@acme-motors.example as meeting host');
  });

  it('shows the change at once and lists hosts first', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    const component = await mount(update, [registrant('ada', false), registrant('grace', false)]);

    component.onToggleHost(registrant('grace', false));

    expect(component.registrants().map((r) => [r.uid, r.host])).toEqual([
      ['grace', true],
      ['ada', false],
    ]);
  });

  it('asks the owner of the list to reload after a successful change', async () => {
    const update = vi.fn().mockReturnValue(of(success));
    const component = await mount(update, [registrant('ada', false)]);
    const reload = vi.fn();
    component.refreshRequested.subscribe(reload);

    component.onToggleHost(registrant('ada', false));

    expect(reload).toHaveBeenCalledWith(0);
  });

  it('does not ask for a reload when the update fails', async () => {
    const update = vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 1 }, successes: [], failures: [] }));
    const component = await mount(update, [registrant('ada', false)]);
    const reload = vi.fn();
    component.refreshRequested.subscribe(reload);

    component.onToggleHost(registrant('ada', false));

    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the list alone when the update fails', async () => {
    const update = vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 1 }, successes: [], failures: [{ error: { message: 'nope' } }] }));
    const component = await mount(update, [registrant('ada', false)]);

    component.onToggleHost(registrant('ada', false));

    expect(component.registrants()[0].host).toBe(false);
  });

  it('leaves the list alone when the request errors', async () => {
    const update = vi.fn().mockReturnValue(throwError(() => new Error('network')));
    const component = await mount(update, [registrant('ada', false)]);

    component.onToggleHost(registrant('ada', false));

    expect(component.registrants()[0].host).toBe(false);
  });

  it('ignores a guest the server has not confirmed yet', async () => {
    const update = vi.fn();
    const component = await mount(update, []);

    component.onToggleHost(registrant('optimistic-1', false));

    expect(update).not.toHaveBeenCalled();
  });
});
