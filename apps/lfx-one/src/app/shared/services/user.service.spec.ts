// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Meeting, MeetingRsvp, PastMeeting, User } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './user.service';

/**
 * Covers the `effectiveAvatarUrl` priority chain (LFXV2-2628): an uploaded avatar must win over
 * the Auth0 `picture` claim even while the claim is stale, since that's exactly the race a
 * successful upload racing a slower post-hydration profile fetch depends on. Also covers the two
 * lines that actually enforce that race guard — the post-hydration clobber guard and the
 * on-user-change reset — not just the pure computed that reads their result.
 */
describe('UserService', () => {
  let service: UserService;
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Benign default so tests that don't care about the post-hydration fetch (most of them) don't
    // crash when afterNextRender's callback happens to fire during an ApplicationRef flush.
    httpGet = vi.fn().mockReturnValue(of({ profile: {} }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: httpGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    service = TestBed.inject(UserService);
  });

  it.each([
    [{ 'https://sso.linuxfoundation.org/claims/username': 'canonical' }, 'canonical'],
    [{ username: 'display-alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' }, 'canonical'],
    [{ username: 'alias-only' }, 'alias-only'],
    [{}, null],
    [null, null],
  ])('resolves meeting comparison identity from %j', (user, expected) => {
    service.user.set(user as User | null);
    expect(service.viewerUsername()).toBe(expected);
  });

  it('updates meeting comparison identity when the canonical claim resolves late', () => {
    service.user.set({ username: 'display-alias' } as User);
    expect(service.viewerUsername()).toBe('display-alias');

    service.user.set({ username: 'display-alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' } as User);
    expect(service.viewerUsername()).toBe('canonical');
  });

  it.each([undefined, 'unchanged-alias'])('isolates all personal meeting feeds when canonical identity changes with alias %s', async (username) => {
    const feeds = [
      ['/api/user/meetings', () => service.getUserMeetings()],
      ['/api/user/past-meetings', () => service.getUserPastMeetings()],
      ['/api/user/latest-past-meetings', () => service.getUserLatestPastMeetings()],
    ] as const;
    service.user.set({ username, 'https://sso.linuxfoundation.org/claims/username': 'synthetic-a' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    const previousRequests = new Map<string, Subject<PastMeeting[]>>(feeds.map(([url]) => [url, new Subject<PastMeeting[]>()]));
    httpGet.mockImplementation((url: string) => previousRequests.get(url) ?? of({ profile: {} }));
    const priorRows = feeds.map(() => [] as string[]);
    const previousSubscriptions = feeds.map(([, getFeed], index) => getFeed().subscribe((rows) => priorRows[index].push(...rows.map((row) => row.id))));
    for (const request of previousRequests.values()) request.next([{ id: 'synthetic-a-meeting' } as PastMeeting]);

    service.user.set({ username, 'https://sso.linuxfoundation.org/claims/username': 'synthetic-b' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    for (const request of previousRequests.values()) request.next([{ id: 'synthetic-late-a-meeting' } as PastMeeting]);
    expect(priorRows).toEqual(feeds.map(() => ['synthetic-a-meeting']));

    httpGet.mockImplementation((url: string) => of(url.startsWith('/api/user/') ? [{ id: 'synthetic-b-meeting' }] : { profile: {} }));
    for (const [, getFeed] of feeds) {
      let rows: string[] = [];
      const subscription = getFeed().subscribe((meetings) => (rows = meetings.map((meeting) => meeting.id)));
      expect(rows).toEqual(['synthetic-b-meeting']);
      subscription.unsubscribe();
    }
    previousSubscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  it('isolates past personal feeds when the subject changes without LFID claims', async () => {
    const feeds = [() => service.getUserPastMeetings(), () => service.getUserLatestPastMeetings()];
    httpGet.mockImplementation((url: string) => of(url.startsWith('/api/user/') ? [{ id: 'synthetic-a-meeting' }] : { profile: {} }));
    service.user.set({ sub: 'synthetic-a' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    feeds.forEach((getFeed) => getFeed().subscribe().unsubscribe());

    httpGet.mockImplementation((url: string) => of(url.startsWith('/api/user/') ? [{ id: 'synthetic-b-meeting' }] : { profile: {} }));
    service.user.set({ sub: 'synthetic-b' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    for (const getFeed of feeds) {
      let rows: string[] = [];
      getFeed()
        .subscribe((meetings) => (rows = meetings.map((meeting) => meeting.id)))
        .unsubscribe();
      expect(rows).toEqual(['synthetic-b-meeting']);
    }
  });

  it('refetches a primed personal feed on return after an inactive-lens response without fetching while inactive', () => {
    const pending = { id: 'synthetic-meeting', is_invite_responses_enabled: true, my_rsvp: null } as Meeting;
    const accepted = { ...pending, my_rsvp: { response_type: 'accepted', scope: 'all' } } as Meeting;
    let currentRows = [pending];
    httpGet.mockImplementation((url: string) => of(url === '/api/user/meetings' ? currentRows : { profile: {} }));
    const first = service.getUserMeetings().subscribe();
    first.unsubscribe();
    currentRows = [accepted];
    httpGet.mockClear();

    service.refreshUserMeetings(false);
    expect(httpGet).not.toHaveBeenCalled();

    let returnedRows: Meeting[] = [];
    const returning = service.getUserMeetings().subscribe((rows) => (returnedRows = rows));
    expect(returnedRows.find((meeting) => meeting.id === pending.id)?.my_rsvp?.response_type).toBe('accepted');
    expect(returnedRows.filter((meeting) => meeting.is_invite_responses_enabled && !meeting.my_rsvp)).toEqual([]);
    returning.unsubscribe();
  });

  it('keeps a late confirmation under the dispatch subject instead of the current impersonation subject', async () => {
    const pending = { id: 'synthetic-meeting', is_invite_responses_enabled: true, my_rsvp: null } as Meeting;
    httpGet.mockImplementation((url: string) => of(url === '/api/user/meetings' ? [pending] : { profile: {} }));
    service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    const primed = service.getUserMeetings().subscribe();
    primed.unsubscribe();

    service.user.set({ sub: 'synthetic-b', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    let otherRows: Meeting[] = [];
    const other = service.getUserMeetings().subscribe((rows) => (otherRows = rows));
    service.recordConfirmedMeetingRsvp(
      {
        id: 'synthetic-response',
        meeting_id: pending.id,
        registrant_id: 'synthetic-registrant',
        username: 'unchanged-alias',
        email: 'synthetic@example.com',
        response_type: 'accepted',
        scope: 'all',
        created_at: '2026-10-12T10:00:00Z',
      } as MeetingRsvp,
      'synthetic-a'
    );
    expect(otherRows[0].my_rsvp).toBeNull();

    service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    let returningRows: Meeting[] = [];
    const returning = service.getUserMeetings().subscribe((rows) => (returningRows = rows));
    expect(returningRows[0].my_rsvp?.response_type).toBe('accepted');
    expect(pending.my_rsvp).toBeNull();
    other.unsubscribe();
    returning.unsubscribe();
  });

  describe('RSVP registration retention', () => {
    const response = (overrides: Partial<MeetingRsvp> = {}): MeetingRsvp => ({
      id: 'synthetic-response',
      meeting_id: 'synthetic-meeting',
      registrant_id: 'synthetic-old-registration',
      username: 'synthetic-viewer',
      email: 'synthetic@example.com',
      response_type: 'accepted',
      scope: 'all',
      created_at: '2026-10-12T10:00:00Z',
      ...overrides,
    });
    let indexed: Meeting;

    beforeEach(() => {
      service.user.set({ sub: 'synthetic-subject', username: 'synthetic-viewer' } as User);
      indexed = { id: 'synthetic-meeting', my_rsvp: null, my_registrant_ids: ['synthetic-old-registration'] } as Meeting;
      httpGet.mockImplementation((url: string) => of(url === '/api/user/meetings' ? [indexed] : { profile: {} }));
    });

    it.each([null, undefined])('retains a confirmed write through stale RSVP %s and a personal-feed remount', (myRsvp) => {
      service.recordConfirmedMeetingRsvp(response());
      let rows: Meeting[] = [];
      const first = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp?.response_type).toBe('accepted');
      indexed = { ...indexed, my_rsvp: myRsvp, my_registrant_ids: myRsvp === undefined ? undefined : indexed.my_registrant_ids };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp?.response_type).toBe('accepted');
      first.unsubscribe();
      service.refreshUserMeetings(false);
      const returning = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp?.response_type).toBe('accepted');
      expect(indexed.my_rsvp).toBe(myRsvp);
      returning.unsubscribe();
    });

    it.each([{ registrantIds: [] }, { registrantIds: ['synthetic-new-registration'] }])(
      'invalidates old retained and indexed answers on authoritative registrations $registrantIds',
      ({ registrantIds }) => {
        const oldResponse = response();
        service.recordConfirmedMeetingRsvp(oldResponse);
        let rows: Meeting[] = [];
        const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
        indexed = { ...indexed, my_rsvp: oldResponse, my_registrant_ids: registrantIds };
        service.refreshUserMeetings();
        expect(rows[0].my_rsvp).toBeNull();

        // A later query outage or late acknowledgement cannot resurrect a registration already known to have ended.
        indexed = { ...indexed, my_rsvp: undefined, my_registrant_ids: undefined };
        service.refreshUserMeetings();
        service.recordConfirmedMeetingRsvp({ ...oldResponse, id: 'synthetic-late-old-response' });
        expect(rows[0].my_rsvp).toBeUndefined();
        subscription.unsubscribe();
        service.refreshUserMeetings(false);
        const returning = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
        expect(rows[0].my_rsvp).toBeUndefined();
        returning.unsubscribe();
      }
    );

    it('ends the removed registration through stale indexed reads and accepts a new registration response', () => {
      const oldResponse = response({ created_at: '2026-10-12T12:00:00Z' });
      indexed = { ...indexed, my_rsvp: oldResponse };
      service.recordConfirmedMeetingRsvp(oldResponse);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      const generation = service.meetingRegistrationGeneration(indexed.id, 'synthetic-subject');
      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
        removed_registrant_ids: [oldResponse.registrant_id],
        remaining_registrant_ids: [],
      });
      expect(service.meetingRegistrationGeneration(indexed.id, 'synthetic-subject')).toBe(generation + 1);
      expect(rows[0].my_rsvp).toBeNull();
      service.recordConfirmedMeetingRsvp({ ...oldResponse, id: 'synthetic-late-acknowledgement' });
      expect(rows[0].my_rsvp).toBeNull();

      indexed = { ...indexed, my_rsvp: null, my_registrant_ids: ['synthetic-new-registration'] };
      service.refreshUserMeetings();
      const newResponse = response({ id: 'synthetic-new-response', registrant_id: 'synthetic-new-registration', response_type: 'maybe' });
      service.recordConfirmedMeetingRsvp(newResponse);
      expect(rows[0].my_rsvp).toEqual(newResponse);
      subscription.unsubscribe();
      service.refreshUserMeetings(false);
      const returning = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp).toEqual(newResponse);
      returning.unsubscribe();
    });

    it.each([{ registrantIds: [] }, { registrantIds: ['synthetic-old-registration'] }])(
      'retains a new registration answer through stale registration metadata $registrantIds until indexing catches up',
      ({ registrantIds }) => {
        const oldResponse = response();
        service.recordConfirmedMeetingRsvp(oldResponse);
        let rows: Meeting[] = [];
        const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
        service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
          removed_registrant_ids: [oldResponse.registrant_id],
          remaining_registrant_ids: [],
        });
        indexed = { ...indexed, my_rsvp: oldResponse, my_registrant_ids: registrantIds };
        service.refreshUserMeetings();
        const newResponse = response({ id: 'synthetic-new-response', registrant_id: 'synthetic-new-registration', response_type: 'maybe' });
        service.recordConfirmedMeetingRsvp(newResponse);
        expect(rows[0].my_rsvp).toEqual(newResponse);
        service.refreshUserMeetings();
        expect(rows[0].my_rsvp).toEqual(newResponse);

        indexed = { ...indexed, my_rsvp: null, my_registrant_ids: [newResponse.registrant_id] };
        service.refreshUserMeetings();
        expect(rows[0].my_rsvp).toEqual(newResponse);
        indexed = { ...indexed, my_registrant_ids: [] };
        service.refreshUserMeetings();
        expect(rows[0].my_rsvp).toBeNull();
        service.recordConfirmedMeetingRsvp(oldResponse);
        expect(rows[0].my_rsvp).toBeNull();
        subscription.unsubscribe();
      }
    );

    it.each(['single', 'this_and_following'] as const)(
      'retains a confirmed %s answer from reg-A when reg-B indexes the same date, including an enrichment outage',
      (scope) => {
        const occurrenceId = String(Date.parse('2099-01-01T10:00:00Z') / 1000);
        const confirmed = response({ registrant_id: 'reg-A', scope, occurrence_id: occurrenceId });
        const newerIndexed = response({
          id: 'synthetic-reg-B-response',
          registrant_id: 'reg-B',
          scope,
          occurrence_id: `${occurrenceId}000`,
          response_type: 'declined',
          created_at: '2026-10-12T11:00:00Z',
        });
        indexed = {
          ...indexed,
          recurrence: { type: 2, repeat_interval: 1 },
          occurrences: [{ occurrence_id: occurrenceId, start_time: '2099-01-01T10:00:00Z', duration: 60 }],
          my_registrant_ids: ['reg-A', 'reg-B'],
        };
        service.recordConfirmedMeetingRsvp(confirmed);
        let rows: Meeting[] = [];
        const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
        expect(rows[0].my_rsvp).toEqual(confirmed);

        indexed = { ...indexed, my_rsvp: newerIndexed };
        service.refreshUserMeetings();
        expect(rows[0].my_rsvp).toEqual(newerIndexed);
        // Organizer overview consumes these retained answers separately from the feed's newest applicable answer.
        expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([confirmed]);
        expect(service.isMeetingRsvpCurrent(confirmed, indexed)).toBe(true);

        indexed = { ...indexed, my_rsvp: undefined, my_registrant_ids: undefined };
        service.refreshUserMeetings();
        expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([confirmed]);
        expect(rows[0].my_rsvp).toEqual(confirmed);
        subscription.unsubscribe();
      }
    );

    it.each([false, true])('recovers fresh-load survivor history immediately without changing its timestamps (recurring=%s)', (recurring) => {
      const removed = response({ registrant_id: 'synthetic-removed-registration', created_at: '2026-10-12T12:00:00Z' });
      const allDates = response({ id: 'synthetic-survivor-all', registrant_id: 'synthetic-survivor', response_type: 'accepted' });
      const scoped = response({
        ...allDates,
        id: 'synthetic-survivor-single',
        response_type: 'maybe',
        scope: 'single',
        occurrence_id: '4070944800',
        created_at: '2026-10-12T11:00:00Z',
      });
      indexed = {
        ...indexed,
        my_rsvp: removed,
        my_registrant_ids: [removed.registrant_id, allDates.registrant_id],
        ...(recurring ? { recurrence: { type: 2, repeat_interval: 1 }, occurrences: [] } : {}),
      };
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp).toEqual(removed);
      const requestsBefore = httpGet.mock.calls.length;

      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
        removed_registrant_ids: [removed.registrant_id],
        remaining_registrant_ids: [allDates.registrant_id],
        remaining_rsvps: [scoped, allDates],
      });

      expect(rows[0].my_rsvp).toEqual(recurring ? allDates : scoped);
      expect(httpGet.mock.calls.length).toBe(requestsBefore);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([scoped, allDates]);
      expect(service.isMeetingRsvpCurrent(removed, indexed)).toBe(false);
      subscription.unsubscribe();
    });

    it.each([false, true])('keeps the newer same-row answer when recovering survivor history (indexedNewer=%s)', (indexedNewer) => {
      const survivor = response({ registrant_id: 'synthetic-survivor', response_type: 'maybe' });
      const newer = { ...survivor, response_type: 'declined' as const, modified_at: '2026-10-12T13:00:00Z' };
      const confirmed = indexedNewer ? survivor : newer;
      const recovered = indexedNewer ? newer : survivor;
      indexed = { ...indexed, my_registrant_ids: [survivor.registrant_id] };
      service.recordConfirmedMeetingRsvp(confirmed);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));

      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
        removed_registrant_ids: ['synthetic-deleted-registration'],
        remaining_registrant_ids: [survivor.registrant_id],
        remaining_rsvps: [recovered],
      });

      expect(rows[0].my_rsvp).toEqual(newer);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([newer]);
      subscription.unsubscribe();
    });

    it('retains survivor confirmations and pending acknowledgements after partial removal, but rejects deleted registrations', () => {
      const removed = response({ scope: 'single', occurrence_id: '4070944800' });
      const survivor = response({ id: 'synthetic-survivor-response', registrant_id: 'synthetic-survivor-registration' });
      indexed = { ...indexed, my_registrant_ids: [removed.registrant_id, survivor.registrant_id] };
      service.recordConfirmedMeetingRsvp(survivor);
      service.recordConfirmedMeetingRsvp(removed);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      const generation = service.meetingRegistrationGeneration(indexed.id, 'synthetic-subject');

      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
        removed_registrant_ids: [removed.registrant_id],
        remaining_registrant_ids: [survivor.registrant_id],
      });
      expect(service.meetingRegistrationGeneration(indexed.id, 'synthetic-subject')).toBe(generation);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([survivor]);
      expect(rows[0].my_rsvp).toEqual(survivor);
      expect(service.isMeetingRsvpCurrent(removed, indexed)).toBe(false);
      expect(service.isMeetingRsvpCurrent(survivor, indexed)).toBe(true);

      const survivorAck = { ...survivor, response_type: 'maybe' as const, modified_at: '2026-10-12T12:00:00Z' };
      expect(service.recordConfirmedMeetingRsvp(survivorAck, 'synthetic-subject', generation)).toEqual(survivorAck);
      expect(service.recordConfirmedMeetingRsvp({ ...removed, id: 'synthetic-deleted-late-ack' }, 'synthetic-subject', generation)).toBeNull();
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([survivorAck]);
      expect(rows[0].my_rsvp).toEqual(survivorAck);

      indexed = { ...indexed, my_rsvp: undefined, my_registrant_ids: undefined };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toEqual(survivorAck);
      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-subject', {
        removed_registrant_ids: [survivor.registrant_id],
        remaining_registrant_ids: [],
      });
      expect(service.meetingRegistrationGeneration(indexed.id, 'synthetic-subject')).toBe(generation + 1);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([]);
      expect(service.recordConfirmedMeetingRsvp({ ...survivorAck, id: 'synthetic-survivor-late-ack' }, 'synthetic-subject', generation)).toBeNull();
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([]);
      subscription.unsubscribe();
    });

    it('does not let a retained answer from another registration beat a newly confirmed response during an enrichment outage', () => {
      indexed = { ...indexed, my_registrant_ids: undefined };
      service.recordConfirmedMeetingRsvp(response({ created_at: '2026-10-12T12:00:00Z' }));
      const newResponse = response({ id: 'synthetic-new-response', registrant_id: 'synthetic-new-registration', response_type: 'declined' });
      const saved = service.recordConfirmedMeetingRsvp(newResponse);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      // Stamped after the earlier confirmation so the new answer keeps winning wherever the older one resurfaces.
      expect(saved).toEqual({ ...newResponse, modified_at: '2026-10-12T12:00:00.001Z' });
      expect(rows[0].my_rsvp).toEqual(saved);
      subscription.unsubscribe();
    });

    it('keeps an all-dates answer from another live registration when a single date is answered through a second one', () => {
      const firstDate = String(Date.parse('2099-01-01T10:00:00Z') / 1000);
      const secondDate = String(Date.parse('2099-01-08T10:00:00Z') / 1000);
      indexed = {
        ...indexed,
        recurrence: { type: 2, repeat_interval: 1 },
        occurrences: [
          { occurrence_id: firstDate, start_time: '2099-01-01T10:00:00Z', duration: 60 },
          { occurrence_id: secondDate, start_time: '2099-01-08T10:00:00Z', duration: 60 },
        ],
        my_registrant_ids: ['synthetic-old-registration', 'synthetic-new-registration'],
      };
      const allDates = response();
      const singleDecline = response({
        id: 'synthetic-single-response',
        registrant_id: 'synthetic-new-registration',
        scope: 'single',
        occurrence_id: secondDate,
        response_type: 'declined',
        created_at: '2026-10-12T11:00:00Z',
      });
      service.recordConfirmedMeetingRsvp(allDates);
      service.recordConfirmedMeetingRsvp(singleDecline);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp).toEqual(allDates);
      indexed = { ...indexed, occurrences: indexed.occurrences?.slice(1) };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toEqual(singleDecline);
      subscription.unsubscribe();
    });

    it('shows a single-date answer confirmed after a retained all-dates answer even when its acknowledgement timestamp is older', () => {
      const firstDate = String(Date.parse('2099-01-01T10:00:00Z') / 1000);
      indexed = {
        ...indexed,
        recurrence: { type: 2, repeat_interval: 1 },
        occurrences: [{ occurrence_id: firstDate, start_time: '2099-01-01T10:00:00Z', duration: 60 }],
      };
      service.recordConfirmedMeetingRsvp(response({ modified_at: '2026-10-12T12:00:00Z' }));
      const stored = service.recordConfirmedMeetingRsvp(
        response({ id: 'synthetic-single-response', scope: 'single', occurrence_id: firstDate, response_type: 'declined', modified_at: '2026-10-12T11:00:00Z' })
      );
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(stored?.modified_at).toBe('2026-10-12T12:00:00.001Z');
      expect(rows[0].my_rsvp).toEqual(stored);
      subscription.unsubscribe();
    });

    it('keeps newer applicable indexed responses and occurrence-specific precedence on the same registration', () => {
      const occurrenceId = String(Date.parse('2099-01-01T10:00:00Z') / 1000);
      indexed = {
        ...indexed,
        recurrence: { type: 1, repeat_interval: 1 },
        occurrences: [{ occurrence_id: occurrenceId, start_time: '2099-01-01T10:00:00Z', duration: 60 }],
      };
      service.recordConfirmedMeetingRsvp(response());
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      const indexedResponse = response({
        id: 'synthetic-newer-single',
        scope: 'single',
        occurrence_id: occurrenceId,
        response_type: 'declined',
        created_at: '2026-10-12T11:00:00Z',
      });
      indexed = { ...indexed, my_rsvp: indexedResponse };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toEqual(indexedResponse);
      indexed = { ...indexed, occurrences: [] };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp?.scope).toBe('all');
      expect(rows[0].my_rsvp?.response_type).toBe('accepted');
      subscription.unsubscribe();
    });

    it('retires a retained answer that a newer indexed answer covers, so an enrichment outage cannot resurface it', () => {
      service.recordConfirmedMeetingRsvp(response());
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      const indexedResponse = response({ id: 'synthetic-newer-all', response_type: 'declined', created_at: '2026-10-12T11:00:00Z' });
      indexed = { ...indexed, my_rsvp: indexedResponse };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toEqual(indexedResponse);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([]);

      indexed = { ...indexed, my_rsvp: undefined, my_registrant_ids: undefined };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toBeUndefined();
      subscription.unsubscribe();
    });

    it.each(['single', 'this_and_following'] as const)('does not resurrect a %s confirmation fully covered by a newer indexed following range', (scope) => {
      const occurrenceId = String(Date.parse('2099-01-01T10:00:00Z') / 1000);
      const confirmed = response({ scope, occurrence_id: `${occurrenceId}000` });
      indexed = {
        ...indexed,
        recurrence: { type: 2, repeat_interval: 1 },
        occurrences: [{ occurrence_id: occurrenceId, start_time: '2099-01-01T10:00:00Z', duration: 60 }],
      };
      service.recordConfirmedMeetingRsvp(confirmed);
      let rows: Meeting[] = [];
      const subscription = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      expect(rows[0].my_rsvp).toEqual(confirmed);

      const newer = response({
        id: 'synthetic-newer-following',
        scope: 'this_and_following',
        occurrence_id: String(Number(occurrenceId) - 86400),
        response_type: 'declined',
        created_at: '2026-10-12T11:00:00Z',
      });
      indexed = { ...indexed, my_rsvp: newer };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toEqual(newer);
      expect(service.confirmedMeetingRsvps(indexed.id)).toEqual([]);

      indexed = { ...indexed, my_rsvp: undefined, my_registrant_ids: undefined };
      service.refreshUserMeetings();
      expect(rows[0].my_rsvp).toBeUndefined();
      subscription.unsubscribe();
    });

    it('applies late registration removal only to its dispatch subject, even when aliases and registration UIDs match', async () => {
      service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
      await TestBed.inject(ApplicationRef).whenStable();
      service.recordConfirmedMeetingRsvp(response(), 'synthetic-a');
      service.recordConfirmedMeetingRsvp(response({ id: 'synthetic-b-response', response_type: 'maybe' }), 'synthetic-b');
      service.user.set({ sub: 'synthetic-b', username: 'unchanged-alias' } as User);
      await TestBed.inject(ApplicationRef).whenStable();
      let rows: Meeting[] = [];
      const other = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      service.clearConfirmedMeetingRsvps(indexed.id, 'synthetic-a', {
        removed_registrant_ids: ['synthetic-old-registration'],
        remaining_registrant_ids: [],
      });
      expect(rows[0].my_rsvp?.response_type).toBe('maybe');
      other.unsubscribe();

      service.user.set({ sub: 'synthetic-a', username: 'unchanged-alias' } as User);
      await TestBed.inject(ApplicationRef).whenStable();
      const returning = service.getUserMeetings().subscribe((meetings) => (rows = meetings));
      service.recordConfirmedMeetingRsvp(response({ id: 'synthetic-late-a-response' }), 'synthetic-a');
      expect(rows[0].my_rsvp).toBeNull();
      returning.unsubscribe();
    });
  });

  it('falls back to the Auth0 picture claim when no avatar has been uploaded', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/stale.png');
  });

  it('prefers the uploaded avatar over the picture claim even when the claim is unchanged', () => {
    service.user.set({ picture: 'https://cdn.auth0.com/stale.png' } as User);
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('returns an empty string when neither source is set', () => {
    expect(service.effectiveAvatarUrl()).toBe('');
  });

  it('does not let a slower post-hydration profile fetch clobber an upload that already resolved', () => {
    httpGet.mockReturnValue(of({ profile: { picture: 'https://stale-fetch.png' } }));
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/stale.png' } as User);
    // Simulate the upload finishing before the post-hydration fetch's afterNextRender callback runs.
    service.uploadedAvatarUrl.set('https://cdn.example.com/fresh-upload.png');

    TestBed.inject(ApplicationRef).tick();

    expect(httpGet).toHaveBeenCalledWith('/api/profile');
    expect(service.uploadedAvatarUrl()).toBe('https://cdn.example.com/fresh-upload.png');
  });

  it('retains an uploaded avatar when the same subject gains its canonical LFID', async () => {
    service.user.set({ sub: 'synthetic-subject', username: 'display-alias', picture: 'https://cdn.example.com/claim.png' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/upload.png');

    service.user.update((user) => ({ ...user!, 'https://sso.linuxfoundation.org/claims/username': 'canonical' }));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.viewerUsername()).toBe('canonical');
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/upload.png');
  });

  it('clears the uploaded avatar when the subject changes with unchanged LFID claims', async () => {
    service.user.set({ sub: 'synthetic-a', username: 'alias', 'https://sso.linuxfoundation.org/claims/username': 'canonical' } as User);
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/upload.png');

    service.user.update((user) => ({ ...user!, sub: 'synthetic-b', picture: 'https://cdn.example.com/other.png' }));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.uploadedAvatarUrl()).toBeNull();
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.example.com/other.png');
  });

  it('resets the uploaded avatar when the user changes, so an impersonation swap cannot inherit it', async () => {
    service.user.set({ username: 'alice', picture: 'https://cdn.auth0.com/alice.png' } as User);
    // Flush before setting the upload — otherwise this synchronous test would batch both user.set
    // calls into a single downstream emission and the reset subscription would never see "alice"
    // as a distinct value to transition away from.
    await TestBed.inject(ApplicationRef).whenStable();
    service.uploadedAvatarUrl.set('https://cdn.example.com/alice-upload.png');

    service.user.set({ username: 'bob', picture: 'https://cdn.auth0.com/bob.png' } as User);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.uploadedAvatarUrl()).toBeNull();
    expect(service.effectiveAvatarUrl()).toBe('https://cdn.auth0.com/bob.png');
  });
});
