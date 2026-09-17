// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// profile.controller.spec.ts mocks AuthStateService entirely (its `authStateSvc` is a bare
// vi.fn() object), so a regression to the real issue/consume wiring — e.g. reverting the atomic
// GETDEL to a non-atomic get-then-del, or dropping the session-fallback ordering fix — would pass
// that suite unnoticed. This suite uses the REAL AuthStateService and only fakes its Valkey
// dependency, so it genuinely exercises the nonce lifecycle through the controller (#1938 review,
// copilot-pull-request-reviewer on PR #2604).
const { profileAuthSvc, fakeValkey, stubConstructor } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    stubConstructor: vi.fn(function (this: object) {
      return this;
    }),
    profileAuthSvc: {
      isProfileAuthConfigured: vi.fn(() => true),
      exchangeCodeForToken: vi.fn(),
      decodeAndValidateSub: vi.fn(() => true),
      storeManagementToken: vi.fn(),
      getManagementToken: vi.fn(),
    },
    // A minimal Map-backed fake standing in for Valkey — genuinely exercises "one write, one
    // atomic read-and-delete" instead of mocking the outcome, so a regression to a non-atomic
    // get-then-del is actually caught rather than mocked away.
    fakeValkey: {
      store,
      isEnabled: vi.fn(() => true),
      setJson: vi.fn(async (key: string, value: unknown) => {
        store.set(key, JSON.stringify(value));
        return true;
      }),
      getdelJson: vi.fn(async (key: string) => {
        const raw = store.get(key);
        if (raw === undefined) return { status: 'miss' };
        store.delete(key);
        return { status: 'hit', value: JSON.parse(raw) };
      }),
    },
  };
});

vi.mock('@lfx-one/shared/constants', () => ({
  ALLOWED_AVATAR_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  AUTH0_TO_CDP_PROVIDER_MAP: {},
  CDP_DISPLAYABLE_IDENTITY_COMBOS: [],
  CDP_PLATFORM_ICONS: {},
  CDP_PLATFORM_TO_TYPE_MAP: {},
  CDP_TO_AUTH0_PROVIDER_MAP: {},
  EMAIL_ALREADY_LINKED_MESSAGE: 'already linked',
  EMAIL_REGEX: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/,
  PROFILE_EMAIL_PATH: '/profile/email',
  PROFILE_EMAILS_PATH: '/profile/emails',
  PROFILE_PASSWORD_PATH: '/profile/password',
  PROFILE_SETTINGS_PATH: '/profile/settings',
  PROFILE_VISIBILITY_KEYS: [],
  PURCHASE_LINUX_URL: 'https://example.com',
  VALKEY_CACHE: { AUTH_STATE_TTL_SECONDS: 600, AUTH_STATE_OP_TIMEOUT_MS: 3000 },
}));
vi.mock('@lfx-one/shared/utils', () => ({
  isIdentityAlreadyLinkedError: vi.fn(() => false),
  isMeetingInvitePrimarySentinel: (value: string | null | undefined) => (value ?? '').trim().toLowerCase() === 'primary',
  emailsEqual: (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase(),
}));
vi.mock('../helpers/validation.helper', () => ({
  getStringQueryParam: vi.fn((req: { query?: Record<string, unknown> }, key: string) => (typeof req.query?.[key] === 'string' ? req.query[key] : undefined)),
}));
vi.mock('../helpers/linux-forward.helper', () => ({ getLinuxForwardDomain: vi.fn(() => 'linux.com') }));
vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: vi.fn(),
  getEffectiveEmail: vi.fn(),
  getEffectiveSub: vi.fn(),
  getEffectiveUsername: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));
vi.mock('../utils/meeting-invite-lock', () => ({
  withMeetingInviteLock: vi.fn((_req: unknown, _username: string, _ttlMs: number, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
// Every other constructed service on ProfileController — stubbed to a plain object; this suite
// only exercises the Flow C callback path, which never calls them.
vi.mock('../services/auth0.service', () => ({ Auth0Service: stubConstructor }));
vi.mock('../services/cdp.service', () => ({ CdpService: stubConstructor }));
vi.mock('../services/email-verification.service', () => ({ EmailVerificationService: stubConstructor }));
vi.mock('../services/enrollment.service', () => ({ EnrollmentService: stubConstructor }));
vi.mock('../services/forwards.service', () => ({ ForwardsService: stubConstructor }));
vi.mock('../services/meeting-preference.service', () => ({ MeetingPreferenceService: stubConstructor }));
vi.mock('../services/object-store.service', () => ({ ObjectStoreService: stubConstructor }));
vi.mock('../services/user.service', () => ({ UserService: stubConstructor }));
vi.mock('../services/social-verification.service', () => ({
  SocialVerificationService: vi.fn(function (this: { getPendingSocialConnect: () => null; clearPendingSocialConnect: () => void }) {
    this.getPendingSocialConnect = vi.fn(() => null);
    this.clearPendingSocialConnect = vi.fn();
  }),
}));
vi.mock('../services/profile-auth.service', () => ({
  ProfileAuthService: vi.fn(function (this: object) {
    return profileAuthSvc;
  }),
}));
// The only fake in this suite that matters: AuthStateService (imported normally below, real
// implementation) talks to Valkey exclusively through this module.
vi.mock('../services/valkey.service', () => ({
  valkeyService: fakeValkey,
  buildAuthStateCacheKey: (state: string) => `lfx-ui:auth-state:v1:${state}`,
}));

import { AuthStateService } from '../services/auth-state.service';

import { ProfileController } from './profile.controller';

function buildReq(overrides: Record<string, unknown> = {}): any {
  return { headers: {}, query: {}, appSession: {}, oidc: undefined, ...overrides };
}

function buildRes(): any {
  return { redirect: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis(), set: vi.fn() };
}

describe('ProfileController + real AuthStateService — Flow C survives a concurrent session write (#1938 review)', () => {
  let controller: ProfileController;

  beforeEach(() => {
    fakeValkey.store.clear();
    vi.clearAllMocks();
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.decodeAndValidateSub.mockReturnValue(true);
    profileAuthSvc.exchangeCodeForToken.mockResolvedValue({ access_token: 'tok', token_type: 'Bearer', scope: 'openid', expires_in: 3600 });
    controller = new ProfileController();
  });

  it('a nonce issued for one session survives a concurrent stale-session overwrite and is accepted exactly once', async () => {
    // Issue directly via the real AuthStateService, mirroring what ProfileAuthService.getAuthorizationUrl
    // does internally — this is the real class, backed by the fake Valkey store above.
    const authStateService = new AuthStateService();
    const state = await authStateService.issue(buildReq(), 'user-1', '/profile/identities');

    // Simulate express-openid-connect's blind full-object session write: a concurrent request's
    // stale snapshot (taken before /auth/start ran) replaces appSession by the time the callback
    // request lands — it has no trace of the nonce (#1938).
    const callbackReq = buildReq({ query: { code: 'c', state }, oidc: { user: { sub: 'user-1' } }, appSession: {} });
    const res = buildRes();

    await controller.handleProfileAuthCallback(callbackReq, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile/identities?success=profile_token_obtained');

    // Single-use: replaying the same state on a second callback must fail, proving the atomic
    // GETDEL — not a mock — actually removed the record.
    const replayReq = buildReq({ query: { code: 'c2', state }, oidc: { user: { sub: 'user-1' } }, appSession: {} });
    const replayRes = buildRes();
    await controller.handleProfileAuthCallback(replayReq, replayRes);

    // The nonce is already gone (single-use), so the record's returnTo is unavailable — the
    // rejection falls back to the default /profile path, not the original /profile/identities.
    expect(replayRes.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
  });

  it('rejects a nonce issued to a different sub, even though the record is present (#1938)', async () => {
    const authStateService = new AuthStateService();
    const state = await authStateService.issue(buildReq(), 'user-1', '/profile/identities');

    const callbackReq = buildReq({ query: { code: 'c', state }, oidc: { user: { sub: 'someone-else' } }, appSession: {} });
    const res = buildRes();

    await controller.handleProfileAuthCallback(callbackReq, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile/identities?error=invalid_state');
  });

  it('fails closed — never falls back to session — when the GETDEL read faults (dealako review, PR #2604)', async () => {
    const authStateService = new AuthStateService();
    const state = await authStateService.issue(buildReq(), 'user-1', '/profile/identities');

    // Simulate an uncertain GETDEL outcome (client-side timeout racing the real delete): the
    // record is still physically present in the fake store, but the read reports `fault` rather
    // than `hit` or `miss`.
    fakeValkey.getdelJson.mockResolvedValueOnce({ status: 'fault' });

    const callbackReq = buildReq({ query: { code: 'c', state }, oidc: { user: { sub: 'user-1' } }, appSession: {} });
    const res = buildRes();

    await controller.handleProfileAuthCallback(callbackReq, res);

    // A fault must be treated the same as an authoritative miss — no session fallback, no
    // acceptance of the nonce (auth-state.service.ts's fail-closed-on-fault guarantee).
    expect(res.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
  });
});
