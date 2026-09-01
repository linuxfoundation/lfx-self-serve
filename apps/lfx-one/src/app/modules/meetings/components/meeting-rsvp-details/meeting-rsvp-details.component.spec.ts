// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRegistrant, PastMeeting, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRsvpDetailsComponent } from './meeting-rsvp-details.component';

// Regression coverage for GH-1731: the parent join page already fetches the registrant roster via
// getMyMeetingRegistrants(); this component must reuse it (via initialRegistrants) rather than
// re-fetching, and must not double-count the parent's optimistic pad on top of the supplied roster.
describe('MeetingRsvpDetailsComponent', () => {
  const MEETING_ID = 'meeting-1';

  let getMeetingRegistrants: ReturnType<typeof vi.fn>;
  let getMeetingRsvps: ReturnType<typeof vi.fn>;
  let getPastMeetingParticipants: ReturnType<typeof vi.fn>;
  let userSignal: ReturnType<typeof signal<User | null>>;

  const buildMeeting = (overrides: Partial<Meeting> = {}) =>
    ({
      id: MEETING_ID,
      uid: MEETING_ID,
      individual_registrants_count: undefined,
      committee_members_count: undefined,
      registrant_count: undefined,
      ...overrides,
    }) as unknown as Meeting;

  let registrantUidCounter = 0;

  const buildRegistrant = (overrides: Partial<MeetingRegistrant> = {}) =>
    ({
      uid: `reg-${++registrantUidCounter}`,
      meeting_id: MEETING_ID,
      email: 'attendee@example.com',
      first_name: 'Test',
      last_name: 'Attendee',
      type: 'direct',
      ...overrides,
    }) as unknown as MeetingRegistrant;

  // No whenStable() here: the required `meeting` input must be set (see each test's setInput
  // call, made synchronously right after this returns) before the constructor's toObservable(this.meeting)
  // effect first flushes — otherwise it reads the required signal with no value, throws NG0950, and
  // permanently kills that observable before setInput ever lands.
  const createComponent = () => TestBed.createComponent(MeetingRsvpDetailsComponent);

  beforeEach(() => {
    registrantUidCounter = 0;
    getMeetingRegistrants = vi.fn().mockReturnValue(of([]));
    getMeetingRsvps = vi.fn().mockReturnValue(of([]));
    getPastMeetingParticipants = vi.fn().mockReturnValue(of([]));
    userSignal = signal<User | null>(null);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingService,
          useValue: { getMeetingRegistrants, getMeetingRsvps, getPastMeetingParticipants },
        },
        { provide: UserService, useValue: { user: userSignal } },
      ],
    });
  });

  it('never fetches registrants or RSVPs when the parent supplies the roster', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput('initialRegistrants', [buildRegistrant(), buildRegistrant()]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(getMeetingRegistrants).not.toHaveBeenCalled();
    expect(getMeetingRsvps).not.toHaveBeenCalled();
  });

  it('adds the optimistic pad on top of the supplied roster length without double-counting', async () => {
    const registrants = Array.from({ length: 10 }, () => buildRegistrant());
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput('initialRegistrants', registrants);
    fixture.componentRef.setInput('additionalRegistrantsCount', 1);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.meetingRegistrantCount()).toBe(11);
  });

  it('reads count 11 with no flicker to 12 as the roster grows and the pad drops', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput(
      'initialRegistrants',
      Array.from({ length: 10 }, () => buildRegistrant())
    );
    fixture.componentRef.setInput('additionalRegistrantsCount', 1);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.meetingRegistrantCount()).toBe(11);

    fixture.componentRef.setInput(
      'initialRegistrants',
      Array.from({ length: 11 }, () => buildRegistrant())
    );
    fixture.componentRef.setInput('additionalRegistrantsCount', 0);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.meetingRegistrantCount()).toBe(11);
  });

  it('derives RSVP counts and currentUserHasRsvpChanged from the supplied registrants, keyed on the current user', async () => {
    const currentUserEmail = 'me@example.com';
    const registrants = [
      buildRegistrant({ email: currentUserEmail, rsvp: { response_type: 'accepted', email: currentUserEmail } as never }),
      buildRegistrant({ rsvp: { response_type: 'declined', email: 'other@example.com' } as never }),
    ];
    const emitted: boolean[] = [];

    const fixture = createComponent();
    fixture.componentInstance.currentUserHasRsvpChanged.subscribe((v: boolean) => emitted.push(v));
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput('initialRegistrants', registrants);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.acceptedCount()).toBe(1);
    expect(fixture.componentInstance.declinedCount()).toBe(1);

    userSignal.set({ email: currentUserEmail } as unknown as User);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(emitted).toContain(true);
  });

  it('drives loading() from initialRegistrantsLoading with no HTTP call', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput('initialRegistrants', []);
    fixture.componentRef.setInput('initialRegistrantsLoading', true);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.loading()).toBe(true);

    fixture.componentRef.setInput('initialRegistrantsLoading', false);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('falls back to its own registrant fetch when initialRegistrants is left null', async () => {
    const registrants = [buildRegistrant(), buildRegistrant(), buildRegistrant()];
    getMeetingRegistrants.mockReturnValue(of(registrants));

    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    await TestBed.inject(ApplicationRef).whenStable();

    expect(getMeetingRegistrants).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.meetingRegistrantCount()).toBe(3);
  });

  it('still uses past participants for a past meeting even when initialRegistrants is supplied', async () => {
    getPastMeetingParticipants.mockReturnValue(of([{ is_attended: true }, { is_attended: false }]));

    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', { id: MEETING_ID, uid: MEETING_ID } as unknown as PastMeeting);
    fixture.componentRef.setInput('pastMeeting', true);
    fixture.componentRef.setInput('initialRegistrants', [buildRegistrant(), buildRegistrant()]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(getPastMeetingParticipants).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.meetingRegistrantCount()).toBe(2);
    expect(fixture.componentInstance.attendedCount()).toBe(1);
  });
});
