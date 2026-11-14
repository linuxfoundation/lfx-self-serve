// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveRealAccessToken, decodeJwtPayload } = vi.hoisted(() => ({ resolveRealAccessToken: vi.fn(), decodeJwtPayload: vi.fn() }));

vi.mock('./auth-helper', () => ({ resolveRealAccessToken, decodeJwtPayload }));

import { AuthorizationError } from '../errors';
import { resolveImpersonatorToken } from './impersonator-token';

const req = {} as Request;

describe('resolveImpersonatorToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the real token when it carries can_impersonate', async () => {
    resolveRealAccessToken.mockResolvedValue('real-token');
    decodeJwtPayload.mockReturnValue({ 'http://lfx.dev/claims/can_impersonate': true });

    await expect(resolveImpersonatorToken(req, 'search_users')).resolves.toBe('real-token');
    expect(decodeJwtPayload).toHaveBeenCalledWith('real-token');
  });

  it('fails closed when the real token cannot be resolved', async () => {
    resolveRealAccessToken.mockResolvedValue(null);

    await expect(resolveImpersonatorToken(req, 'search_users')).rejects.toBeInstanceOf(AuthorizationError);
    expect(decodeJwtPayload).not.toHaveBeenCalled();
  });

  it.each([
    ['the claim is missing', {}],
    ['the claim is not true', { 'http://lfx.dev/claims/can_impersonate': 'yes' }],
    ['the token cannot be decoded', null],
  ])('rejects when %s', async (_label, payload) => {
    resolveRealAccessToken.mockResolvedValue('real-token');
    decodeJwtPayload.mockReturnValue(payload);

    await expect(resolveImpersonatorToken(req, 'search_users')).rejects.toBeInstanceOf(AuthorizationError);
  });
});
