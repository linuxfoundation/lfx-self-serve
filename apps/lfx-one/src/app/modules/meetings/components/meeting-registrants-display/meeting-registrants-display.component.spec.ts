// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Meeting, MeetingOccurrence, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
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
