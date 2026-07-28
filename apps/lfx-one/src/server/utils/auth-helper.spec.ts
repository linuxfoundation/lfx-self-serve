// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } from './auth-helper';

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
