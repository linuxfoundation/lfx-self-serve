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

const { proxyRequest, getMyPendingInvitations, getUsernameFromAuth, getMyFormationWork, isImpersonating, getEffectiveEmail } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getMyPendingInvitations: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  getMyFormationWork: vi.fn(),
  isImpersonating: vi.fn(() => false),
  getEffectiveEmail: vi.fn(),
}));

// Stub the constructor collaborators (NATS, Snowflake, etc.) so `new UserService()` is cheap and
// side-effect-free — validateUserMetadata is pure and synchronous and touches none of them.
vi.mock('./nats.service', () => ({ NatsService: vi.fn() }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({})) } }));
vi.mock('./meeting.service', () => ({ MeetingService: vi.fn() }));
vi.mock('./project.service', () => ({ ProjectService: vi.fn() }));
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
vi.mock('./formation.service', () => ({
  formationService: { getMyFormationWork },
}));
vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth,
  getEffectiveEmail,
  getRawEffectiveEmail: vi.fn(),
  stripAuthPrefix: (value: string) => value,
  isImpersonating,
  // Composed from the mocks above (stripAuthPrefix is the identity here) so per-test identity
  // control is unchanged for the real survey/vote response helpers running under this suite.
  resolveUserIdentity: async (req: Request) => ({ email: getEffectiveEmail(req), username: await getUsernameFromAuth(req) }),
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
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { logger } from './logger.service';
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
    isImpersonating.mockReset().mockReturnValue(false);
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

  // #2400 review: the impersonator's req.apiGatewayToken must never resolve the target's profile
  // or preference — getProfileVisibility (the only read left open during impersonation) has to swap
  // in the target's bearer token, the same override enrollment.service.ts uses.
  describe('getProfileVisibility token resolution during impersonation', () => {
    it('resolves the profile and preference with the target bearer token while impersonating', async () => {
      const impersonatedReq = { apiGatewayToken: 'impersonator-gw-token', bearerToken: 'target-bearer-token' } as unknown as Request;
      isImpersonating.mockReturnValue(true);
      mockProfile({ IsPublic: true });
      routeGateway(pref(JSON.stringify({ basic: true })));

      await service.getProfileVisibility(impersonatedReq);

      expect(service.getApiGatewayProfile).toHaveBeenCalledWith(impersonatedReq, 'target-bearer-token');
      const prefFetchCall = gw.mock.calls.find((c) => (c[2].method ?? 'GET') === 'GET' && (c[1] as string).includes('/preferences'));
      expect(prefFetchCall?.[2].bearerToken).toBe('target-bearer-token');
    });

    it('leaves the default apiGatewayToken in place when not impersonating', async () => {
      mockProfile();
      routeGateway(null);

      await service.getProfileVisibility(req);

      expect(service.getApiGatewayProfile).toHaveBeenCalledWith(req, undefined);
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

// lfx-self-serve-ops#183: the v1 upsert must never break email verification — every failure mode
// (missing gateway token, upstream 4xx/5xx, transport throw) resolves false + WARN, never throws.
describe('UserService.syncVerifiedEmailToUserService', () => {
  const req = { apiGatewayToken: 'gw-token' } as unknown as Request;
  const gw = gatewayFetch as unknown as ReturnType<typeof vi.fn>;
  const baseUrl = getUserServiceBaseUrl as unknown as ReturnType<typeof vi.fn>;
  const warn = logger.warning as unknown as ReturnType<typeof vi.fn>;

  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  it('PATCHes the address as Active+IsVerified with a redacted response and returns true on success', async () => {
    gw.mockResolvedValue(null);

    const result = await service.syncVerifiedEmailToUserService(req, 'secondary@example.com');

    expect(result).toBe(true);
    expect(gw).toHaveBeenCalledWith(req, 'https://gw.test/user-service/v1/me/emails', {
      operation: 'sync_verified_email',
      service: 'user_service',
      errorMessage: 'Verified email sync failed',
      errorCode: 'EMAIL_SYNC_UPSERT_FAILED',
      method: 'PATCH',
      body: { Emails: [{ EmailAddress: 'secondary@example.com', IsVerified: true, Active: true }] },
      redactResponseBody: true,
    });
  });

  it('skips with a warning and returns false when the request carries no API Gateway token', async () => {
    const result = await service.syncVerifiedEmailToUserService({} as unknown as Request, 'secondary@example.com');

    expect(result).toBe(false);
    expect(gw).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it.each([409, 500])('returns false with a warning when the upstream upsert fails (%i)', async (statusCode) => {
    gw.mockRejectedValue(new MicroserviceError('boom', statusCode, 'EMAIL_SYNC_UPSERT_FAILED', { operation: 'sync_verified_email', service: 'user_service' }));

    const result = await service.syncVerifiedEmailToUserService(req, 'secondary@example.com');

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('returns false with a warning when the fetch layer throws', async () => {
    gw.mockRejectedValue(new Error('socket hangup'));

    const result = await service.syncVerifiedEmailToUserService(req, 'secondary@example.com');

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  // Pins the never-throws contract against API_GW_AUDIENCE misconfiguration — getUserServiceBaseUrl
  // throws when the env var is unset, and every sibling method calls it outside any try.
  it('returns false with a warning when the gateway base URL cannot resolve (API_GW_AUDIENCE unset)', async () => {
    baseUrl.mockImplementationOnce(() => {
      throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
        operation: 'sync_verified_email',
        service: 'user_service',
      });
    });

    const result = await service.syncVerifiedEmailToUserService(req, 'secondary@example.com');

    expect(result).toBe(false);
    expect(gw).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
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
    getMyPendingInvitations.mockReset();
    getUsernameFromAuth.mockReset();
    getMyFormationWork.mockReset();

    getMyPendingInvitations.mockResolvedValue([]);
    getUsernameFromAuth.mockResolvedValue('testuser');
    getMyFormationWork.mockResolvedValue({ formations: [], items: [], state: 'complete' });

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

describe('UserService.getPendingActions formation items (GH-1956)', () => {
  const req = {} as unknown as Request;
  const email = 'assignee@example.com';

  const formationRow = {
    item_uid: 'item-1',
    template_item_key: 'legal-review',
    project_uid: 'project-1',
    project_slug: 'acme-project',
    project_name: 'Acme Project',
    title: 'Complete legal review',
    status: 'not_started',
    is_gating: true,
    due_date: null,
    can_write: true,
  };

  let service: UserService;

  beforeEach(() => {
    proxyRequest.mockReset();
    getMyPendingInvitations.mockReset();
    getUsernameFromAuth.mockReset();
    getMyFormationWork.mockReset();

    proxyRequest.mockImplementation(() => queryPage([]));
    getMyPendingInvitations.mockResolvedValue([]);
    getUsernameFromAuth.mockResolvedValue('testuser');
    getMyFormationWork.mockResolvedValue({ formations: [], items: [formationRow], state: 'complete' });

    service = new UserService();
  });

  it('includes formation item actions, placed immediately after invitations, on the unscoped Me-lens path', async () => {
    getMyPendingInvitations.mockResolvedValue([{ uid: 'invite-1', committee_uid: 'c-1', committee_name: 'Board' }]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(getMyFormationWork).toHaveBeenCalledWith(req, 'testuser', { includeFormations: false });
    const types = actions.map((a) => a.type);
    const invitationIndex = types.indexOf('Invitation');
    const formationIndex = types.indexOf('FormationItem');
    expect(formationIndex).toBeGreaterThan(-1);
    expect(formationIndex).toBe(invitationIndex + 1);

    const formationAction = actions[formationIndex];
    expect(formationAction).toMatchObject({
      formationItemUid: 'item-1',
      formationProjectUid: 'project-1',
      buttonText: 'View item',
    });
  });

  it('does not call getMyFormationWork on a project/foundation-lens request', async () => {
    await service.getPendingActions(req, 'project-1', email, 'acme-project');
    expect(getMyFormationWork).not.toHaveBeenCalled();
  });

  it('degrades to no formation actions when the source errors, without failing the whole aggregation', async () => {
    getMyFormationWork.mockRejectedValue(new Error('boom'));

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((a) => a.type === 'FormationItem')).toBe(false);
  });

  it('skips the call when no username can be resolved from auth', async () => {
    getUsernameFromAuth.mockResolvedValue(null);

    await service.getPendingActions(req, undefined, email, undefined);

    expect(getMyFormationWork).not.toHaveBeenCalled();
  });
});

describe('UserService.getPendingActions pending surveys (GH-2987)', () => {
  const req = {} as unknown as Request;
  const email = 'invitee@example.com';

  // Open = survey_status 'sent' with a future cutoff (getSurveyDisplayStatus); unanswered = empty
  // response_datetime (helper filter). The link host is on SURVEY_LINK_ALLOWLIST.
  const openSurveyRow = {
    uid: 'resp-open',
    survey_uid: 'survey-1',
    survey_title: 'Board Satisfaction Survey',
    survey_status: 'sent',
    survey_cutoff_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    survey_link: 'https://www.research.net/r/ABC123',
    response_datetime: '',
    project: { name: 'Acme Project' },
  };

  let service: UserService;

  beforeEach(() => {
    proxyRequest.mockReset();
    getMyPendingInvitations.mockReset();
    getUsernameFromAuth.mockReset();
    getEffectiveEmail.mockReset();
    getMyFormationWork.mockReset();

    proxyRequest.mockImplementation(() => queryPage([]));
    getMyPendingInvitations.mockResolvedValue([]);
    getUsernameFromAuth.mockResolvedValue('testuser');
    getEffectiveEmail.mockReturnValue(email);
    getMyFormationWork.mockResolvedValue({ formations: [], items: [], state: 'complete' });

    service = new UserService();
  });

  it('emits a Submit Survey action for an unanswered open survey, identity-matched by email+username', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage([openSurveyRow]) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const surveyActions = actions.filter((action) => action.type === 'Survey');

    expect(surveyActions).toHaveLength(1);
    expect(surveyActions[0]).toEqual(
      expect.objectContaining({
        buttonText: 'Submit Survey',
        buttonLink: 'https://www.research.net/r/ABC123',
        badge: 'Acme Project',
        text: expect.stringContaining('Board Satisfaction Survey is due'),
        date: expect.stringMatching(/^Due /),
      })
    );

    const surveyCall = proxyRequest.mock.calls.find((call) => (call[4] as { type?: string } | undefined)?.type === 'survey_response');
    expect(surveyCall?.[4]).toEqual(expect.objectContaining({ filters_or: ['email:invitee@example.com', 'username:testuser'] }));
    expect(surveyCall?.[4]).not.toHaveProperty('filters');
  });

  it('matches surveys by username when the auth context carries no email, skipping the email-keyed invitation source', async () => {
    getEffectiveEmail.mockReturnValue(null);
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage([openSurveyRow]) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, null, undefined);

    const surveyActions = actions.filter((action) => action.type === 'Survey');
    expect(surveyActions).toHaveLength(1);
    const surveyCall = proxyRequest.mock.calls.find((call) => (call[4] as { type?: string } | undefined)?.type === 'survey_response');
    expect(surveyCall?.[4]).toEqual(expect.objectContaining({ filters_or: ['username:testuser'] }));
    // Pending invitations are strictly email-keyed — skipped when the auth context has no email (GH-2987).
    expect(getMyPendingInvitations).not.toHaveBeenCalled();
  });

  it('excludes answered surveys (response_datetime populated)', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage([{ ...openSurveyRow, response_datetime: '2026-09-01T12:00:00Z' }]) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.filter((action) => action.type === 'Survey')).toHaveLength(0);
  });

  it('excludes expired surveys (sent past cutoff) and rows without renderable survey fields', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response'
        ? queryPage([
            { ...openSurveyRow, uid: 'expired', survey_cutoff_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
            { ...openSurveyRow, uid: 'legacy', survey_title: null },
            // Literal 'open' status classifies OPEN without consulting the cutoff — the parseable-cutoff
            // guard in fetchPendingSurveyResponses must still exclude this row.
            { ...openSurveyRow, uid: 'open-no-cutoff', survey_status: 'open', survey_cutoff_date: undefined },
          ])
        : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.filter((action) => action.type === 'Survey')).toHaveLength(0);
  });

  it('skips rows whose survey link is missing or off the SURVEY_LINK_ALLOWLIST, keeping valid rows', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response'
        ? queryPage([
            openSurveyRow,
            { ...openSurveyRow, uid: 'off-allowlist', survey_link: 'https://surveys.example.com/r/1' },
            { ...openSurveyRow, uid: 'no-link', survey_link: undefined },
          ])
        : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const surveyActions = actions.filter((action) => action.type === 'Survey');

    expect(surveyActions).toHaveLength(1);
    expect(surveyActions[0].buttonLink).toBe('https://www.research.net/r/ABC123');
  });

  it('emits one action per survey (earliest cutoff) across duplicate per-committee invitation rows', async () => {
    const laterCutoff = {
      ...openSurveyRow,
      uid: 'resp-open-toc',
      survey_cutoff_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      project: { name: 'Other Project' },
    };
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage([laterCutoff, openSurveyRow]) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const surveyActions = actions.filter((action) => action.type === 'Survey');

    expect(surveyActions).toHaveLength(1);
    expect(surveyActions[0].badge).toBe('Acme Project');
  });

  // Links are per-invitation: the earliest-cutoff row can be the one missing a link (or off the
  // allowlist), and index order is not stable — dedup must not discard a survey another row can
  // action. Both orders pin the link-preference guard: covering only the first would still pass
  // with the `rowHasLink === keptHasLink` tie-break dropped, reviving the vanishing-survey bug.
  it.each([
    ['unlinked earlier-cutoff row seen first', false],
    ['linked later-cutoff row seen first', true],
  ])('prefers an invitation row with a usable link when the earliest-cutoff row lacks one (%s)', async (_label, reversed) => {
    const earlierNoLink = {
      ...openSurveyRow,
      uid: 'resp-earlier-no-link',
      survey_link: undefined,
      survey_cutoff_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const laterWithLink = {
      ...openSurveyRow,
      uid: 'resp-later-with-link',
      survey_cutoff_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const rows = reversed ? [laterWithLink, earlierNoLink] : [earlierNoLink, laterWithLink];
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage(rows) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const surveyActions = actions.filter((action) => action.type === 'Survey');

    expect(surveyActions).toHaveLength(1);
    expect(surveyActions[0].buttonLink).toBe('https://www.research.net/r/ABC123');
  });

  it('orders survey actions by soonest cutoff first, regardless of index order', async () => {
    const laterSurvey = {
      ...openSurveyRow,
      uid: 'resp-later',
      survey_uid: 'survey-later',
      survey_title: 'Later Survey',
      survey_cutoff_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) =>
      params?.type === 'survey_response' ? queryPage([laterSurvey, openSurveyRow]) : queryPage([])
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.filter((action) => action.type === 'Survey').map((action) => action.text)).toEqual([
      expect.stringContaining('Board Satisfaction Survey'),
      expect.stringContaining('Later Survey'),
    ]);
  });

  it('degrades to no survey rows when the survey_response read fails, without failing the aggregation', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      if (params?.type === 'survey_response') {
        return Promise.reject(new Error('query service down'));
      }
      if (params?.type === 'v1_meeting') {
        return queryPage([{ id: 'm-1', title: 'Board', start_time: tomorrow, duration: 60, use_new_invite_email_address: false }]);
      }
      return queryPage([]);
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.filter((action) => action.type === 'Survey')).toHaveLength(0);
    expect(actions.filter((action) => action.type === 'Agenda')).toHaveLength(1);
  });

  it('fails closed on a mid-pagination survey_response failure, hiding partial rows but not other sources', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let surveyCalls = 0;
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      if (params?.type === 'survey_response') {
        surveyCalls += 1;
        // Page 1 succeeds with a continuation token; page 2 fails. failOnPartial must turn this
        // into a degrade (zero Survey actions) rather than silently keeping the truncated page.
        return surveyCalls === 1 ? Promise.resolve({ ...queryPage([openSurveyRow]), page_token: 'token-2' }) : Promise.reject(new Error('page 2 boom'));
      }
      if (params?.type === 'v1_meeting') {
        return queryPage([{ id: 'm-1', title: 'Board', start_time: tomorrow, duration: 60, use_new_invite_email_address: false }]);
      }
      return queryPage([]);
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(surveyCalls).toBe(2);
    expect(actions.filter((action) => action.type === 'Survey')).toHaveLength(0);
    expect(actions.filter((action) => action.type === 'Agenda')).toHaveLength(1);
  });

  it('pushes project scoping server-side via the project_uid tag when a project lens is active', async () => {
    await service.getPendingActions(req, 'proj-uid-1', email, 'acme-project');

    const surveyCall = proxyRequest.mock.calls.find((call) => (call[4] as { type?: string } | undefined)?.type === 'survey_response');
    expect(surveyCall?.[4]).toEqual(expect.objectContaining({ tags: ['project_uid:proj-uid-1'] }));
    expect(surveyCall?.[4]).not.toHaveProperty('filters');
  });
});

function queriedTypes(): string[] {
  return proxyRequest.mock.calls.map((call) => (call[4] as { type?: string } | undefined)?.type).filter((type): type is string => !!type);
}

// GH #2985: pending votes must come from the same identity `filters_or` query as My Votes —
// `filter_grants=direct` silently dropped email-only invitees (their FGA tuple is only emitted
// for a non-empty Username). The real vote-response helper + paginator run against the mocked
// proxy, so these specs pin both the outgoing query shape and the pending-only filtering.
describe('UserService.getPendingActions pending votes (GH #2985)', () => {
  const req = {} as unknown as Request;
  const email = 'voter@example.org';
  const futureEnd = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const activeVoteDoc = { vote_uid: 'vote-active', name: 'Active Ballot', status: 'active', end_time: futureEnd, project_uid: 'project-1' };
  // Rows carry the request's resolved identity (`username: 'testuser'`) so they survive the
  // helper's server-side identity re-check; getEffectiveEmail is mocked unset in this file.
  const awaitingRow = { vote_uid: 'vote-active', vote_status: 'awaiting_response', voter_removed: false, username: 'testuser' };

  let service: UserService;

  function routeByType(voteResponses: object[], voteDocs: object[]): void {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      switch (params?.type) {
        case 'vote_response':
          return queryPage(voteResponses);
        case 'vote':
          return queryPage(voteDocs);
        default:
          return queryPage([]);
      }
    });
  }

  function voteResponseParams(): Record<string, unknown> | undefined {
    const call = proxyRequest.mock.calls.find((c) => (c[4] as { type?: string } | undefined)?.type === 'vote_response');
    return call?.[4] as Record<string, unknown> | undefined;
  }

  beforeEach(() => {
    proxyRequest.mockReset();
    getMyPendingInvitations.mockReset();
    getUsernameFromAuth.mockReset();
    // mockReset leaves getEffectiveEmail unset — this block's specs assume username-only identity.
    getEffectiveEmail.mockReset();
    getMyFormationWork.mockReset();

    getMyPendingInvitations.mockResolvedValue([]);
    getUsernameFromAuth.mockResolvedValue('testuser');
    getMyFormationWork.mockResolvedValue({ formations: [], items: [], state: 'complete' });

    service = new UserService();
  });

  it('emits a Cast Vote action for an unanswered active vote matched by identity', async () => {
    routeByType([awaitingRow], [activeVoteDoc]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);
    const voteActions = actions.filter((action) => action.type === 'Vote');

    expect(voteActions).toHaveLength(1);
    expect(voteActions[0]).toMatchObject({ buttonText: 'Cast Vote', voteUid: 'vote-active', text: 'Cast your vote on Active Ballot' });
  });

  it('queries vote_response by identity filters_or with no filter_grants (the #2985 fix)', async () => {
    routeByType([awaitingRow], [activeVoteDoc]);

    await service.getPendingActions(req, undefined, email, undefined);

    const params = voteResponseParams();
    expect(params).toBeDefined();
    expect(params).not.toHaveProperty('filter_grants');
    // getEffectiveEmail is mocked unset in this file, so only the username clause is present.
    expect(params?.['filters_or']).toEqual(['username:testuser']);
  });

  it('pushes project scoping server-side on the project-lens path', async () => {
    routeByType([awaitingRow], [activeVoteDoc]);

    await service.getPendingActions(req, 'project-1', email, 'acme-project');

    expect(voteResponseParams()?.['filters']).toEqual(['project_uid:project-1']);
  });

  it('excludes rows the user already responded to', async () => {
    routeByType([{ ...awaitingRow, vote_status: 'responded' }], [activeVoteDoc]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('excludes a vote with both an awaiting row and a responded row for the same vote_uid', async () => {
    // Duplicate-row case the widened identity query admits (e.g. an email-keyed invite row plus
    // a username-keyed row from a later re-invite): My Votes' "any responded row wins" rule must
    // win here too, or Pending Actions and My Votes disagree on the same vote.
    routeByType([awaitingRow, { ...awaitingRow, vote_status: 'responded' }], [activeVoteDoc]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('excludes rows keyed only by vote_id — the response row own v1 id, never a parent key (GH #2985)', async () => {
    // vote_id-only legacy row: no vote_uid/poll_id means no parent key, so the row must not
    // produce a pending action (the dropped `?? vote_id` fallback would have mis-keyed it).
    routeByType([{ vote_id: 'v1-row-1', vote_status: 'awaiting_response', voter_removed: false, username: 'testuser' }], [activeVoteDoc]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('excludes removed voters even when the row is still awaiting_response', async () => {
    routeByType([{ ...awaitingRow, voter_removed: true }], [activeVoteDoc]);

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('excludes votes whose parent is not active or has already ended', async () => {
    routeByType(
      [
        { vote_uid: 'vote-ended', vote_status: 'awaiting_response', voter_removed: false, username: 'testuser' },
        { vote_uid: 'vote-expired', vote_status: 'awaiting_response', voter_removed: false, username: 'testuser' },
      ],
      [
        { ...activeVoteDoc, vote_uid: 'vote-ended', status: 'ended' },
        { ...activeVoteDoc, vote_uid: 'vote-expired', end_time: pastEnd },
      ]
    );

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('degrades to no vote actions when the vote_response source errors, without failing the whole aggregation', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string }) => {
      if (params?.type === 'vote_response') {
        // Non-5xx: fetchWithRetry only retries 5xx, so this surfaces on the first attempt.
        return Promise.reject(new Error('boom'));
      }
      return queryPage([]);
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });

  it('fails closed when a LATER vote_response page errors (failOnPartial), instead of acting on partial rows', async () => {
    // The first-page degradation test above can't pin failOnPartial — page-1 failures propagate
    // either way. Here page 1 succeeds with a live page_token and page 2 rejects (non-5xx: no
    // retry): with failOnPartial dropped the paginator would return the partial page-1 row and a
    // bogus Cast Vote action would be emitted, so this test discriminates.
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params?: { type?: string; page_token?: string }) => {
      if (params?.type === 'vote_response') {
        if (!params.page_token) {
          return Promise.resolve({ resources: [{ id: 'item:0', data: awaitingRow }], page_token: 'cursor-2' } as QueryServiceResponse<object>);
        }
        return Promise.reject(new Error('boom'));
      }
      if (params?.type === 'vote') {
        return queryPage([activeVoteDoc]);
      }
      return queryPage([]);
    });

    const actions = await service.getPendingActions(req, undefined, email, undefined);

    expect(actions.some((action) => action.type === 'Vote')).toBe(false);
  });
});
