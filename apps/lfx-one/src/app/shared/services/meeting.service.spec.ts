// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type {
  BatchRegistrantOperationResponse,
  CreateMeetingRegistrantRequest,
  MeetingRegistrant,
  MeetingRegistrantWithState,
  UpdateMeetingRegistrantRequest,
} from '@lfx-one/shared/interfaces';
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingService } from './meeting.service';

const MEETING_UID = 'b0b1f0d6-4c1c-4a2a-9f0e-2f3c1a6d7e10';

/**
 * A saved registrant, every optional string populated. Individual tests blank exactly one field so
 * each omission is asserted on its own rather than through a fixture that clears all three at once.
 */
function registrant(overrides: Partial<MeetingRegistrantWithState> = {}): MeetingRegistrantWithState {
  return {
    uid: 'reg-1',
    meeting_id: MEETING_UID,
    email: 'dana.reyes@acme-motors.example',
    first_name: 'Dana',
    last_name: 'Reyes',
    host: false,
    job_title: 'Staff Engineer',
    org_name: 'Acme Motors',
    occurrence_id: null,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: null,
    username: null,
    linkedin_profile: null,
    created_at: '2026-01-05T09:00:00.000Z',
    updated_at: '2026-01-05T09:00:00.000Z',
    type: 'committee',
    committee_uid: 'cmt-9d2f',
    invite_accepted: null,
    attended: null,
    state: 'new',
    ...overrides,
  };
}

describe('MeetingService registrant payload mapping', () => {
  let service: MeetingService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }],
    });
    service = TestBed.inject(MeetingService);
  });

  describe('stripMetadata', () => {
    it('carries the meeting uid and every populated optional field', () => {
      const body = service.stripMetadata(MEETING_UID, registrant());

      expect(body).toEqual({
        meeting_id: MEETING_UID,
        email: 'dana.reyes@acme-motors.example',
        first_name: 'Dana',
        last_name: 'Reyes',
        host: false,
        job_title: 'Staff Engineer',
        org_name: 'Acme Motors',
        committee_uid: 'cmt-9d2f',
      });
    });

    it('takes the meeting uid from the argument, not from the registrant', () => {
      const body = service.stripMetadata('c7c9a5f4-6d1e-4a68-9c33-1f5b0c9a4d21', registrant({ meeting_id: 'stale-meeting' }));

      expect(body.meeting_id).toBe('c7c9a5f4-6d1e-4a68-9c33-1f5b0c9a4d21');
    });

    // Upstream declares these as non-nullable optional strings, so a blank one has to be absent from
    // the body rather than present as `null` — see the mapper's own docblock. `not.toHaveProperty` is
    // the assertion that tells the two apart; `toBeUndefined` passes for an explicit `undefined` too.
    it.each([
      ['job_title', { job_title: null }],
      ['org_name', { org_name: null }],
      ['committee_uid', { committee_uid: null }],
    ] as const)('omits %s entirely when it is null', (key, blanked) => {
      const body = service.stripMetadata(MEETING_UID, registrant(blanked));

      expect(body).not.toHaveProperty(key);
    });

    it.each([
      ['job_title', { job_title: '' }],
      ['org_name', { org_name: '' }],
      ['committee_uid', { committee_uid: '' }],
    ] as const)('omits %s entirely when it is an empty string', (key, blanked) => {
      const body = service.stripMetadata(MEETING_UID, registrant(blanked));

      expect(body).not.toHaveProperty(key);
    });

    it('omits only the blank field and keeps its neighbours', () => {
      const body = service.stripMetadata(MEETING_UID, registrant({ org_name: null }));

      expect(body).not.toHaveProperty('org_name');
      expect(body.job_title).toBe('Staff Engineer');
      expect(body.committee_uid).toBe('cmt-9d2f');
    });

    it('omits an absent committee_uid, so a direct guest is not attributed to a group', () => {
      const direct = registrant({ type: 'direct' });
      Reflect.deleteProperty(direct, 'committee_uid');

      const body = service.stripMetadata(MEETING_UID, direct);

      expect(body).not.toHaveProperty('committee_uid');
    });

    it('drops the response-only committee enrichment rather than echoing it back', () => {
      const body = service.stripMetadata(
        MEETING_UID,
        registrant({ committee_name: 'Technical Steering', committee_role: 'Chair', committee_category: 'Technical' })
      );

      expect(body).not.toHaveProperty('committee_name');
      expect(body).not.toHaveProperty('committee_role');
      expect(body).not.toHaveProperty('committee_category');
    });

    it('normalises a missing host flag to false rather than leaving it undefined', () => {
      const body = service.stripMetadata(MEETING_UID, registrant({ host: undefined as unknown as boolean }));

      expect(body.host).toBe(false);
    });
  });

  describe('getChangedFields', () => {
    // The mirror image of `stripMetadata`: an update body says `null` to erase a stored value, so
    // these fields must be present-and-null instead of omitted. Pinning both halves keeps the
    // asymmetry deliberate rather than something a later cleanup can "tidy" into agreement.
    it('sends null for a cleared field instead of omitting it', () => {
      const body = service.getChangedFields(registrant({ state: 'modified', job_title: null, org_name: '' }));

      expect(body).toHaveProperty('job_title', null);
      expect(body).toHaveProperty('org_name', null);
    });

    it('keeps the meeting id the registrant already carries and never forwards committee_uid', () => {
      const body = service.getChangedFields(registrant({ state: 'modified' }));

      expect(body.meeting_id).toBe(MEETING_UID);
      expect(body).not.toHaveProperty('committee_uid');
    });

    // Upstream treats `user_id` as immutable: leaving it out of an update reads as a change and fails with
    // "user_id cannot be changed". The index record carries it, so it goes back as stored.
    it('sends back the user_id a listed guest is linked to, and omits it when there is none', () => {
      expect(service.getChangedFields(registrant({ state: 'modified', user_id: 'user-123' })).user_id).toBe('user-123');
      expect(service.getChangedFields(registrant({ state: 'modified' }))).not.toHaveProperty('user_id');
    });

    // `username` and `avatar_url` are derived from the linked user, and the Edit Guest form never sent them.
    it('never sends the username or avatar a listed guest carries', () => {
      const body = service.getChangedFields(registrant({ state: 'modified', username: 'guest-a', avatar_url: 'https://avatars.example/guest-a.png' }));

      expect(body).not.toHaveProperty('username');
      expect(body).not.toHaveProperty('avatar_url');
    });
  });
});

// The passcode gates private/restricted meetings server-side; it travels in a header so request
// URLs, which Datadog RUM records as resource events, never carry it.
describe('MeetingService public meeting passcode transport', () => {
  let service: MeetingService;
  let get: ReturnType<typeof vi.fn>;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    get = vi.fn(() => of({}));
    post = vi.fn(() => of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get, post } }] });
    service = TestBed.inject(MeetingService);
  });

  it('sends the getPublicMeeting passcode in the header, not the URL', () => {
    service.getPublicMeeting(MEETING_UID, 'SUPER_SECRET').subscribe();

    const [url, options] = get.mock.calls[0];
    expect(url).not.toContain('SUPER_SECRET');
    expect(options.params).toBeUndefined();
    expect((options.headers as HttpHeaders).get('x-meeting-password')).toBe('SUPER_SECRET');
  });

  it('sends the getPublicMeetingJoinUrl passcode in the header, not the URL', () => {
    service.getPublicMeetingJoinUrl(MEETING_UID, 'SUPER_SECRET', { email: 'dana.reyes@acme-motors.example' }).subscribe();

    const [url, , options] = post.mock.calls[0];
    expect(url).not.toContain('SUPER_SECRET');
    expect(options.params).toBeUndefined();
    expect((options.headers as HttpHeaders).get('x-meeting-password')).toBe('SUPER_SECRET');
  });

  it('sends no passcode header when there is no passcode', () => {
    service.getPublicMeeting(MEETING_UID, null).subscribe();

    expect(get.mock.calls[0][1].headers).toBeUndefined();
  });
});

describe('MeetingService.removeMyMeetingRegistration', () => {
  let service: MeetingService;
  let del: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    del = vi.fn(() => of(undefined));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { delete: del } }] });
    service = TestBed.inject(MeetingService);
  });

  it('sends a body-less DELETE to the self registrant route, with no registrant id from the client', () => {
    service.removeMyMeetingRegistration(MEETING_UID, 'meeting-card').subscribe();

    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toBe(`/api/meetings/${MEETING_UID}/registrants/self`);
  });

  it.each(['meeting-card', 'meeting-join'] as const)('names the %s surface in the removal-source header', (source) => {
    service.removeMyMeetingRegistration(MEETING_UID, source).subscribe();

    expect(del.mock.calls[0][1].headers.get('x-lfx-removal-source')).toBe(source);
  });
});

describe('MeetingService.resendMyMeetingInvitation', () => {
  let service: MeetingService;
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    post = vi.fn(() => of({ message: 'Invitation resent successfully' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { post } }] });
    service = TestBed.inject(MeetingService);
  });

  it('posts to the self resend route, with no registrant id from the client', () => {
    service.resendMyMeetingInvitation(MEETING_UID).subscribe();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(`/api/meetings/${MEETING_UID}/registrants/self/resend`);
    expect(post.mock.calls[0][1]).toEqual({});
  });

  it('sends the occurrence being viewed so the server picks the registration that fits it', () => {
    service.resendMyMeetingInvitation(MEETING_UID, '1700000000').subscribe();

    expect(post.mock.calls[0][1]).toEqual({ occurrence_id: '1700000000' });
  });

  it.each([[undefined], [null], ['']])('sends an empty body when the occurrence is %j', (occurrenceId) => {
    service.resendMyMeetingInvitation(MEETING_UID, occurrenceId).subscribe();

    expect(post.mock.calls[0][1]).toEqual({});
  });

  it('encodes the meeting id into the path', () => {
    service.resendMyMeetingInvitation('a/b?c').subscribe();

    expect(post.mock.calls[0][0]).toBe('/api/meetings/a%2Fb%3Fc/registrants/self/resend');
  });

  it('rethrows an upstream failure to the caller', () => {
    const failure = new Error('nope');
    post.mockReturnValueOnce(throwError(() => failure));
    const error = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    service.resendMyMeetingInvitation(MEETING_UID).subscribe({ error });

    expect(error).toHaveBeenCalledWith(failure);
  });
});

describe('MeetingService removed-registration state', () => {
  let service: MeetingService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { delete: vi.fn(() => of(undefined)) } }] });
    service = TestBed.inject(MeetingService);
  });

  it('records a removal by meeting id and forgets it once the viewer registers again', () => {
    service.markRegistrationRemoved('mtg-1');
    expect(service.removedRegistrationMeetingIds().has('mtg-1')).toBe(true);
    expect(service.removedRegistrationMeetingIds().has('mtg-2')).toBe(false);

    service.clearRemovedRegistration('mtg-1');
    expect(service.removedRegistrationMeetingIds().has('mtg-1')).toBe(false);
  });
});

describe('MeetingService attachment scope overrides', () => {
  const OCCURRENCE_ID = '1893456000';
  let service: MeetingService;
  let get: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  const attachment = (uid: string, occurrenceId?: string) => ({
    uid,
    meeting_id: 'mtg-1',
    type: 'link' as const,
    name: uid,
    created_at: '2030-01-01T00:00:00Z',
    occurrence_id: occurrenceId,
  });

  beforeEach(() => {
    get = vi.fn();
    del = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get, delete: del } }] });
    service = TestBed.inject(MeetingService);
  });

  it('records a saved scope, using an empty value for "all occurrences"', () => {
    service.recordAttachmentScopeChanges([{ uid: 'a', occurrence_id: OCCURRENCE_ID }, { uid: 'b' }]);

    expect(service.attachmentScopeOverrides().get('a')).toBe(OCCURRENCE_ID);
    expect(service.attachmentScopeOverrides().get('b')).toBe('');
  });

  it('keeps an override after a read that still returns the old scope', async () => {
    service.recordAttachmentScopeChanges([{ uid: 'a', occurrence_id: OCCURRENCE_ID }]);
    get.mockReturnValue(of([attachment('a')]));

    await firstValueFrom(service.getMeetingAttachments('mtg-1'));

    expect(service.attachmentScopeOverrides().get('a')).toBe(OCCURRENCE_ID);
  });

  // Each card keeps its own fetched list and only the one that saved refetches, so a read agreeing with the saved scope must
  // not drop the override: the other cards would fall back to their stale snapshot.
  it('keeps an override after a read that already shows the saved scope', async () => {
    service.recordAttachmentScopeChanges([{ uid: 'a', occurrence_id: OCCURRENCE_ID }, { uid: 'b' }]);
    get.mockReturnValue(of([attachment('a', OCCURRENCE_ID), attachment('b')]));

    await firstValueFrom(service.getMeetingAttachments('mtg-1'));

    expect(service.attachmentScopeOverrides().get('a')).toBe(OCCURRENCE_ID);
    expect(service.attachmentScopeOverrides().get('b')).toBe('');
  });

  it('replaces an override when the same attachment is changed again', () => {
    service.recordAttachmentScopeChanges([{ uid: 'a', occurrence_id: OCCURRENCE_ID }]);
    service.recordAttachmentScopeChanges([{ uid: 'a' }]);

    expect(service.attachmentScopeOverrides().get('a')).toBe('');
  });

  describe('recording attachments added and removed', () => {
    it('keeps what was added and removed per meeting', () => {
      service.recordAttachmentChanges('mtg-1', { added: [attachment('a')], deletedUids: ['x'] });
      service.recordAttachmentChanges('mtg-1', { added: [attachment('b')], deletedUids: ['y'] });
      service.recordAttachmentChanges('mtg-2', { added: [attachment('c')] });

      expect(
        service
          .attachmentChanges()
          .get('mtg-1')
          ?.added.map((a) => a.uid)
      ).toEqual(['a', 'b']);
      expect([...(service.attachmentChanges().get('mtg-1')?.deletedUids ?? [])]).toEqual(['x', 'y']);
      expect(
        service
          .attachmentChanges()
          .get('mtg-2')
          ?.added.map((a) => a.uid)
      ).toEqual(['c']);
    });

    it('forgets an addition that is deleted afterwards', () => {
      service.recordAttachmentChanges('mtg-1', { added: [attachment('a')] });
      service.recordAttachmentChanges('mtg-1', { deletedUids: ['a'] });

      expect(service.attachmentChanges().get('mtg-1')?.added).toEqual([]);
    });

    it('records a successful delete from any caller, so an earlier addition is not listed again', async () => {
      service.recordAttachmentChanges('mtg-1', { added: [attachment('a')] });
      del.mockReturnValue(of(undefined));

      await firstValueFrom(service.deleteMeetingAttachment('mtg-1', 'a'));

      expect(service.attachmentChanges().get('mtg-1')?.added).toEqual([]);
      expect([...(service.attachmentChanges().get('mtg-1')?.deletedUids ?? [])]).toEqual(['a']);
    });

    it('does not record a delete that failed', async () => {
      del.mockReturnValue(throwError(() => new Error('rejected')));

      await expect(firstValueFrom(service.deleteMeetingAttachment('mtg-1', 'a'))).rejects.toThrow('rejected');

      expect(service.attachmentChanges().has('mtg-1')).toBe(false);
    });

    it('records nothing for an empty change', () => {
      service.recordAttachmentChanges('mtg-1', { added: [], deletedUids: [] });

      expect(service.attachmentChanges().has('mtg-1')).toBe(false);
    });

    // Each card keeps its own fetched list, so a read agreeing with the change must not drop it for the other cards.
    it('keeps a change after a read that already shows it', async () => {
      service.recordAttachmentChanges('mtg-1', { added: [attachment('a')], deletedUids: ['x'] });
      get.mockReturnValue(of([attachment('a')]));

      await firstValueFrom(service.getMeetingAttachments('mtg-1'));

      expect(
        service
          .attachmentChanges()
          .get('mtg-1')
          ?.added.map((a) => a.uid)
      ).toEqual(['a']);
    });
  });
});

// lfx-self-serve-ops#439: the BFF refuses a registrant batch longer than MEETING_REGISTRANT_BATCH_MAX
// (100) and runs each one's items at bounded concurrency, so the service splits saves into sequential
// requests of MEETING_REGISTRANT_CLIENT_CHUNK_SIZE (25) and merges the responses. Smaller chunks reduce
// serial upstream rounds and timeout risk; they do not enforce an ingress deadline.
describe('MeetingService registrant batch chunking', () => {
  let service: MeetingService;
  let post: ReturnType<typeof vi.fn>;
  let put: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  /** A response that reports every item of the chunk as created, echoing its emails. */
  function allCreated(chunk: CreateMeetingRegistrantRequest[]): BatchRegistrantOperationResponse<MeetingRegistrant> {
    return {
      successes: chunk.map((item) => ({ email: item.email }) as MeetingRegistrant),
      failures: [],
      summary: { total: chunk.length, successful: chunk.length, failed: 0 },
    };
  }

  /** The 400 the BFF answers when every item of a chunk failed upstream — the per-item results ride in the body. */
  function allFailed(chunk: CreateMeetingRegistrantRequest[], message: string): HttpErrorResponse {
    const body: BatchRegistrantOperationResponse<MeetingRegistrant> = {
      successes: [],
      failures: chunk.map((input) => ({ input, error: { message } })),
      summary: { total: chunk.length, successful: 0, failed: chunk.length },
    };
    return new HttpErrorResponse({ status: 400, error: body });
  }

  function guests(count: number): CreateMeetingRegistrantRequest[] {
    return Array.from({ length: count }, (_, i) => ({ meeting_id: MEETING_UID, email: `guest-${i}@acme-motors.example` }) as CreateMeetingRegistrantRequest);
  }

  beforeEach(() => {
    post = vi.fn((_url: string, chunk: CreateMeetingRegistrantRequest[]) => of(allCreated(chunk)));
    put = vi.fn((_url: string, chunk: { uid: string }[]) =>
      of({
        successes: chunk.map((item) => ({ uid: item.uid }) as MeetingRegistrant),
        failures: [],
        summary: { total: chunk.length, successful: chunk.length, failed: 0 },
      })
    );
    del = vi.fn((_url: string, options: { body: string[] }) =>
      of({ successes: options.body, failures: [], summary: { total: options.body.length, successful: options.body.length, failed: 0 } })
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { post, put, delete: del } }] });
    service = TestBed.inject(MeetingService);
  });

  it('sends a batch of exactly the chunk size in a single request', async () => {
    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(25)));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toHaveLength(25);
    expect(response.summary).toEqual({ total: 25, successful: 25, failed: 0 });
  });

  it('splits a larger batch into sequential requests and merges the responses', async () => {
    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(60)));

    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls.map((call) => call[1].length)).toEqual([25, 25, 10]);
    expect(post.mock.calls[1][1][0].email).toBe('guest-25@acme-motors.example');
    expect(response.summary).toEqual({ total: 60, successful: 60, failed: 0 });
    expect(response.successes.map((item) => item.email)).toEqual(guests(60).map((item) => item.email));
  });

  it('waits for each chunk to finish before sending the next', () => {
    const firstChunk = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
    post.mockImplementationOnce(() => firstChunk);

    service.addMeetingRegistrants(MEETING_UID, guests(30)).subscribe();

    expect(post).toHaveBeenCalledTimes(1);
    firstChunk.next(allCreated(guests(25)));
    firstChunk.complete();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('continues after an intermediate request errors and merges successes around the failed chunk', async () => {
    const registrants = guests(60);
    post.mockImplementationOnce((_url: string, chunk: CreateMeetingRegistrantRequest[]) => of(allCreated(chunk)));
    post.mockImplementationOnce(() => throwError(() => new Error('Service unavailable')));

    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, registrants));

    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][1]).toEqual(registrants.slice(50));
    expect(response.summary).toEqual({ total: 60, successful: 35, failed: 25 });
    expect(response.successes.map((item) => item.email)).toEqual([...registrants.slice(0, 25), ...registrants.slice(50)].map((item) => item.email));
    expect(response.failures).toEqual(registrants.slice(25, 50).map((input) => ({ input, error: { message: 'Service unavailable' } })));
  });

  it('errors when the first request fails, as a single request would', async () => {
    const forbidden = new HttpErrorResponse({ status: 403, error: { message: 'Forbidden' } });
    post.mockImplementationOnce(() => throwError(() => forbidden));

    await expect(firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(30)))).rejects.toBe(forbidden);
    expect(post).toHaveBeenCalledTimes(1);
  });

  // A single request carrying all of these would have attempted every item and answered 207, so an
  // all-failed first chunk must not stop the rest from being sent.
  it('merges an all-failed first chunk and still sends the remaining chunks', async () => {
    post.mockImplementationOnce((_url: string, chunk: CreateMeetingRegistrantRequest[]) => throwError(() => allFailed(chunk, 'Already registered')));

    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(30)));

    expect(post).toHaveBeenCalledTimes(2);
    expect(response.summary).toEqual({ total: 30, successful: 5, failed: 25 });
    expect(response.failures[0]).toEqual({ input: guests(30)[0], error: { message: 'Already registered' } });
  });

  it("keeps the BFF's per-item messages when a later chunk fails entirely", async () => {
    post.mockImplementationOnce((_url: string, chunk: CreateMeetingRegistrantRequest[]) => of(allCreated(chunk)));
    post.mockImplementationOnce((_url: string, chunk: CreateMeetingRegistrantRequest[]) => throwError(() => allFailed(chunk, 'Invalid email')));

    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(30)));

    expect(response.summary).toEqual({ total: 30, successful: 25, failed: 5 });
    expect(response.failures.map((failure) => failure.error.message)).toEqual(Array(5).fill('Invalid email'));
  });

  it('still errors on an all-failed batch that fits in one request', async () => {
    const error = allFailed(guests(3), 'Already registered');
    post.mockImplementationOnce(() => throwError(() => error));

    await expect(firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(3)))).rejects.toBe(error);
  });

  it('chunks updates the same way', async () => {
    const updates = Array.from({ length: 30 }, (_, i) => ({ uid: `reg-${i}`, changes: { first_name: 'Alice' } as UpdateMeetingRegistrantRequest }));

    const response = await firstValueFrom(service.updateMeetingRegistrants(MEETING_UID, updates));

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, updates.slice(0, 25)]);
    expect(put.mock.calls[1]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, updates.slice(25)]);
    expect(response.summary).toEqual({ total: 30, successful: 30, failed: 0 });
  });

  it("sends each delete chunk's uids in the request body", async () => {
    const uids = Array.from({ length: 30 }, (_, i) => `reg-${i}`);

    const response = await firstValueFrom(service.deleteMeetingRegistrants(MEETING_UID, uids));

    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls[0]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, { body: uids.slice(0, 25) }]);
    expect(del.mock.calls[1]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, { body: uids.slice(25) }]);
    expect(response.summary).toEqual({ total: 30, successful: 30, failed: 0 });
  });
});

// #501: a meeting just created by this user can 403/404 for a few seconds while the ITX index /
// FGA organizer tuple it reads from catches up with the write. getMeetingDetail is the one place
// both the writerGuard's `meetings` probe and this edit-page load go through, so retrying there
// (via retryPropagationLag, unit-tested on its own in http-error.utils.spec.ts) fixes the race for
// both callers at once. These tests pin the end-to-end wiring: the retry only applies to an id this
// client just created (via createMeeting), the cache, and that a terminal failure logs exactly once
// (not once per attempt). A plain read of an id nobody just created still fails on the first 403/404
// — see 'does not retry a 403 for a meeting id nobody just created'.
describe('MeetingService.getMeetingDetail propagation-lag retry (#501)', () => {
  let get: ReturnType<typeof vi.fn>;
  let post: ReturnType<typeof vi.fn>;
  let service: MeetingService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    get = vi.fn();
    post = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get, post } }] });
    service = TestBed.inject(MeetingService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // `getMeetingDetail` calls `this.http.get(...)` once and pipes `retryPropagationLag()` directly
  // onto that Observable, so a retry resubscribes to the SAME Observable instance rather than
  // re-invoking `get()` — exactly how a real HttpClient Observable behaves (cold: each subscribe
  // re-fires the request). These mocks track subscriptions, not calls to `get`.
  function flakyGet(status: number, failuresBeforeSuccess: number, value: unknown) {
    let attempts = 0;
    return new Observable((subscriber) => {
      attempts += 1;
      if (attempts <= failuresBeforeSuccess) {
        subscriber.error(new HttpErrorResponse({ status }));
        return;
      }
      subscriber.next(value);
      subscriber.complete();
    });
  }

  function countingErrorGet(status: number, onSubscribe: () => void) {
    return new Observable((subscriber) => {
      onSubscribe();
      subscriber.error(new HttpErrorResponse({ status }));
    });
  }

  /** Puts `id` in the service's recently-created window, the way a real create-then-edit navigation does. */
  async function createMeeting(id: string): Promise<void> {
    post.mockReturnValueOnce(of({ id, project_uid: 'project-1' }));
    await firstValueFrom(service.createMeeting({ project_uid: 'project-1' } as never));
  }

  it('retries a 403 that resolves before the schedule is exhausted, never surfacing the error', async () => {
    await createMeeting(MEETING_UID);
    const meeting = { id: MEETING_UID, project_uid: 'project-1' };
    get.mockReturnValue(flakyGet(403, 1, meeting));

    const result = firstValueFrom(service.getMeetingDetail(MEETING_UID));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual(meeting);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('logs once (not once per attempt) and evicts the cache on a terminal 404', async () => {
    await createMeeting(MEETING_UID);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    get.mockReturnValue(countingErrorGet(404, () => (attempts += 1)));

    // `.rejects` attaches its handler synchronously, before the timers below resolve the
    // rejection — asserting on a separately-awaited promise would otherwise let the rejection
    // go briefly unhandled and fail the run.
    const assertion = expect(firstValueFrom(service.getMeetingDetail(MEETING_UID))).rejects.toBeInstanceOf(HttpErrorResponse);
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    await assertion;

    // 1 initial attempt + 2 retries (PROPAGATION_LAG_RETRY_DELAYS_MS has 2 entries) = 3 subscriptions
    // to the same source Observable, but only the single terminal failure reaches the logging catchError.
    expect(attempts).toBe(3);
    expect(consoleError).toHaveBeenCalledTimes(1);

    // The cache was evicted on the terminal failure, so a later call issues a fresh request
    // rather than replaying the same rejected observable.
    get.mockReturnValue(of({ id: MEETING_UID, project_uid: 'project-1' }));
    await expect(firstValueFrom(service.getMeetingDetail(MEETING_UID))).resolves.toEqual({ id: MEETING_UID, project_uid: 'project-1' });

    consoleError.mockRestore();
  });

  it('does not retry a 403 for a meeting id nobody just created', async () => {
    let attempts = 0;
    get.mockReturnValue(countingErrorGet(403, () => (attempts += 1)));

    await expect(firstValueFrom(service.getMeetingDetail(MEETING_UID))).rejects.toBeInstanceOf(HttpErrorResponse);

    // No retry schedule applied: a single subscription, failing immediately — a genuine denial
    // (or a stale/unrelated id) must not pay the propagation-lag retry delay.
    expect(attempts).toBe(1);
  });
});
