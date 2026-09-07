// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UserService's import graph transitively pulls in @angular/common (partially compiled); load the
// JIT compiler so those injectables resolve under vitest (mirrors auth.middleware.spec.ts).
import '@angular/compiler';

import { PROFILE_VISIBILITY_DEFAULTS, VISIBILITY_PREFERENCE_APP_NAME, VISIBILITY_PREFERENCE_NAME } from '@lfx-one/shared/constants';
import {
  ApiGatewayUserProfile,
  Meeting,
  MeetingRegistrant,
  ProfileVisibilitySections,
  ProfileVisibilityUpdateRequest,
  QueryServiceResponse,
  UserMetadata,
  UserServicePreference,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, getPendingActionSurveys, getMyPendingInvitations, getUsernameFromAuth } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getPendingActionSurveys: vi.fn(),
  getMyPendingInvitations: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));

// Stub the constructor collaborators (NATS, Snowflake, etc.) so `new UserService()` is cheap and
// side-effect-free — validateUserMetadata is pure and synchronous and touches none of them.
vi.mock('./nats.service', () => ({ NatsService: vi.fn() }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({})) } }));
vi.mock('./meeting.service', () => ({ MeetingService: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getPendingActionSurveys = getPendingActionSurveys;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({ AccessCheckService: vi.fn() }));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getMyPendingInvitations = getMyPendingInvitations;
  },
}));
vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth,
  getEffectiveEmail: vi.fn(),
  stripAuthPrefix: (value: string) => value,
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch: vi.fn() }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl: vi.fn(() => 'https://gw.test/user-service/v1') }));

import { MicroserviceError } from '../errors';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { UserService } from './user.service';

describe('UserService.validateUserMetadata', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  describe('bio length cap (code points, not UTF-16 units)', () => {
    it('accepts a bio at the 2000-code-point limit', () => {
      expect(service.validateUserMetadata({ bio: 'a'.repeat(2000) } as UserMetadata)).toBe(true);
    });

    it('rejects a bio one code point over the limit', () => {
      expect(() => service.validateUserMetadata({ bio: 'a'.repeat(2001) } as UserMetadata)).toThrow(/Bio is too long/);
    });

    it('accepts 2000 emoji (String.length 4000) — the code-point cap matches the auth-service rune cap', () => {
      const bio = '😀'.repeat(2000);
      expect(bio.length).toBe(4000);
      expect(service.validateUserMetadata({ bio } as UserMetadata)).toBe(true);
    });

    it('rejects 2001 emoji, counting code points rather than UTF-16 units', () => {
      expect(() => service.validateUserMetadata({ bio: '😀'.repeat(2001) } as UserMetadata)).toThrow(/Bio is too long/);
    });

    it('accepts an empty bio (optional field)', () => {
      expect(service.validateUserMetadata({ bio: '' } as UserMetadata)).toBe(true);
    });

    it('accepts metadata without a bio', () => {
      expect(service.validateUserMetadata({} as UserMetadata)).toBe(true);
    });

    it('rejects a non-string bio (e.g. an array from an untyped req.body) with a clear message', () => {
      expect(() => service.validateUserMetadata({ bio: ['a', 'b'] } as unknown as UserMetadata)).toThrow('Bio must be a string');
    });

    it('rejects a numeric bio rather than throwing a raw "not iterable" TypeError', () => {
      expect(() => service.validateUserMetadata({ bio: 42 } as unknown as UserMetadata)).toThrow('Bio must be a string');
    });
  });
});

// Exercises the private visibility helpers through their public callers (per the public-interface
// convention): getApiGatewayProfile is spied; preference reads/writes go through mocked gatewayFetch.
describe('UserService profile visibility', () => {
  const req = { apiGatewayToken: 'gw-token' } as unknown as Request;
  // Untyped mock handle — gatewayFetch is generic, so a precise Mock type fights the return inference.
  const gw = gatewayFetch as unknown as ReturnType<typeof vi.fn>;

  let service: UserService;

  // Minimal API-gateway profile double; only ID / IsPublic / Account.ID are read downstream.
  function mockProfile(overrides: { ID?: string | null; IsPublic?: boolean } = {}): void {
    const profile = { ID: 'sfid-1', IsPublic: false, Account: { ID: 'acct-1' }, ...overrides };
    vi.spyOn(service, 'getApiGatewayProfile').mockResolvedValue(profile as unknown as ApiGatewayUserProfile);
  }

  // A stored `visibility` preference row. Name/AppName MUST match the constants or
  // fetchVisibilityPreference's defensive find() won't select it (treated as "no preference").
  function pref(value: string | undefined, id = 'pref-1'): UserServicePreference {
    return {
      ID: id,
      AppName: VISIBILITY_PREFERENCE_APP_NAME,
      Name: VISIBILITY_PREFERENCE_NAME,
      Type: 'json',
      System: false,
      Value: value,
    } as UserServicePreference;
  }

  // Route the gateway mock: preference reads return `existing` (or an empty list), POSTs create,
  // everything else (PATCH /me, PATCH preferences) resolves. Tests override for race/error paths.
  function routeGateway(existing: UserServicePreference | null): void {
    gw.mockImplementation(async (_req, url, options) => {
      const method = options.method ?? 'GET';
      if (method === 'GET' && url.includes('/preferences')) {
        return { Data: existing ? [existing] : [] };
      }
      if (method === 'POST' && url.includes('/preferences')) {
        return { ID: 'created-id' };
      }
      return null;
    });
  }

  // The section map the service serialized into the preference write (POST or PATCH).
  function persistedSections(): ProfileVisibilitySections {
    const call = gw.mock.calls.find((c) => (c[2].method === 'POST' || c[2].method === 'PATCH') && c[1].includes('/preferences'));
    if (!call) {
      throw new Error('no preference write call was captured');
    }
    return JSON.parse((call[2].body as { Value: string }).Value);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    gw.mockReset();
    service = new UserService();
  });

  describe('getProfileVisibility → parseVisibilitySections', () => {
    it('fails closed to all-false defaults when no preference is stored', async () => {
      mockProfile({ IsPublic: false });
      routeGateway(null);

      const result = await service.getProfileVisibility(req);

      expect(result.sections).toEqual({ ...PROFILE_VISIBILITY_DEFAULTS });
      expect(result.preferenceId).toBeNull();
      expect(result.isPublic).toBe(false);
    });

    it('fails closed to defaults when the stored value is malformed JSON', async () => {
      mockProfile();
      routeGateway(pref('{ not valid json'));

      const result = await service.getProfileVisibility(req);

      expect(result.sections).toEqual({ ...PROFILE_VISIBILITY_DEFAULTS });
    });

    it('merges stored booleans over defaults, ignoring unknown keys and non-boolean values', async () => {
      mockProfile({ IsPublic: true });
      // personalInfo is a non-boolean (must stay its default false) and unknownKey is not a known
      // section (must be dropped); only the strict-boolean known keys are applied.
      routeGateway(pref(JSON.stringify({ basic: true, personalInfo: 'yes', skills: true, unknownKey: true })));

      const result = await service.getProfileVisibility(req);

      expect(result.sections).toEqual({ ...PROFILE_VISIBILITY_DEFAULTS, basic: true, skills: true });
      expect(result.isPublic).toBe(true);
      expect(result.preferenceId).toBe('pref-1');
    });
  });

  describe('Salesforce ID guard', () => {
    // Both public methods fail fast with a 502 when the gateway profile lacks an ID, rather than
    // issuing preference calls against an undefined sfid.
    it('rejects getProfileVisibility with 502 when the gateway profile has no ID', async () => {
      mockProfile({ ID: null });

      await expect(service.getProfileVisibility(req)).rejects.toMatchObject({ statusCode: 502 });
    });

    it('rejects updateProfileVisibility with 502 when the gateway profile has no ID', async () => {
      mockProfile({ ID: null });

      await expect(
        service.updateProfileVisibility(req, { isPublic: true, sections: { basic: true } } as unknown as ProfileVisibilityUpdateRequest)
      ).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  describe('updateProfileVisibility → sanitizeVisibilitySections', () => {
    it('coerces non-boolean values to false and drops unknown keys before persisting', async () => {
      mockProfile({ IsPublic: true }); // flag unchanged → only the preference is written
      routeGateway(pref(undefined));

      const result = await service.updateProfileVisibility(req, {
        isPublic: true,
        sections: { basic: true, personalInfo: 'yes', skills: true, unknownKey: true },
      } as unknown as ProfileVisibilityUpdateRequest);

      const expected = { ...PROFILE_VISIBILITY_DEFAULTS, basic: true, skills: true };
      expect(persistedSections()).toEqual(expected);
      expect(result.sections).toEqual(expected);
    });

    it('persists all-false defaults when the request omits sections', async () => {
      mockProfile({ IsPublic: true });
      routeGateway(pref(undefined));

      await service.updateProfileVisibility(req, { isPublic: false } as ProfileVisibilityUpdateRequest);

      expect(persistedSections()).toEqual({ ...PROFILE_VISIBILITY_DEFAULTS });
    });
  });

  describe('updateProfileVisibility → upsertVisibilityPreference', () => {
    const body = { isPublic: true, sections: { basic: true } } as unknown as ProfileVisibilityUpdateRequest;

    it('PATCHes the existing preference (no POST) and returns its id', async () => {
      mockProfile({ IsPublic: true });
      routeGateway(pref(undefined, 'existing-id'));

      const result = await service.updateProfileVisibility(req, body);

      expect(result.preferenceId).toBe('existing-id');
      expect(gw.mock.calls.some((c) => c[2].method === 'POST')).toBe(false);
      expect(gw.mock.calls.some((c) => c[2].method === 'PATCH' && c[1].includes('/preferences/existing-id'))).toBe(true);
    });

    it('POSTs a new preference when none exists and returns the created id', async () => {
      mockProfile({ IsPublic: true });
      routeGateway(null);

      const result = await service.updateProfileVisibility(req, body);

      expect(result.preferenceId).toBe('created-id');
      expect(gw.mock.calls.some((c) => c[2].method === 'POST' && c[1].endsWith('/preferences'))).toBe(true);
    });

    it('falls back to fetch + PATCH when the POST races into a 409', async () => {
      mockProfile({ IsPublic: true });
      const existing = pref(undefined, 'raced-id');
      let prefGets = 0;
      gw.mockImplementation(async (_req, url, options) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          prefGets += 1;
          // First read (applySections) sees nothing; the post-409 refetch finds the racing row.
          return { Data: prefGets === 1 ? [] : [existing] };
        }
        if (method === 'POST' && url.includes('/preferences')) {
          throw new MicroserviceError('already exists', 409, 'CONFLICT', { operation: 'update_profile_visibility', service: 'user_service' });
        }
        return null;
      });

      const result = await service.updateProfileVisibility(req, body);

      expect(result.preferenceId).toBe('raced-id');
      expect(prefGets).toBe(2);
      expect(gw.mock.calls.some((c) => c[2].method === 'PATCH' && c[1].includes('/preferences/raced-id'))).toBe(true);
    });

    it('rethrows a non-409 POST failure instead of retrying', async () => {
      mockProfile({ IsPublic: true });
      gw.mockImplementation(async (_req, url, options) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          return { Data: [] };
        }
        if (method === 'POST' && url.includes('/preferences')) {
          throw new MicroserviceError('boom', 500, 'CREATE_FAILED', { operation: 'update_profile_visibility', service: 'user_service' });
        }
        return null;
      });

      await expect(service.updateProfileVisibility(req, body)).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  describe('updateProfileVisibility write ordering', () => {
    // Records the order of upstream writes so we can assert the partial-failure ordering guards.
    // Preference reads return empty and are not recorded — only the two writes matter.
    function recordOrder(): string[] {
      const order: string[] = [];
      gw.mockImplementation(async (_req, url, options) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          return { Data: [] };
        }
        if (url.endsWith('/me')) {
          order.push('isPublic');
          return null;
        }
        order.push('sections');
        return method === 'POST' ? { ID: 'created-id' } : null;
      });
      return order;
    }

    it('persists sections before opening the IsPublic gate when becoming public', async () => {
      mockProfile({ IsPublic: false });
      const order = recordOrder();

      await service.updateProfileVisibility(req, { isPublic: true, sections: { basic: true } } as unknown as ProfileVisibilityUpdateRequest);

      expect(order).toEqual(['sections', 'isPublic']);
    });

    it('hides the profile (IsPublic) before persisting sections when becoming private', async () => {
      mockProfile({ IsPublic: true });
      const order = recordOrder();

      await service.updateProfileVisibility(req, { isPublic: false, sections: {} } as unknown as ProfileVisibilityUpdateRequest);

      expect(order).toEqual(['isPublic', 'sections']);
    });
  });

  describe('updateProfileVisibility IsPublic payload', () => {
    it('sends the next IsPublic and the profile AccountID in the /me PATCH when the flag changes', async () => {
      mockProfile({ IsPublic: false }); // Account.ID defaults to 'acct-1'
      routeGateway(null);

      await service.updateProfileVisibility(req, { isPublic: true, sections: { basic: true } } as unknown as ProfileVisibilityUpdateRequest);

      const meCall = gw.mock.calls.find((c) => c[2].method === 'PATCH' && c[1].endsWith('/me'));
      expect(meCall?.[2].body).toEqual({ IsPublic: true, AccountID: 'acct-1' });
    });
  });
});

function queryPage<T>(items: T[]): QueryServiceResponse<T> {
  return { resources: items.map((data, index) => ({ id: `item:${index}`, data })) } as QueryServiceResponse<T>;
}

describe('UserService.getPendingActions RSVP gating (GH-1951)', () => {
  const req = {} as unknown as Request;
  const email = 'invitee@example.com';
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  let service: UserService;

  beforeEach(() => {
    proxyRequest.mockReset();
    getPendingActionSurveys.mockReset();
    getMyPendingInvitations.mockReset();
    getUsernameFromAuth.mockReset();

    getPendingActionSurveys.mockResolvedValue([]);
    getMyPendingInvitations.mockResolvedValue([]);
    getUsernameFromAuth.mockResolvedValue('testuser');

    service = new UserService();
  });

  it('emits a Set RSVP action only for meetings whose indexed invite-response flag is true', async () => {
    // Indexed query-service docs carry `use_new_invite_email_address`, not the ITX field.
    // Leaving `is_invite_responses_enabled` unset proves getUserMeetings normalization is wired
    // into this path — without it both meetings would skip RSVP actions.
    const legacyMeeting: Partial<Meeting> = {
      id: 'legacy-meeting',
      title: 'Legacy Board',
      start_time: tomorrow,
      duration: 60,
      use_new_invite_email_address: false,
    };
    const trackedMeeting: Partial<Meeting> = {
      id: 'tracked-meeting',
      title: 'Tracked Board',
      start_time: tomorrow,
      duration: 60,
      use_new_invite_email_address: true,
    };
    const registrants: Partial<MeetingRegistrant>[] = [
      { uid: 'reg-legacy', meeting_id: 'legacy-meeting' },
      { uid: 'reg-tracked', meeting_id: 'tracked-meeting' },
    ];

    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      switch (params?.type) {
        case 'v1_meeting':
          return queryPage([legacyMeeting, trackedMeeting]);
        case 'v1_meeting_registrant':
          return queryPage(registrants);
        default:
          return queryPage([]);
      }
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const rsvpActions = actions.filter((action) => action.type === 'RSVP');

    expect(rsvpActions).toHaveLength(1);
    expect(rsvpActions[0].meetingUid).toBe('tracked-meeting');
    expect(rsvpActions[0].buttonText).toBe('Set RSVP');
    expect(actions.filter((action) => action.type === 'Agenda').map((action) => action.text)).toEqual([
      'Review Legacy Board Agenda and Materials',
      'Review Tracked Board Agenda and Materials',
    ]);
    expect(queriedTypes()).toEqual(expect.arrayContaining(['v1_meeting', 'v1_meeting_registrant', 'v1_meeting_rsvp']));
  });

  it('skips RSVP and registrant scans when every in-window meeting predates invite-response tracking', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      if (params?.type === 'v1_meeting') {
        return queryPage([
          {
            id: 'legacy-meeting',
            title: 'Legacy Board',
            start_time: tomorrow,
            duration: 60,
            use_new_invite_email_address: false,
          } satisfies Partial<Meeting>,
        ]);
      }
      return queryPage([]);
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.filter((action) => action.type === 'RSVP')).toHaveLength(0);
    expect(actions.some((action) => action.type === 'Agenda')).toBe(true);
    expect(queriedTypes()).not.toContain('v1_meeting_registrant');
    expect(queriedTypes()).not.toContain('v1_meeting_rsvp');
  });
});

function queriedTypes(): string[] {
  return proxyRequest.mock.calls.map((call) => (call[4] as { type?: string } | undefined)?.type).filter((type): type is string => !!type);
}
