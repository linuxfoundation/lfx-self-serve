// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, getRealEmail, resolveAuditUserDisplayName, resolveRealAccessToken } from './auth-helper';

interface TargetUser {
  email?: string;
  username?: string;
  sub?: string;
}

// Minimal Request stand-in: the helpers only read `appSession`/`oidc`, and isImpersonating()
// needs a non-empty token, a future expiry, and an impersonationUser.
function buildReq(opts: { impersonating?: boolean; target?: TargetUser; oidc?: Record<string, unknown> }): Request {
  const appSession = opts.impersonating
    ? { impersonationToken: 'imp-token', impersonationExpiresAt: Date.now() + 60_000, impersonationUser: opts.target ?? {} }
    : {};
  return { appSession, oidc: opts.oidc ? { user: opts.oidc } : undefined } as unknown as Request;
}

// The impersonator's own OIDC identity — present in every impersonation case to prove the
// helpers never fall back to it when the target's stored field is empty.
const OPERATOR_OIDC = { email: 'Operator@Example.com', nickname: 'operatornick', username: 'operatorname', sub: 'auth0|operator' };

describe('getEffectiveEmail', () => {
  it('returns the target email lowercased when impersonating', () => {
    const req = buildReq({ impersonating: true, target: { email: 'Target@Example.com' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveEmail(req)).toBe('target@example.com');
  });

  it('returns null (never the impersonator) when the target has no stored email', () => {
    const req = buildReq({ impersonating: true, target: { email: '' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveEmail(req)).toBeNull();
  });

  it('returns the OIDC email lowercased when not impersonating', () => {
    const req = buildReq({ oidc: { email: 'User@Example.com' } });
    expect(getEffectiveEmail(req)).toBe('user@example.com');
  });
});

describe('getEffectiveUsername', () => {
  it('returns the target username when impersonating', () => {
    const req = buildReq({ impersonating: true, target: { username: 'targetuser' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveUsername(req)).toBe('targetuser');
  });

  it('returns null (never the impersonator) when the target has no stored username', () => {
    const req = buildReq({ impersonating: true, target: { username: '' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveUsername(req)).toBeNull();
  });

  it('falls back to the OIDC nickname when not impersonating', () => {
    const req = buildReq({ oidc: { nickname: 'usernick', username: 'username' } });
    expect(getEffectiveUsername(req)).toBe('usernick');
  });
});

describe('getEffectiveSub', () => {
  it('returns the target sub when impersonating', () => {
    const req = buildReq({ impersonating: true, target: { sub: 'auth0|target' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveSub(req)).toBe('auth0|target');
  });

  it('returns null (never the impersonator) when the target has no stored sub', () => {
    const req = buildReq({ impersonating: true, target: { sub: '' }, oidc: OPERATOR_OIDC });
    expect(getEffectiveSub(req)).toBeNull();
  });

  it('returns the OIDC sub when not impersonating', () => {
    const req = buildReq({ oidc: { sub: 'auth0|user' } });
    expect(getEffectiveSub(req)).toBe('auth0|user');
  });
});

describe('getRealEmail', () => {
  it('returns the OPERATOR OIDC email lowercased when impersonating — never the target', () => {
    const req = buildReq({ impersonating: true, target: { email: 'target@example.com' }, oidc: OPERATOR_OIDC });
    expect(getRealEmail(req)).toBe('operator@example.com');
  });

  it('returns the OIDC email lowercased when not impersonating', () => {
    const req = buildReq({ oidc: { email: 'User@Example.com' } });
    expect(getRealEmail(req)).toBe('user@example.com');
  });

  it('returns null when there is no OIDC email', () => {
    const req = buildReq({});
    expect(getRealEmail(req)).toBeNull();
  });
});

describe('resolveRealAccessToken', () => {
  interface FakeAccessToken {
    access_token?: string;
    isExpired: () => boolean;
    refresh: () => Promise<{ access_token?: string } | undefined>;
  }

  // Separate fixture from buildReq: these tests need `bearerToken` and `oidc.accessToken`
  // (isExpired/refresh), which the getEffective*/getRealEmail fixture above has no use for.
  function buildTokenReq(opts: { impersonating?: boolean; bearerToken?: string; accessToken?: FakeAccessToken }): Request {
    const appSession = opts.impersonating ? { impersonationToken: 'imp-token', impersonationExpiresAt: Date.now() + 60_000, impersonationUser: {} } : {};
    return {
      appSession,
      bearerToken: opts.bearerToken,
      oidc: { accessToken: opts.accessToken },
    } as unknown as Request;
  }

  it('returns req.bearerToken as-is when not impersonating (no-op)', async () => {
    const req = buildTokenReq({ bearerToken: 'user-token' });
    await expect(resolveRealAccessToken(req)).resolves.toBe('user-token');
  });

  it('returns null when not impersonating and there is no bearer token', async () => {
    const req = buildTokenReq({});
    await expect(resolveRealAccessToken(req)).resolves.toBeNull();
  });

  it('returns the real (operator) access token when impersonating and it is not expired', async () => {
    const req = buildTokenReq({
      impersonating: true,
      bearerToken: 'imp-token',
      accessToken: { access_token: 'real-token', isExpired: () => false, refresh: async () => undefined },
    });
    await expect(resolveRealAccessToken(req)).resolves.toBe('real-token');
  });

  it('refreshes and returns the new token when impersonating and the real token is expired', async () => {
    const req = buildTokenReq({
      impersonating: true,
      bearerToken: 'imp-token',
      accessToken: { access_token: 'stale-token', isExpired: () => true, refresh: async () => ({ access_token: 'refreshed-token' }) },
    });
    await expect(resolveRealAccessToken(req)).resolves.toBe('refreshed-token');
  });

  it('returns null (fails closed) when impersonating and the refresh attempt throws', async () => {
    const req = buildTokenReq({
      impersonating: true,
      bearerToken: 'imp-token',
      accessToken: {
        access_token: 'stale-token',
        isExpired: () => true,
        refresh: async () => {
          throw new Error('refresh failed');
        },
      },
    });
    await expect(resolveRealAccessToken(req)).resolves.toBeNull();
  });

  it('returns null (fails closed) when impersonating and there is no real session access token at all', async () => {
    const req = buildTokenReq({ impersonating: true, bearerToken: 'imp-token', accessToken: undefined });
    await expect(resolveRealAccessToken(req)).resolves.toBeNull();
  });
});

describe('resolveAuditUserDisplayName', () => {
  it('returns the audit user name when present', () => {
    expect(resolveAuditUserDisplayName({ name: 'Ada Lovelace', username: 'alovelace' })).toBe('Ada Lovelace');
  });

  it('falls back to stripped username on a partial audit user object', () => {
    expect(resolveAuditUserDisplayName({ username: 'auth0|alovelace' })).toBe('alovelace');
  });

  it('falls back to a legacy flat username field', () => {
    expect(resolveAuditUserDisplayName(undefined, 'auth0|legacyuser')).toBe('legacyuser');
  });

  it('falls back to legacy username when audit username is whitespace-only', () => {
    expect(resolveAuditUserDisplayName({ username: '   ' }, 'auth0|legacyuser')).toBe('legacyuser');
    expect(resolveAuditUserDisplayName(undefined, '   ')).toBeUndefined();
  });

  it('returns undefined when no name or username is available', () => {
    expect(resolveAuditUserDisplayName(undefined, undefined)).toBeUndefined();
    expect(resolveAuditUserDisplayName({ name: '  ', username: '' }, '')).toBeUndefined();
  });
});
