// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UserPreferenceService composes UserService, whose import graph transitively pulls in @angular/common
// (partially compiled); load the JIT compiler so those injectables resolve under vitest (mirrors user.service.spec.ts).
import '@angular/compiler';

import { SOCIAL_LISTENING_PREFERENCE_APP_NAME } from '@lfx-one/shared/constants';
import type { ApiGatewayUserProfile, UserServicePreference } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the constructor collaborators (NATS, Snowflake, etc.) so `new UserPreferenceService()` is cheap
// and side-effect-free; preference traffic goes through the mocked gatewayFetch below.
vi.mock('./nats.service', () => ({ NatsService: vi.fn() }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({})) } }));
vi.mock('./meeting.service', () => ({ MeetingService: vi.fn() }));
vi.mock('./project.service', () => ({ ProjectService: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({ MicroserviceProxyService: vi.fn() }));
vi.mock('./access-check.service', () => ({ AccessCheckService: vi.fn() }));
vi.mock('./committee.service', () => ({ CommitteeService: vi.fn() }));
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
import { UserPreferenceService } from './user-preference.service';
import { UserService } from './user.service';

describe('UserPreferenceService', () => {
  const req = { apiGatewayToken: 'gw-token' } as unknown as Request;
  // Untyped mock handle — gatewayFetch is generic, so a precise Mock type fights the return inference.
  const gw = gatewayFetch as unknown as ReturnType<typeof vi.fn>;

  const appName = SOCIAL_LISTENING_PREFERENCE_APP_NAME;
  const name = 'Social Listening Bookmarks - proj-1';
  const baseUrl = 'https://gw.test/user-service/v1/users/sfid-1/preferences';
  const listUrl = `${baseUrl}?$filter=${encodeURIComponent(`AppName eq ${appName} and Name eq ${name}`)}`;

  let service: UserPreferenceService;

  function mockProfile(id: string | null = 'sfid-1'): void {
    const userService = (service as unknown as { userService: UserService }).userService;
    vi.spyOn(userService, 'getApiGatewayProfile').mockResolvedValue({ ID: id } as unknown as ApiGatewayUserProfile);
  }

  // A stored preference row. Name/AppName MUST match the test constants or the defensive find() won't select it.
  function pref(value: string, overrides: Partial<UserServicePreference> = {}): UserServicePreference {
    return { ID: 'pref-1', AppName: appName, Name: name, Type: 'json', System: false, Value: value, ...overrides };
  }

  // Preference reads return `existing` (or an empty list); everything else resolves null. Tests override for race/error paths.
  function routeGateway(existing: UserServicePreference | null): void {
    gw.mockImplementation(async (_req: unknown, url: string, options: { method?: string }) => {
      const method = options.method ?? 'GET';
      if (method === 'GET' && url.includes('/preferences')) {
        return { Data: existing ? [existing] : [] };
      }
      return null;
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    gw.mockReset();
    service = new UserPreferenceService();
  });

  describe('getPreference', () => {
    it('lists with the exact unquoted AppName+Name $filter and returns the matching row value', async () => {
      mockProfile();
      routeGateway(pref('{"ids":["a"]}'));

      const value = await service.getPreference(req, appName, name);

      expect(value).toBe('{"ids":["a"]}');
      expect(gw).toHaveBeenCalledWith(req, listUrl, expect.objectContaining({ operation: 'get_user_preference', service: 'user_service' }));
    });

    it('returns null when the fail-open filter response has no AppName+Name match', async () => {
      mockProfile();
      gw.mockResolvedValue({ Data: [pref('a', { Name: 'Something Else' }), pref('b', { AppName: 'other-app' })] });

      await expect(service.getPreference(req, appName, name)).resolves.toBeNull();
    });

    it('returns null when no preference row exists (first use is not an error)', async () => {
      mockProfile();
      routeGateway(null);

      await expect(service.getPreference(req, appName, name)).resolves.toBeNull();
    });
  });

  describe('upsertPreference', () => {
    it('PATCHes the existing row, preserving upstream AppName/Name/Type/System', async () => {
      mockProfile();
      routeGateway(pref('old', { System: true }));

      await service.upsertPreference(req, appName, name, '{"ids":["b"]}');

      expect(gw).toHaveBeenCalledWith(
        req,
        `${baseUrl}/pref-1`,
        expect.objectContaining({
          method: 'PATCH',
          body: { AppName: appName, Name: name, Type: 'json', System: true, Value: '{"ids":["b"]}' },
        })
      );
      expect(gw.mock.calls.some((c) => c[2].method === 'POST')).toBe(false);
    });

    it('POSTs a create when no row exists, with pinned Type/System metadata', async () => {
      mockProfile();
      routeGateway(null);

      await service.upsertPreference(req, appName, name, '{"ids":["b"]}');

      expect(gw).toHaveBeenCalledWith(
        req,
        baseUrl,
        expect.objectContaining({
          method: 'POST',
          body: { AppName: appName, Name: name, Type: 'json', System: false, Value: '{"ids":["b"]}' },
        })
      );
    });

    it('falls back to re-GET + PATCH when the POST races into a 409', async () => {
      mockProfile();
      let getCount = 0;
      gw.mockImplementation(async (_req: unknown, url: string, options: { method?: string }) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          getCount++;
          return { Data: getCount === 1 ? [] : [pref('old')] };
        }
        if (method === 'POST') {
          throw new MicroserviceError('Preference creation failed: 409 Conflict', 409, 'USER_PREFERENCE_CREATE_FAILED');
        }
        return null;
      });

      await service.upsertPreference(req, appName, name, '{"ids":["b"]}');

      expect(gw).toHaveBeenCalledWith(req, `${baseUrl}/pref-1`, expect.objectContaining({ method: 'PATCH' }));
    });

    it('rethrows the 409 when the fallback re-GET still finds nothing', async () => {
      mockProfile();
      gw.mockImplementation(async (_req: unknown, url: string, options: { method?: string }) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          return { Data: [] };
        }
        if (method === 'POST') {
          throw new MicroserviceError('Preference creation failed: 409 Conflict', 409, 'USER_PREFERENCE_CREATE_FAILED');
        }
        return null;
      });

      await expect(service.upsertPreference(req, appName, name, 'v')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rethrows non-409 create failures without a fallback write', async () => {
      mockProfile();
      routeGateway(null);
      gw.mockImplementation(async (_req: unknown, url: string, options: { method?: string }) => {
        const method = options.method ?? 'GET';
        if (method === 'GET' && url.includes('/preferences')) {
          return { Data: [] };
        }
        if (method === 'POST') {
          throw new MicroserviceError('Preference creation failed: 500 Internal Server Error', 500, 'USER_PREFERENCE_CREATE_FAILED');
        }
        return null;
      });

      await expect(service.upsertPreference(req, appName, name, 'v')).rejects.toMatchObject({ statusCode: 500 });
      expect(gw.mock.calls.some((c) => c[2].method === 'PATCH')).toBe(false);
    });
  });

  describe('deletePreference', () => {
    it('resolves the row by AppName+Name and DELETEs by ID', async () => {
      mockProfile();
      routeGateway(pref('{"ids":["a"]}'));

      await service.deletePreference(req, appName, name);

      expect(gw).toHaveBeenCalledWith(req, `${baseUrl}/pref-1`, expect.objectContaining({ method: 'DELETE' }));
    });

    it('is a no-op when no row exists', async () => {
      mockProfile();
      routeGateway(null);

      await service.deletePreference(req, appName, name);

      expect(gw.mock.calls.some((c) => c[2].method === 'DELETE')).toBe(false);
    });
  });

  describe('SFID resolution', () => {
    it('rejects with 503 when the request has no API gateway token', async () => {
      // No profile spy — the real UserService.getApiGatewayProfile throws before any upstream call.
      const anonReq = {} as unknown as Request;

      await expect(service.getPreference(anonReq, appName, name)).rejects.toMatchObject({ statusCode: 503, code: 'API_GATEWAY_UNAVAILABLE' });
      expect(gw).not.toHaveBeenCalled();
    });

    it('rejects with 502 when the gateway profile has no Salesforce ID', async () => {
      mockProfile(null);

      await expect(service.getPreference(req, appName, name)).rejects.toMatchObject({ statusCode: 502 });
    });
  });
});
