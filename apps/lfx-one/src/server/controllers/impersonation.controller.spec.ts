// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller imports the shared `utils` barrel, which statically pulls in `@angular/forms`; under
// vitest's plain Node runtime that needs the JIT compiler loaded first.
import '@angular/compiler';

import { IMPERSONATION_SEARCH_LIMIT, IMPERSONATION_SEARCH_MAX_LENGTH } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exchangeToken, fetchTargetUserProfile, startImpersonation, searchUsersService, resolveRealAccessToken, decodeJwtPayload } = vi.hoisted(() => ({
  exchangeToken: vi.fn(),
  searchUsersService: vi.fn(),
  fetchTargetUserProfile: vi.fn(),
  startImpersonation: vi.fn(),
  resolveRealAccessToken: vi.fn(),
  decodeJwtPayload: vi.fn(),
}));

vi.mock('../services/impersonation.service', () => ({
  ImpersonationService: vi.fn().mockImplementation(function () {
    return { exchangeToken, fetchTargetUserProfile, startImpersonation, searchUsers: searchUsersService };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ resolveRealAccessToken, decodeJwtPayload }));

import { AuthorizationError, ServiceValidationError } from '../errors';
import { ImpersonationController } from './impersonation.controller';

describe('ImpersonationController.startImpersonation', () => {
  const controller = new ImpersonationController();
  const res = { json: vi.fn() } as unknown as Response;
  let next: NextFunction;

  const buildReq = (appSession: Record<string, unknown> = {}): Request =>
    ({
      body: { targetUser: 'jdoe' },
      appSession,
      bearerToken: 'current-bearer',
      oidc: { accessToken: { access_token: 'real-token' } },
    }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
    decodeJwtPayload.mockImplementation((token: string) =>
      token === 'target-token' ? { sub: 'auth0|target', 'http://lfx.dev/claims/email': 'j@example.test' } : { 'http://lfx.dev/claims/can_impersonate': true }
    );
    resolveRealAccessToken.mockResolvedValue('real-token');
    exchangeToken.mockResolvedValue({ access_token: 'target-token', token_type: 'Bearer', expires_in: 3600 });
    fetchTargetUserProfile.mockResolvedValue({});
  });

  it('switches users while already impersonating, exchanging the impersonator token', async () => {
    const req = buildReq({ impersonationToken: 'old-target-token' });

    await controller.startImpersonation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(exchangeToken).toHaveBeenCalledWith(req, 'jdoe', 'real-token');
    expect(startImpersonation).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ impersonating: true }));
  });

  it('rejects switching to the user already being impersonated', async () => {
    decodeJwtPayload.mockImplementation((token: string) =>
      token === 'target-token' ? { sub: 'auth0|target' } : { 'http://lfx.dev/claims/can_impersonate': true }
    );
    const req = buildReq({ impersonationToken: 'old-target-token', impersonationUser: { sub: 'auth0|target' } });

    await controller.startImpersonation(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'ALREADY_IMPERSONATING_TARGET' }));
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it('rejects when the real token lacks the can_impersonate claim', async () => {
    decodeJwtPayload.mockReturnValue({});

    await controller.startImpersonation(buildReq({ impersonationToken: 'old-target-token' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(exchangeToken).not.toHaveBeenCalled();
  });

  it('fails closed when the real session token cannot be resolved', async () => {
    resolveRealAccessToken.mockResolvedValue(null);

    await controller.startImpersonation(buildReq({ impersonationToken: 'old-target-token' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(exchangeToken).not.toHaveBeenCalled();
    expect(startImpersonation).not.toHaveBeenCalled();
  });
});

describe('ImpersonationController.searchUsers', () => {
  const controller = new ImpersonationController();
  let res: Response;
  let next: NextFunction;

  const buildReq = (body: Record<string, unknown>, appSession: Record<string, unknown> = {}): Request =>
    ({
      body,
      appSession,
      bearerToken: 'current-target-token',
      oidc: { accessToken: { access_token: 'real-token' } },
    }) as unknown as Request;

  const found = (username: string, email?: string, name?: string) => ({ user_id: `auth0|${username}`, username, email, name });

  beforeEach(() => {
    vi.clearAllMocks();
    res = { json: vi.fn() } as unknown as Response;
    next = vi.fn();
    resolveRealAccessToken.mockResolvedValue('real-token');
    decodeJwtPayload.mockReturnValue({
      'http://lfx.dev/claims/can_impersonate': true,
      'http://lfx.dev/claims/username': 'admin',
      'http://lfx.dev/claims/email': 'admin@example.test',
    });
    searchUsersService.mockResolvedValue([]);
  });

  it("searches with the admin's own token, never the request's bearer token, and trims the text", async () => {
    const req = buildReq({ q: '  jane  ' }, { impersonationToken: 'target-token' });

    await controller.searchUsers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(searchUsersService).toHaveBeenCalledWith(req, 'jane', 'real-token', IMPERSONATION_SEARCH_LIMIT);
    expect(searchUsersService.mock.calls[0][2]).not.toBe('current-target-token');
  });

  it('maps the people found to picker suggestions, keeping the order', async () => {
    searchUsersService.mockResolvedValue([found('jdoe', 'jane.doe@example.test', 'Jane Doe'), found('asmith', undefined, undefined)]);

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(res.json).toHaveBeenCalledWith({
      results: [
        { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.test', name: 'Jane Doe' },
        { targetUser: 'asmith', username: 'asmith', email: '', name: undefined },
      ],
    });
  });

  it('leaves out a person with a blank or missing username, who cannot be impersonated by selection', async () => {
    searchUsersService.mockResolvedValue([found('', 'x@example.test'), found('   ', 'y@example.test'), found('jdoe')]);

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ results: [expect.objectContaining({ username: 'jdoe' })] });
  });

  it('offers a username without its surrounding whitespace', async () => {
    searchUsersService.mockResolvedValue([found('  jdoe ')]);

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ results: [expect.objectContaining({ targetUser: 'jdoe', username: 'jdoe' })] });
  });

  it('leaves out the signed-in admin, matched by username or email', async () => {
    searchUsersService.mockResolvedValue([found('admin'), found('other', 'ADMIN@example.test'), found('jdoe')]);

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ results: [expect.objectContaining({ username: 'jdoe' })] });
  });

  it('also leaves out the user currently being impersonated', async () => {
    searchUsersService.mockResolvedValue([found('kim', 'kim@example.test'), found('jdoe')]);
    const req = buildReq({ q: 'jane' }, { impersonationUser: { username: 'kim', email: 'kim@example.test' } });

    await controller.searchUsers(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ results: [expect.objectContaining({ username: 'jdoe' })] });
  });

  it('reads the text from the body, not the URL', async () => {
    const req = { ...buildReq({}), query: { q: 'from-the-url' } } as unknown as Request;

    await controller.searchUsers(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(searchUsersService).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['blank', { q: '   ' }],
    ['repeated', { q: ['a', 'b'] }],
    ['too long', { q: 'a'.repeat(IMPERSONATION_SEARCH_MAX_LENGTH + 1) }],
  ])('refuses a %s query without searching', async (_label, query) => {
    await controller.searchUsers(buildReq(query), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(searchUsersService).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does not search when the caller cannot impersonate', async () => {
    decodeJwtPayload.mockReturnValue({});

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(searchUsersService).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('passes a failed search on to the error handler', async () => {
    const failure = new Error('search failed');
    searchUsersService.mockRejectedValue(failure);

    await controller.searchUsers(buildReq({ q: 'jane' }), res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.json).not.toHaveBeenCalled();
  });
});
