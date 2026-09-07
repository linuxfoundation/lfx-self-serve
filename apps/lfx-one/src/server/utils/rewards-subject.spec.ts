// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RegexConstantsModule from '../../../../../packages/shared/src/constants/regex.constants';
import type * as AuthHelperModule from './auth-helper';

const { gatewayFetch, getEffectiveUsername, isImpersonating } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getEffectiveUsername: vi.fn(),
  isImpersonating: vi.fn(),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('@lfx-one/shared/constants', async () => {
  const regex = await vi.importActual<typeof RegexConstantsModule>('../../../../../packages/shared/src/constants/regex.constants');
  return { SALESFORCE_ID_PATTERN: regex.SALESFORCE_ID_PATTERN };
});
vi.mock('../helpers/api-gateway.helper', () => ({
  getUserServiceBaseUrl: vi.fn(() => 'https://gateway.example.test/user-service/v1'),
}));
vi.mock('./auth-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthHelperModule>()),
  getEffectiveUsername,
  isImpersonating,
}));

import type { Request } from 'express';

import { resolveRewardsSubject } from './rewards-subject';

describe('resolveRewardsSubject', () => {
  const req = { apiGatewayToken: 'staff-token' } as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps direct requests on the self subject without a lookup', async () => {
    isImpersonating.mockReturnValue(false);

    await expect(resolveRewardsSubject(req)).resolves.toEqual({ mode: 'self', readOnly: false });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('resolves one exact impersonation username to a valid Salesforce ID', async () => {
    isImpersonating.mockReturnValue(true);
    getEffectiveUsername.mockReturnValue('auth0|target-user');
    gatewayFetch.mockResolvedValue({
      Data: [{ ID: '003000000000001AAA', Username: 'target-user' }],
      Metadata: { TotalSize: 1 },
    });

    await expect(resolveRewardsSubject(req)).resolves.toEqual({
      mode: 'impersonated',
      username: 'target-user',
      salesforceId: '003000000000001AAA',
      readOnly: true,
    });
    expect(gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gateway.example.test/user-service/v1/users?username=target-user&pageSize=2&offset=0',
      expect.objectContaining({ operation: 'resolve_rewards_subject', service: 'rewards_service', redactResponseBody: true })
    );
  });

  it('uses the production first-prefix semantics for compound usernames', async () => {
    isImpersonating.mockReturnValue(true);
    getEffectiveUsername.mockReturnValue('auth0|tenant|target-user');
    gatewayFetch.mockResolvedValue({
      Data: [{ ID: '003000000000001AAA', Username: 'tenant|target-user' }],
      Metadata: { TotalSize: 1 },
    });

    await expect(resolveRewardsSubject(req)).resolves.toMatchObject({
      username: 'tenant|target-user',
      salesforceId: '003000000000001AAA',
    });
  });

  it.each([
    ['a missing target username', null, { Data: [] }],
    ['a malformed lookup response', 'target-user', {}],
    ['missing lookup metadata', 'target-user', { Data: [{ ID: '003000000000001AAA', Username: 'target-user' }] }],
    ['zero matches', 'target-user', { Data: [], Metadata: { TotalSize: 0 } }],
    [
      'multiple matches',
      'target-user',
      {
        Data: [
          { ID: '003000000000001AAA', Username: 'target-user' },
          { ID: '003000000000002AAA', Username: 'target-user' },
        ],
        Metadata: { TotalSize: 2 },
      },
    ],
    ['a mismatched username echo', 'target-user', { Data: [{ ID: '003000000000001AAA', Username: 'other-user' }], Metadata: { TotalSize: 1 } }],
    [
      'a compound username echo with a different prefix',
      'auth0|tenant|target-user',
      { Data: [{ ID: '003000000000001AAA', Username: 'other-tenant|target-user' }], Metadata: { TotalSize: 1 } },
    ],
    ['an empty Salesforce ID', 'target-user', { Data: [{ ID: ' ', Username: 'target-user' }], Metadata: { TotalSize: 1 } }],
    ['an invalid Salesforce ID', 'target-user', { Data: [{ ID: '003-target', Username: 'target-user' }], Metadata: { TotalSize: 1 } }],
    ['a non-string Salesforce ID', 'target-user', { Data: [{ ID: 123, Username: 'target-user' }], Metadata: { TotalSize: 1 } }],
    ['a non-string username echo', 'target-user', { Data: [{ ID: '003000000000001AAA', Username: 123 }], Metadata: { TotalSize: 1 } }],
  ])('fails closed for %s', async (_caseName, username, response) => {
    isImpersonating.mockReturnValue(true);
    getEffectiveUsername.mockReturnValue(username);
    gatewayFetch.mockResolvedValue(response);

    await expect(resolveRewardsSubject(req)).rejects.toMatchObject({
      code: expect.stringMatching(/AUTHENTICATION_REQUIRED|REWARDS_SUBJECT_RESOLUTION_FAILED/),
    });
  });
});
