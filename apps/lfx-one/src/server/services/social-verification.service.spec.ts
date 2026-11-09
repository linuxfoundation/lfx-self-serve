// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config, so the
// constants the service reads are mocked directly (mirrors profile.controller.spec.ts).
vi.mock('@lfx-one/shared/constants', () => ({
  CDP_TO_AUTH0_PROVIDER_MAP: { github: 'github', gitlab: 'gitlab', google: 'google-oauth2', linkedin: 'linkedin' },
}));

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

import { SocialVerificationService } from './social-verification.service';

function buildReq(): Request {
  return { appSession: {} } as unknown as Request;
}

describe('SocialVerificationService', () => {
  let service: SocialVerificationService;

  beforeEach(() => {
    vi.stubEnv('PROFILE_CLIENT_ID', 'profile-client-id');
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.example.com/');
    vi.stubEnv('PCC_BASE_URL', 'https://app.example.com');
    vi.stubEnv('SOCIAL_REDIRECT_URI', '');
    service = new SocialVerificationService();
  });

  describe('isValidProvider', () => {
    it.each(['github', 'gitlab', 'google', 'linkedin'])('accepts %s', (provider) => {
      expect(service.isValidProvider(provider)).toBe(true);
    });

    it('rejects the generic oauth2 strategy and unknown providers', () => {
      expect(service.isValidProvider('oauth2')).toBe(false);
      expect(service.isValidProvider('bitbucket')).toBe(false);
    });
  });

  describe('getAuthorizeUrl', () => {
    it('sends GitLab through the gitlab Auth0 connection and stores the CSRF state', () => {
      const req = buildReq();

      const url = new URL(service.getAuthorizeUrl(req, 'gitlab'));

      expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize');
      expect(url.searchParams.get('connection')).toBe('gitlab');
      expect(url.searchParams.get('client_id')).toBe('profile-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/social/callback');
      expect(url.searchParams.get('state')).toBe(req.appSession?.socialAuthState);
      expect(req.appSession?.socialAuthState).toMatch(/^[0-9a-f]{64}$/);
    });

    it('still maps google to the google-oauth2 connection', () => {
      const url = new URL(service.getAuthorizeUrl(buildReq(), 'google'));

      expect(url.searchParams.get('connection')).toBe('google-oauth2');
    });
  });
});
