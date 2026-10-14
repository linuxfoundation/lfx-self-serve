// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRegistrant, MeetingRsvp, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachRsvpsToRegistrants } from '../../../../../server/helpers/meeting-rsvp.helper';
import { MeetingRsvpDetailsComponent } from './meeting-rsvp-details.component';

// Regression coverage for GH-1731: the parent join page already fetches the registrant roster via
// getMyMeetingRegistrants(); this component must reuse it (via initialRegistrants) rather than
// re-fetching, and must not double-count the parent's optimistic pad on top of the supplied roster.
describe('MeetingRsvpDetailsComponent', () => {
  const MEETING_ID = 'meeting-1';

  let getMeetingRegistrants: ReturnType<typeof vi.fn>;
  let getMeetingRsvps: ReturnType<typeof vi.fn>;
  let getPastMeetingParticipants: ReturnType<typeof vi.fn>;

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

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingService,
          useValue: { getMeetingRegistrants, getMeetingRsvps, getPastMeetingParticipants },
        },
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

  it('derives response counts from the supplied registrants', async () => {
    const currentUserEmail = 'me@example.com';
    const registrants = [
      buildRegistrant({ email: currentUserEmail, rsvp: { response_type: 'accepted', email: currentUserEmail } as never }),
      buildRegistrant({ rsvp: { response_type: 'declined', email: 'other@example.com' } as never }),
    ];

    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting());
    fixture.componentRef.setInput('initialRegistrants', registrants);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.acceptedCount()).toBe(1);
    expect(fixture.componentInstance.declinedCount()).toBe(1);
  });

  it.each([
    { label: 'a populated', roster: () => [buildRegistrant({ rsvp: { response_type: 'maybe', email: 'other@example.com' } as never })] },
    { label: 'an empty', roster: () => [] },
  ])('counts and previews a confirmed guest whose registration is missing from $label supplied roster', async ({ roster }) => {
    const confirmed = {
      id: 'synthetic-confirmed',
      meeting_id: MEETING_ID,
      registrant_id: 'synthetic-unindexed-registration',
      username: 'synthetic-viewer',
      name: 'Synthetic Viewer',
      email: 'viewer@example.com',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    const registrants = roster();

    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting({ is_invite_responses_enabled: true }));
    fixture.componentRef.setInput('initialRegistrants', registrants);
    fixture.componentRef.setInput('confirmedRsvps', [confirmed]);
    await TestBed.inject(ApplicationRef).whenStable();

    const component = fixture.componentInstance;
    expect(component.acceptedCount()).toBe(1);
    expect(component.rsvpCounts().total).toBe(registrants.length + 1);
    expect(component.meetingRegistrantCount()).toBe(registrants.length + 1);
    expect(component.previewPeople().map((person) => person.name)).toContain('Synthetic Viewer');
  });

  it('does not add rows for confirmed answers when no roster exists and RSVP rows drive the counts', async () => {
    const confirmed = {
      id: 'synthetic-confirmed',
      meeting_id: MEETING_ID,
      registrant_id: 'synthetic-unindexed-registration',
      email: 'viewer@example.com',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
    } as MeetingRsvp;
    const other = { ...confirmed, id: 'synthetic-other', registrant_id: 'synthetic-other', email: 'other@example.com', response_type: 'maybe' } as MeetingRsvp;
    getMeetingRsvps.mockReturnValue(of([other]));

    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting({ is_invite_responses_enabled: true, individual_registrants_count: 2 }));
    fixture.componentRef.setInput('confirmedRsvps', [confirmed]);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.registrants()).toEqual([]);
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 0, maybe: 1, total: 2 });
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

  it.each(['single', 'this_and_following'] as const)(
    'keeps older all counts and preview from the real BFF selection without a confirmed %s overlay',
    async (scope) => {
      const all = { id: 'all', registrant_id: 'all-guest', response_type: 'accepted', scope: 'all', modified_at: '2026-01-01T00:00:00Z' } as MeetingRsvp;
      const scoped = {
        ...all,
        id: 'scoped',
        scope,
        response_type: 'declined',
        occurrence_id: '4071031200000',
        modified_at: '2026-02-01T00:00:00Z',
      } as MeetingRsvp;
      const scopedOnly = { ...scoped, registrant_id: 'scoped-guest' };
      const roster = [buildRegistrant({ uid: 'scoped-guest' }), buildRegistrant({ uid: 'all-guest' })];
      getMeetingRegistrants.mockImplementation((_id, _includeRsvp, occurrenceId, _partial, _committee, _enrich, allDatesOnly) =>
        of(attachRsvpsToRegistrants(roster, [all, scoped, scopedOnly], occurrenceId, allDatesOnly))
      );
      const fixture = createComponent();
      fixture.componentRef.setInput(
        'meeting',
        buildMeeting({ is_invite_responses_enabled: true, recurrence: { type: 2, repeat_interval: 1 }, occurrences: [] })
      );
      await fixture.whenStable();

      expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 0, maybe: 0, total: 2 });
      expect(fixture.componentInstance.previewPeople().map((person) => person.key)).toEqual(['all-guest', 'scoped-guest']);
      expect(getMeetingRegistrants).toHaveBeenCalledWith(MEETING_ID, true, undefined, false, undefined, false, true);
    }
  );

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

  it('renders the attendee preview only when asked, attending people first, and forwards View all', async () => {
    const registrants = [
      buildRegistrant({ uid: 'declined', rsvp: { response_type: 'declined' } as never }),
      buildRegistrant({ uid: 'accepted', rsvp: { response_type: 'accepted' } as never }),
    ];
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', buildMeeting({ is_invite_responses_enabled: true }));
    fixture.componentRef.setInput('initialRegistrants', registrants);
    await TestBed.inject(ApplicationRef).whenStable();

    const preview = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="attendee-preview"]');
    expect(preview()).toBeNull();

    fixture.componentRef.setInput('showAttendeePreview', true);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(preview()).not.toBeNull();
    expect(fixture.componentInstance.previewPeople().map((p) => p.key)).toEqual(['accepted', 'declined']);

    let viewAll = 0;
    fixture.componentInstance.viewAllClicked.subscribe(() => viewAll++);
    (fixture.nativeElement.querySelector('[data-testid="attendee-preview-view-all"]') as HTMLButtonElement).click();
    expect(viewAll).toBe(1);
  });

  it.each(['roster', 'rsvps'] as const)('reconciles confirmed responses by date without losing other guests or newer %s data', async (source) => {
    const firstDate = { occurrence_id: '4071031200', start_time: '2099-01-02T10:00:00Z', duration: 30 };
    const secondDate = { occurrence_id: '4071636000', start_time: '2099-01-09T10:00:00Z', duration: 30 };
    const accepted: MeetingRsvp = {
      id: 'synthetic-all',
      meeting_id: MEETING_ID,
      registrant_id: 'synthetic-viewer',
      username: 'synthetic-viewer',
      email: 'viewer@example.com',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-10T10:00:00Z',
    };
    const declined: MeetingRsvp = {
      ...accepted,
      id: 'synthetic-single',
      response_type: 'declined',
      scope: 'single',
      occurrence_id: firstDate.occurrence_id,
      modified_at: '2026-10-10T11:00:00Z',
    };
    const other: MeetingRsvp = { ...accepted, id: 'synthetic-other', registrant_id: 'synthetic-other', email: 'other@example.com', response_type: 'maybe' };
    getMeetingRegistrants.mockReturnValue(
      of([
        buildRegistrant({ uid: accepted.registrant_id, email: accepted.email, rsvp: accepted }),
        buildRegistrant({ uid: other.registrant_id, email: other.email, rsvp: other }),
      ])
    );
    getMeetingRsvps.mockReturnValue(of([accepted, other]));
    const meeting = buildMeeting({
      is_invite_responses_enabled: true,
      recurrence: { type: 2, repeat_interval: 1 },
      occurrences: [firstDate, secondDate],
      ...(source === 'rsvps' ? { individual_registrants_count: 2 } : {}),
    });
    const fixture = createComponent();
    fixture.componentRef.setInput('meeting', meeting);
    fixture.componentRef.setInput('currentOccurrence', firstDate);
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.componentRef.setInput('confirmedRsvps', [declined, accepted]);
    await fixture.whenStable();
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 0, declined: 1, maybe: 1, total: 2 });

    fixture.componentRef.setInput('currentOccurrence', secondDate);
    await fixture.whenStable();
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 0, maybe: 1, total: 2 });

    const newer = { ...accepted, response_type: 'declined' as const, modified_at: '2026-10-10T12:00:00Z' };
    getMeetingRegistrants.mockReturnValue(
      of([
        buildRegistrant({ uid: newer.registrant_id, email: newer.email, rsvp: newer }),
        buildRegistrant({ uid: other.registrant_id, email: other.email, rsvp: other }),
      ])
    );
    getMeetingRsvps.mockReturnValue(of([newer, other]));
    fixture.componentRef.setInput('meeting', { ...meeting });
    await fixture.whenStable();
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 0, declined: 1, maybe: 1, total: 2 });
  });

  it('refetches the roster when the displayed date changes so an older all-dates answer returns', async () => {
    const firstDate = { occurrence_id: '4071031200', start_time: '2099-01-02T10:00:00Z', duration: 30 };
    const secondDate = { occurrence_id: '4071636000', start_time: '2099-01-09T10:00:00Z', duration: 30 };
    const all = { id: 'all', registrant_id: 'guest', response_type: 'accepted', scope: 'all', modified_at: '2026-01-01T00:00:00Z' } as MeetingRsvp;
    const single = {
      ...all,
      id: 'single',
      scope: 'single',
      response_type: 'declined',
      occurrence_id: firstDate.occurrence_id,
      modified_at: '2026-02-01T00:00:00Z',
    };
    const roster = [buildRegistrant({ uid: 'guest' })];
    getMeetingRegistrants.mockImplementation((_id, _includeRsvp, occurrenceId, _partial, _committee, _enrich, allDatesOnly) =>
      of(attachRsvpsToRegistrants(roster, [all, single as MeetingRsvp], occurrenceId, allDatesOnly))
    );
    const fixture = createComponent();
    fixture.componentRef.setInput(
      'meeting',
      buildMeeting({ is_invite_responses_enabled: true, recurrence: { type: 2, repeat_interval: 1 }, occurrences: [firstDate, secondDate] })
    );
    fixture.componentRef.setInput('currentOccurrence', firstDate);
    await fixture.whenStable();
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 0, declined: 1, maybe: 0, total: 1 });

    fixture.componentRef.setInput('currentOccurrence', secondDate);
    await fixture.whenStable();

    expect(getMeetingRegistrants).toHaveBeenLastCalledWith(MEETING_ID, true, secondDate.occurrence_id, false, undefined, false, false);
    expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 0, maybe: 0, total: 1 });
  });

  describe.each(['roster', 'supplied', 'rsvps'] as const)('unresolved recurring dates with %s data', (source) => {
    it.each([
      ['confirmed', 'single'],
      ['confirmed', 'this_and_following'],
      ['indexed', 'single'],
      ['indexed', 'this_and_following'],
    ] as const)('ignores %s %s responses until the date resolves', async (origin, scope) => {
      const occurrence = { occurrence_id: '4071031200', start_time: '2099-01-02T10:00:00Z', duration: 30 };
      const accepted: MeetingRsvp = {
        id: 'synthetic-all',
        meeting_id: MEETING_ID,
        registrant_id: 'synthetic-viewer',
        username: 'synthetic-viewer',
        email: 'viewer@example.com',
        response_type: 'accepted',
        scope: 'all',
        created_at: '2026-10-10T10:00:00Z',
      };
      const scoped: MeetingRsvp = {
        ...accepted,
        id: 'synthetic-scoped',
        response_type: 'declined',
        scope,
        occurrence_id: occurrence.occurrence_id,
        modified_at: '2026-10-10T11:00:00Z',
      };
      const scopedOnly: MeetingRsvp = {
        ...scoped,
        id: 'synthetic-scoped-only',
        registrant_id: 'synthetic-scoped-only',
        email: 'scoped@example.com',
        response_type: 'accepted',
      };
      const other: MeetingRsvp = {
        ...accepted,
        id: 'synthetic-other',
        registrant_id: 'synthetic-other',
        email: 'other@example.com',
        response_type: 'maybe',
      };
      const indexed = origin === 'indexed' ? [scoped, scopedOnly, other] : [accepted, other];
      const registrants = [
        buildRegistrant({ uid: accepted.registrant_id, email: accepted.email, rsvp: indexed[0] }),
        buildRegistrant({ uid: other.registrant_id, email: other.email, rsvp: other }),
        buildRegistrant({ uid: scopedOnly.registrant_id, email: scopedOnly.email, rsvp: origin === 'indexed' ? scopedOnly : null }),
      ];
      getMeetingRegistrants.mockReturnValue(of(registrants));
      getMeetingRsvps.mockReturnValue(of(indexed));
      const fixture = createComponent();
      fixture.componentRef.setInput(
        'meeting',
        buildMeeting({
          is_invite_responses_enabled: true,
          recurrence: { type: 2, repeat_interval: 1 },
          occurrences: [],
          ...(source === 'rsvps' ? { individual_registrants_count: 3 } : {}),
        })
      );
      if (source === 'supplied') fixture.componentRef.setInput('initialRegistrants', registrants);
      fixture.componentRef.setInput('confirmedRsvps', origin === 'confirmed' ? [scoped, scopedOnly] : [accepted]);
      await fixture.whenStable();

      expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 0, maybe: 1, total: source === 'rsvps' ? 2 : 3 });
      expect(fixture.componentInstance.previewPeople().map((person) => person.key)).toEqual(
        source === 'rsvps' ? [accepted.registrant_id, other.registrant_id] : [accepted.registrant_id, other.registrant_id, scopedOnly.registrant_id]
      );

      fixture.componentRef.setInput('currentOccurrence', occurrence);
      await fixture.whenStable();
      expect(fixture.componentInstance.rsvpCounts()).toEqual({ accepted: 1, declined: 1, maybe: 1, total: 3 });
      expect(fixture.componentInstance.previewPeople().map((person) => person.key)).toEqual([
        scopedOnly.registrant_id,
        other.registrant_id,
        accepted.registrant_id,
      ]);
    });
  });
});
