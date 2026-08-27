// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch, getEffectiveUsername, isImpersonating } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getEffectiveUsername: vi.fn(),
  isImpersonating: vi.fn(),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('@lfx-one/shared/constants', () => ({
  SALESFORCE_ID_PATTERN: /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/,
}));
vi.mock('../helpers/api-gateway.helper', () => ({
  getUserServiceBaseUrl: vi.fn(() => 'https://gateway.example.test/user-service/v1'),
}));
vi.mock('./auth-helper', () => ({
  getEffectiveUsername,
  isImpersonating,
  stripAuthPrefix: (username: string) => username.replace(/^.*\|/, ''),
  usernameMatches: (expected: string, actual: string) => expected.replace(/^.*\|/, '') === actual.replace(/^.*\|/, ''),
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
    ['an empty Salesforce ID', 'target-user', { Data: [{ ID: ' ', Username: 'target-user' }], Metadata: { TotalSize: 1 } }],
    ['an invalid Salesforce ID', 'target-user', { Data: [{ ID: '003-target', Username: 'target-user' }], Metadata: { TotalSize: 1 } }],
  ])('fails closed for %s', async (_caseName, username, response) => {
    isImpersonating.mockReturnValue(true);
    getEffectiveUsername.mockReturnValue(username);
    gatewayFetch.mockResolvedValue(response);

    await expect(resolveRewardsSubject(req)).rejects.toMatchObject({
      code: expect.stringMatching(/AUTHENTICATION_REQUIRED|REWARDS_SUBJECT_RESOLUTION_FAILED/),
    });
  });
});
