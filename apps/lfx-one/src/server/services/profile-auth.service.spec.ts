// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authStateSvc } = vi.hoisted(() => ({
  authStateSvc: {
    issue: vi.fn(),
  },
}));

vi.mock('./auth-state.service', () => ({ authStateService: authStateSvc }));

vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { ProfileAuthService } from './profile-auth.service';

function buildReq(overrides: Record<string, unknown> = {}): Request {
  return { oidc: undefined, ...overrides } as unknown as Request;
}

// getAuthorizationUrl's issuer/sub/returnTo handoff to AuthStateService.issue is otherwise only
// exercised indirectly: profile.controller.spec.ts mocks ProfileAuthService entirely, and
// profile-auth-state.integration.spec.ts bypasses this service and calls AuthStateService.issue
// directly (copilot-pull-request-reviewer, PR #2604). A regression that drops the issuer sub/returnTo
// or fails to await the Valkey write would pass both suites unnoticed.
describe('ProfileAuthService.getAuthorizationUrl', () => {
  let service: ProfileAuthService;
  const envKeys = [
    'PROFILE_CLIENT_ID',
    'PROFILE_CLIENT_SECRET',
    'PROFILE_AUDIENCE',
    'PROFILE_SCOPE',
    'PCC_AUTH0_ISSUER_BASE_URL',
    'PCC_BASE_URL',
    'PROFILE_REDIRECT_URI',
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
    }
    process.env['PROFILE_CLIENT_ID'] = 'client-1';
    process.env['PROFILE_CLIENT_SECRET'] = 'secret-1';
    process.env['PROFILE_AUDIENCE'] = 'https://audience.example';
    process.env['PROFILE_SCOPE'] = 'update:current_user_metadata';
    process.env['PCC_AUTH0_ISSUER_BASE_URL'] = 'https://issuer.example/';
    process.env['PCC_BASE_URL'] = 'https://app.example';
    delete process.env['PROFILE_REDIRECT_URI'];
    authStateSvc.issue.mockResolvedValue('nonce-1');
    service = new ProfileAuthService();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('issues the nonce bound to the authenticated sub and the given returnTo', async () => {
    const req = buildReq({ oidc: { user: { sub: 'user-1' } } });

    await service.getAuthorizationUrl(req, '/profile/identities');

    expect(authStateSvc.issue).toHaveBeenCalledWith(req, 'user-1', '/profile/identities');
  });

  it('issues with an empty sub when the request has no authenticated user', async () => {
    const req = buildReq();

    await service.getAuthorizationUrl(req, '/profile');

    expect(authStateSvc.issue).toHaveBeenCalledWith(req, '', '/profile');
  });

  it('builds the Auth0 /authorize URL with the issued nonce as state and the configured client params', async () => {
    const req = buildReq({ oidc: { user: { sub: 'user-1' } } });

    const url = await service.getAuthorizationUrl(req, '/profile');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://issuer.example/authorize');
    expect(parsed.searchParams.get('state')).toBe('nonce-1');
    expect(parsed.searchParams.get('client_id')).toBe('client-1');
    expect(parsed.searchParams.get('audience')).toBe('https://audience.example');
    expect(parsed.searchParams.get('scope')).toBe('update:current_user_metadata');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example/passwordless/callback');
  });
});
