// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type {
  BatchRegistrantOperationResponse,
  CreateMeetingRegistrantRequest,
  MeetingRegistrant,
  MeetingRegistrantWithState,
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
// (100), so the service splits larger saves into sequential requests and merges the responses.
describe('MeetingService registrant batch chunking', () => {
  let service: MeetingService;
  let post: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  /** A response that reports every item of the chunk as created, echoing its emails. */
  function allCreated(chunk: CreateMeetingRegistrantRequest[]): BatchRegistrantOperationResponse<MeetingRegistrant> {
    return {
      successes: chunk.map((item) => ({ email: item.email }) as MeetingRegistrant),
      failures: [],
      summary: { total: chunk.length, successful: chunk.length, failed: 0 },
    };
  }

  function guests(count: number): CreateMeetingRegistrantRequest[] {
    return Array.from({ length: count }, (_, i) => ({ meeting_id: MEETING_UID, email: `guest-${i}@acme-motors.example` }) as CreateMeetingRegistrantRequest);
  }

  beforeEach(() => {
    post = vi.fn((_url: string, chunk: CreateMeetingRegistrantRequest[]) => of(allCreated(chunk)));
    del = vi.fn((_url: string, options: { body: string[] }) =>
      of({ successes: options.body, failures: [], summary: { total: options.body.length, successful: options.body.length, failed: 0 } })
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { post, delete: del } }] });
    service = TestBed.inject(MeetingService);
  });

  it('sends a batch of exactly the maximum in a single request', async () => {
    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(100)));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toHaveLength(100);
    expect(response.summary).toEqual({ total: 100, successful: 100, failed: 0 });
  });

  it('splits a larger batch into sequential requests and merges the responses', async () => {
    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(150)));

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1]).toHaveLength(100);
    expect(post.mock.calls[1][1]).toHaveLength(50);
    expect(post.mock.calls[1][1][0].email).toBe('guest-100@acme-motors.example');
    expect(response.summary).toEqual({ total: 150, successful: 150, failed: 0 });
    expect(response.successes.map((item) => item.email)).toEqual(guests(150).map((item) => item.email));
  });

  it('waits for each chunk to finish before sending the next', () => {
    const firstChunk = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
    post.mockImplementationOnce(() => firstChunk);

    service.addMeetingRegistrants(MEETING_UID, guests(150)).subscribe();

    expect(post).toHaveBeenCalledTimes(1);
    firstChunk.next(allCreated(guests(100)));
    firstChunk.complete();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('keeps the landed chunk and reports the failed chunk as failures when a later request errors', async () => {
    post.mockImplementationOnce((_url: string, chunk: CreateMeetingRegistrantRequest[]) => of(allCreated(chunk)));
    post.mockImplementationOnce(() => throwError(() => new Error('Service unavailable')));

    const response = await firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(150)));

    expect(response.summary).toEqual({ total: 150, successful: 100, failed: 50 });
    expect(response.successes).toHaveLength(100);
    expect(response.failures).toHaveLength(50);
    expect(response.failures[0]).toEqual({ input: guests(150)[100], error: { message: 'Service unavailable' } });
  });

  it('errors when the first request fails, as a single request would', async () => {
    const forbidden = new Error('Forbidden');
    post.mockImplementationOnce(() => throwError(() => forbidden));

    await expect(firstValueFrom(service.addMeetingRegistrants(MEETING_UID, guests(150)))).rejects.toBe(forbidden);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("sends each delete chunk's uids in the request body", async () => {
    const uids = Array.from({ length: 150 }, (_, i) => `reg-${i}`);

    const response = await firstValueFrom(service.deleteMeetingRegistrants(MEETING_UID, uids));

    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls[0]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, { body: uids.slice(0, 100) }]);
    expect(del.mock.calls[1]).toEqual([`/api/meetings/${MEETING_UID}/registrants`, { body: uids.slice(100) }]);
    expect(response.summary).toEqual({ total: 150, successful: 150, failed: 0 });
  });
});
