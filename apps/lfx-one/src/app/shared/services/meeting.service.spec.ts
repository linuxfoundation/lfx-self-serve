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
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// "Could not load" and "has not answered" are different answers for the V2 status pill (E2-04).
describe('MeetingService own RSVP', () => {
  let service: MeetingService;
  let get: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    get = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get } }] });
    service = TestBed.inject(MeetingService);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('scopes the request to an occurrence when one is given', async () => {
    get.mockReturnValue(of(null));

    await firstValueFrom(service.getMeetingRsvpForCurrentUserOrFail(MEETING_UID, '1760000000'));

    expect(get).toHaveBeenCalledWith(`/api/meetings/${MEETING_UID}/rsvp/me`, { params: { occurrenceId: '1760000000' } });
  });

  it('asks for series-wide answers only with allDatesOnly and no occurrence, the occurrence winning otherwise', async () => {
    get.mockReturnValue(of(null));

    await firstValueFrom(service.getMeetingRsvpForCurrentUserOrFail(MEETING_UID, undefined, true));
    expect(get).toHaveBeenLastCalledWith(`/api/meetings/${MEETING_UID}/rsvp/me`, { params: { rsvp_scope: 'all' } });

    await firstValueFrom(service.getMeetingRsvpForCurrentUserOrFail(MEETING_UID, '1760000000', true));
    expect(get).toHaveBeenLastCalledWith(`/api/meetings/${MEETING_UID}/rsvp/me`, { params: { occurrenceId: '1760000000' } });
  });

  it('rethrows a failure from the strict variant', async () => {
    get.mockReturnValue(throwError(() => ({ status: 500 })));

    await expect(firstValueFrom(service.getMeetingRsvpForCurrentUserOrFail(MEETING_UID))).rejects.toEqual({ status: 500 });
    expect(console.error).toHaveBeenCalled();
  });

  it('keeps reading a failure as null in the original method', async () => {
    get.mockReturnValue(throwError(() => ({ status: 500 })));

    await expect(firstValueFrom(service.getMeetingRsvpForCurrentUser(MEETING_UID))).resolves.toBeNull();
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
    service.removeMyMeetingRegistration(MEETING_UID).subscribe();

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(`/api/meetings/${MEETING_UID}/registrants/self`);
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
