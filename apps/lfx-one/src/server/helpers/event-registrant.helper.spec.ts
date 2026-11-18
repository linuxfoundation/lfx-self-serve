// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isImpersonating, logger } = vi.hoisted(() => ({
  isImpersonating: vi.fn(() => false),
  logger: { warning: vi.fn(), debug: vi.fn() },
}));

vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));

import type { UserService } from '../services/user.service';
import { registrantFilterSql, resolveEventRegistrant } from './event-registrant.helper';

const EMAIL = 'user@example.com';

describe('resolveEventRegistrant', () => {
  const getApiGatewayProfile = vi.fn();
  const userService = { getApiGatewayProfile } as unknown as UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    isImpersonating.mockReturnValue(false);
    getApiGatewayProfile.mockResolvedValue({ ID: 'sfid-self' });
  });

  it("resolves the signed-in user's Salesforce ID with their own gateway token", async () => {
    const req = { bearerToken: 'v2-token' } as unknown as Request;

    await expect(resolveEventRegistrant(req, userService, EMAIL)).resolves.toEqual({ email: EMAIL, userId: 'sfid-self' });
    expect(getApiGatewayProfile).toHaveBeenCalledWith(req, undefined);
  });

  it("resolves the impersonation target's ID with the target's token", async () => {
    isImpersonating.mockReturnValue(true);
    getApiGatewayProfile.mockResolvedValue({ ID: 'sfid-target' });
    const req = { bearerToken: 'target-token' } as unknown as Request;

    await expect(resolveEventRegistrant(req, userService, EMAIL)).resolves.toEqual({ email: EMAIL, userId: 'sfid-target' });
    expect(getApiGatewayProfile).toHaveBeenCalledWith(req, 'target-token');
  });

  it("matches by email only rather than resolve the impersonator's ID when the target token is missing", async () => {
    isImpersonating.mockReturnValue(true);

    await expect(resolveEventRegistrant({} as Request, userService, EMAIL)).resolves.toEqual({ email: EMAIL, userId: null });
    expect(getApiGatewayProfile).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalled();
  });

  it('matches by email only when the profile lookup fails', async () => {
    getApiGatewayProfile.mockRejectedValue(new Error('gateway down'));

    await expect(resolveEventRegistrant({} as Request, userService, EMAIL)).resolves.toEqual({ email: EMAIL, userId: null });
    expect(logger.warning).toHaveBeenCalled();
  });

  it('matches by email only when the profile has no ID', async () => {
    getApiGatewayProfile.mockResolvedValue({ ID: '' });

    await expect(resolveEventRegistrant({} as Request, userService, EMAIL)).resolves.toEqual({ email: EMAIL, userId: null });
  });
});

describe('registrantFilterSql', () => {
  it('matches on ID or case-folded email when the ID is known', () => {
    expect(registrantFilterSql({ email: EMAIL, userId: 'sfid-1' })).toEqual({ sql: '(USER_ID = ? OR LOWER(USER_EMAIL) = ?)', binds: ['sfid-1', EMAIL] });
  });

  it('matches on case-folded email only without an ID', () => {
    expect(registrantFilterSql({ email: EMAIL, userId: null })).toEqual({ sql: 'LOWER(USER_EMAIL) = ?', binds: [EMAIL] });
  });
});
