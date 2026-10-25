// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real values, not hand-copied literals — so a future TTL retune (see LFXV2 #2241) can't leave
// this spec's assertions asserting a value the product no longer uses.
import { VALKEY_CACHE } from '../../../../../packages/shared/src/constants/valkey-cache.constants';
import {
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_CALLBACK_RETRY_REQUIRED_STATUS,
  EMAIL_CALLBACK_STATUS_PARAM,
  EMAIL_SEND_CODE_RATE_LIMIT_WINDOW_MS,
  EMAIL_SEND_CODE_TARGET_RATE_LIMIT_MAX,
  EMAIL_SEND_CODE_USER_RATE_LIMIT_MAX,
  EMAIL_VERIFICATION_FAILED_ERROR,
  EMAIL_VERIFICATION_FAILED_MESSAGE,
  EMAIL_VERIFICATION_MIN_RESPONSE_MS,
  EMAIL_VERIFICATION_SENT_MESSAGE,
} from '../../../../../packages/shared/src/constants/profile.constants';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  getUsernameFromAuthMock,
  getEffectiveUsernameMock,
  generateM2MTokenMock,
  getEffectiveEmailMock,
  getEffectiveSubMock,
  isImpersonatingMock,
  isIdentityAlreadyLinkedErrorMock,
  getLinuxForwardDomainMock,
  withMeetingInviteLockMock,
  populateApiGatewayTokenMock,
  objectStoreSvc,
  cdpSvc,
  userSvc,
  profileAuthSvc,
  emailVerificationSvc,
  forwardsSvc,
  enrollmentSvc,
  meetingPrefSvc,
  socialVerificationSvc,
  authStateSvc,
  auth0ToCdpProviderMap,
  cdpPlatformToTypeMap,
} = vi.hoisted(() => ({
  // Empty by default; suites that need provider mappings populate them and clear them afterwards.
  auth0ToCdpProviderMap: {} as Record<string, string>,
  cdpPlatformToTypeMap: {} as Record<string, string>,
  getUsernameFromAuthMock: vi.fn(),
  getEffectiveUsernameMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveSubMock: vi.fn(),
  isImpersonatingMock: vi.fn(() => false),
  isIdentityAlreadyLinkedErrorMock: vi.fn(() => false),
  getLinuxForwardDomainMock: vi.fn(() => 'linux.com'),
  withMeetingInviteLockMock: vi.fn((_req: unknown, _username: string, _ttlMs: number, fn: () => Promise<unknown>) => fn()),
  populateApiGatewayTokenMock: vi.fn(),
  meetingPrefSvc: {
    getMeetingInviteEmail: vi.fn(),
    setMeetingInviteEmail: vi.fn(),
  },
  objectStoreSvc: {
    uploadProfilePicture: vi.fn(),
    ensureBucket: vi.fn(),
    readiness: vi.fn(),
  },
  cdpSvc: {
    getIdentitiesForUser: vi.fn(),
    verifyIdentityForUser: vi.fn(),
    rejectIdentityForUser: vi.fn(),
  },
  userSvc: {
    updateUserMetadata: vi.fn(),
    getUserInfo: vi.fn(),
    syncVerifiedEmailToUserService: vi.fn(),
  },
  profileAuthSvc: {
    isProfileAuthConfigured: vi.fn(() => false),
    getManagementToken: vi.fn(),
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    decodeAndValidateSub: vi.fn(),
    storeManagementToken: vi.fn(),
  },
  emailVerificationSvc: {
    getUserEmails: vi.fn(),
    setPrimaryEmail: vi.fn(),
    sendPasswordResetLink: vi.fn(),
    sendVerificationCode: vi.fn(),
    resolveEmailToUsername: vi.fn(),
    resolveEmailToSub: vi.fn(),
    verifyOtp: vi.fn(),
    linkIdentity: vi.fn(),
    listIdentities: vi.fn(),
    addAlias: vi.fn(),
  },
  forwardsSvc: {
    getForward: vi.fn(),
    checkAlias: vi.fn(),
    setTarget: vi.fn(),
  },
  enrollmentSvc: {
    hasLinuxComAddon: vi.fn(),
  },
  socialVerificationSvc: {
    validateState: vi.fn(() => true),
    clearState: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    isValidProvider: vi.fn(() => true),
    getAuthorizeUrl: vi.fn(() => 'https://auth.example.com/authorize'),
    storePendingSocialConnect: vi.fn(),
    storeConnectReturnTo: vi.fn(),
    getConnectReturnTo: vi.fn(),
    clearConnectReturnTo: vi.fn(),
    getPendingSocialConnect: vi.fn(),
    clearPendingSocialConnect: vi.fn(),
  },
  authStateSvc: {
    issue: vi.fn(),
    consume: vi.fn(),
  },
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', () => ({
  ALLOWED_AVATAR_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  AUTH0_TO_CDP_PROVIDER_MAP: auth0ToCdpProviderMap,
  CDP_DISPLAYABLE_IDENTITY_COMBOS: [],
  CDP_PLATFORM_ICONS: {},
  CDP_PLATFORM_TO_TYPE_MAP: cdpPlatformToTypeMap,
  CDP_TO_AUTH0_PROVIDER_MAP: {},
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_CALLBACK_RETRY_REQUIRED_STATUS,
  EMAIL_CALLBACK_STATUS_PARAM,
  EMAIL_REGEX: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/,
  EMAIL_VERIFICATION_SENT_MESSAGE,
  EMAIL_VERIFICATION_FAILED_ERROR,
  EMAIL_VERIFICATION_FAILED_MESSAGE,
  EMAIL_VERIFICATION_MIN_RESPONSE_MS,
  EMAIL_SEND_CODE_RATE_LIMIT_WINDOW_MS,
  EMAIL_SEND_CODE_USER_RATE_LIMIT_MAX,
  EMAIL_SEND_CODE_TARGET_RATE_LIMIT_MAX,
  // Only the member the write path sets. This factory replaces the module wholesale, so a name the
  // controller reads and this list omits fails as an undefined export rather than a wrong value.
  ERROR_CODES: { SERVICE_ADVISORY: 'SERVICE_ADVISORY' },
  PURCHASE_LINUX_URL: 'https://example.com',
  VALKEY_CACHE,
  PROFILE_EMAIL_PATH: '/profile/email',
  PROFILE_EMAILS_PATH: '/profile/emails',
  PROFILE_PASSWORD_PATH: '/profile/password',
  PROFILE_SETTINGS_PATH: '/profile/settings',
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// validation.helper pulls in a heavy shared/constants + shared/enums graph; stub it
// wholesale so only the controller's getStringQueryParam usage loads.
vi.mock('../helpers/validation.helper', () => ({
  getStringQueryParam: vi.fn((req: any, key: string) => (typeof req.query?.[key] === 'string' ? req.query[key] : undefined)),
}));
vi.mock('@lfx-one/shared/utils', () => ({
  isIdentityAlreadyLinkedError: isIdentityAlreadyLinkedErrorMock,
  isMeetingInvitePrimarySentinel: (value: string | null | undefined) => (value ?? '').trim().toLowerCase() === 'primary',
  emailsEqual: (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase(),
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: getUsernameFromAuthMock,
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveSub: getEffectiveSubMock,
  getEffectiveUsername: getEffectiveUsernameMock,
  isImpersonating: isImpersonatingMock,
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
// The callback path populates the gateway audience token through the shared helper (the helper owns
// the API_GW_AUDIENCE/env wiring and the session cache) — mocked so no real Auth0 call leaves the unit test.
vi.mock('../utils/refresh-token-exchange.util', () => ({ populateApiGatewayToken: populateApiGatewayTokenMock }));
// Unit-tested separately in meeting-invite-lock.spec.ts — here it's a passthrough so controller specs exercise
// the wrapped logic without needing a real/mocked Valkey backend.
vi.mock('../utils/meeting-invite-lock', () => ({
  withMeetingInviteLock: withMeetingInviteLockMock,
}));
vi.mock('../helpers/linux-forward.helper', () => ({ getLinuxForwardDomain: getLinuxForwardDomainMock }));
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

vi.mock('../services/auth0.service', () => ({
  Auth0Service: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/cdp.service', () => ({
  CdpService: vi.fn(function () {
    return cdpSvc;
  }),
}));
vi.mock('../services/email-verification.service', () => ({
  EmailVerificationService: vi.fn(function () {
    return emailVerificationSvc;
  }),
}));
vi.mock('../services/enrollment.service', () => ({
  EnrollmentService: vi.fn(function () {
    return enrollmentSvc;
  }),
}));
vi.mock('../services/forwards.service', () => ({
  ForwardsService: vi.fn(function () {
    return forwardsSvc;
  }),
}));
vi.mock('../services/meeting-preference.service', () => ({
  MeetingPreferenceService: vi.fn(function () {
    return meetingPrefSvc;
  }),
}));
vi.mock('../services/social-verification.service', () => ({
  SocialVerificationService: vi.fn(function () {
    return socialVerificationSvc;
  }),
}));
vi.mock('../services/object-store.service', () => ({
  ObjectStoreService: vi.fn(function () {
    return objectStoreSvc;
  }),
}));
vi.mock('../services/profile-auth.service', () => ({
  ProfileAuthService: vi.fn(function () {
    return profileAuthSvc;
  }),
}));
vi.mock('../services/auth-state.service', () => ({
  authStateService: authStateSvc,
}));
vi.mock('../services/user.service', () => ({
  UserService: vi.fn(function () {
    return userSvc;
  }),
}));

import { ProfileController } from './profile.controller';
import { logger } from '../services/logger.service';

function buildReq(overrides: Record<string, unknown> = {}): any {
  return {
    headers: { 'content-type': 'image/png', 'content-length': '3' },
    body: Buffer.from('img'),
    path: '/api/profile/picture-upload',
    log: {},
    ...overrides,
  };
}

function buildRes(): any {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn(), redirect: vi.fn() };
}

describe('ProfileController.uploadProfilePicture', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['M2M_AUTH_ISSUER_BASE_URL'] = 'https://auth.example.com/';
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(false);
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getUsernameFromAuthMock.mockResolvedValue('testuser');
    controller = new ProfileController();
  });

  it('rejects unauthenticated requests without touching the object store', async () => {
    getUsernameFromAuthMock.mockResolvedValue(undefined);
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(objectStoreSvc.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('rejects a disallowed content type before reading the body', async () => {
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq({ headers: { 'content-type': 'application/pdf' } }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(objectStoreSvc.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('rejects a disallowed content type when the header arrives as an array (proxied/duplicate header)', async () => {
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq({ headers: { 'content-type': ['application/pdf', 'image/png'] } }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(objectStoreSvc.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq({ body: Buffer.alloc(0) }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(objectStoreSvc.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('uploads to the object store then persists the URL via updateUserMetadata, responding 201', async () => {
    objectStoreSvc.uploadProfilePicture.mockResolvedValue({ url: 'https://cdn.example.com/avatars/testuser?v=1' });
    userSvc.updateUserMetadata.mockResolvedValue({ success: true });
    const res = buildRes();
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), res, next);

    expect(objectStoreSvc.uploadProfilePicture).toHaveBeenCalledWith(expect.anything(), 'testuser', expect.any(Buffer), 'image/png');
    expect(userSvc.updateUserMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ username: 'testuser', user_metadata: { picture: 'https://cdn.example.com/avatars/testuser?v=1' } })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, public_url: 'https://cdn.example.com/avatars/testuser?v=1' });
    expect(next).not.toHaveBeenCalled();
  });

  it('surfaces a CDN_NOT_CONFIGURED error when the object store returns a null url (degraded mode)', async () => {
    objectStoreSvc.uploadProfilePicture.mockResolvedValue({ url: null });
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'CDN_NOT_CONFIGURED' }));
    expect(userSvc.updateUserMetadata).not.toHaveBeenCalled();
  });

  it('routes an updateUserMetadata failure through mapUserMetadataUpdateError', async () => {
    objectStoreSvc.uploadProfilePicture.mockResolvedValue({ url: 'https://cdn.example.com/avatars/testuser?v=1' });
    userSvc.updateUserMetadata.mockResolvedValue({ success: false, error: 'something broke' });
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR', statusCode: 500 }));
  });

  it('responds 403 management_token_required when Flow C is configured but no management token is in session', async () => {
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue(undefined);
    const res = buildRes();
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'management_token_required',
      message: 'Profile authorization required',
      authorize_url: '/api/profile/auth/start?returnTo=/profile',
    });
    expect(objectStoreSvc.uploadProfilePicture).not.toHaveBeenCalled();
    expect(userSvc.updateUserMetadata).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates an object-store upload failure via next(error)', async () => {
    const uploadError = new Error('put failed');
    objectStoreSvc.uploadProfilePicture.mockRejectedValue(uploadError);
    const res = buildRes();
    const next = vi.fn();

    await controller.uploadProfilePicture(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(uploadError);
    expect(res.status).not.toHaveBeenCalled();
    expect(userSvc.updateUserMetadata).not.toHaveBeenCalled();
  });
});

describe('ProfileController.getMeetingInviteEmail', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProfileController();
  });

  // Plain SERVICE_UNAVAILABLE, unlike the write path below. `extractErrorMessage` reads a 5xx body
  // only under SERVICE_ADVISORY, and setting it here would buy nothing: the caller swallows this
  // response into an `inviteLoadFailed` flag and renders its own copy, so the message reaches nobody.
  it('responds 503 without calling the meeting service when the v1 api-gateway token is missing', async () => {
    const next = vi.fn();

    await controller.getMeetingInviteEmail(buildReq({ apiGatewayToken: undefined }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 }));
    expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('returns the override when the meeting service resolves one', async () => {
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: 'id-1', email: 'invite@example.com' });
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingInviteEmail(buildReq({ apiGatewayToken: 'v1-token' }), res, next);

    expect(meetingPrefSvc.getMeetingInviteEmail).toHaveBeenCalledWith(expect.anything(), 'v1-token');
    expect(res.json).toHaveBeenCalledWith({ email_id: 'id-1', email: 'invite@example.com' });
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a 503 rather than normalizing a failed fetch to the no-override shape', async () => {
    // The service returns null only on failure — a confirmed no-override comes back as a non-null
    // `{ email_id: null, email: null }`. Normalizing null to that same shape would make a real
    // outage indistinguishable from "no override" to the client, silently disabling its
    // delete/remove fail-closed guard.
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingInviteEmail(buildReq({ apiGatewayToken: 'v1-token' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('propagates an unexpected service rejection via next(error)', async () => {
    const boom = new Error('meeting service exploded');
    meetingPrefSvc.getMeetingInviteEmail.mockRejectedValue(boom);
    const res = buildRes();
    const next = vi.fn();

    await controller.getMeetingInviteEmail(buildReq({ apiGatewayToken: 'v1-token' }), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ProfileController.setMeetingInviteEmail', () => {
  let controller: ProfileController;

  function buildSetReq(body: unknown, overrides: Record<string, unknown> = {}): any {
    return buildReq({ body, path: '/api/profile/emails/meeting-invite', apiGatewayToken: 'v1-token', ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getUsernameFromAuthMock.mockResolvedValue('testuser');
    controller = new ProfileController();
  });

  it('rejects with a 400 instead of silently skipping the lock when the username cannot be resolved', async () => {
    getUsernameFromAuthMock.mockResolvedValue(undefined);
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invitee@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
    expect(withMeetingInviteLockMock).not.toHaveBeenCalled();
  });

  it('rejects a missing email with a 400 instead of reaching the service', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({}), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('coerces a non-string email to a 400 rather than throwing a 500', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: { address: 'nope' } }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed email address with a 400', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'not-an-email' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('lets the reset sentinel through the email-format gate', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: true, data: { email_id: null, email: null } });
    const res = buildRes();
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'primary' }), res, next);

    expect(meetingPrefSvc.setMeetingInviteEmail).toHaveBeenCalledWith(expect.anything(), 'v1-token', 'primary');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ email_id: null, email: null });
    expect(next).not.toHaveBeenCalled();
  });

  // SERVICE_ADVISORY, not SERVICE_UNAVAILABLE — the code is what carries this message past the
  // frontend's blanket 5xx skip and into the toast. All three write-path 503s below assert it for
  // the same reason; a status alone could not, since a forwarded upstream 503 shares it.
  it('responds 503 without calling the meeting service when the v1 api-gateway token is missing', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }, { apiGatewayToken: undefined }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_ADVISORY', statusCode: 503 }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('responds 200 with the updated preference on success', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: true, data: { email_id: 'id-2', email: 'invite@example.com' } });
    const res = buildRes();
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ email_id: 'id-2', email: 'invite@example.com' });
    expect(next).not.toHaveBeenCalled();
    expect(withMeetingInviteLockMock).toHaveBeenCalledWith(expect.anything(), 'testuser', VALKEY_CACHE.MEETING_INVITE_SET_LOCK_TTL_MS, expect.any(Function));
  });

  it('maps a validation failure to a 400 carrying the actionable message, not the raw upstream error', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'validation', error: 'email_id not found' });
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'This email is not an active, verified address on your account yet. Choose a different email, or verify it and try again.',
      })
    );
  });

  it('maps a sync_pending failure to a 503 with retry copy', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'sync_pending' });
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SERVICE_ADVISORY',
        statusCode: 503,
        message: 'This email was added recently and is not ready to use yet. Please try again in a few minutes.',
      })
    );
  });

  it('maps an unavailable failure to a 503 naming the meeting service', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'unavailable' });
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SERVICE_ADVISORY',
        statusCode: 503,
        message: 'The meeting service is temporarily unavailable. Please try again in a few minutes.',
      })
    );
  });

  it('maps an upstream failure to a 502', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'upstream' });
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_GATEWAY', statusCode: 502 }));
  });

  it('falls back to a 502 when the service reports failure without a reason', async () => {
    meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false });
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_GATEWAY', statusCode: 502 }));
  });

  it('surfaces a lock-contention rejection as a 409 without calling the meeting service', async () => {
    withMeetingInviteLockMock.mockRejectedValueOnce(Object.assign(new Error('conflicting request'), { statusCode: 409, code: 'LOCK_CONTENTION' }));
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'LOCK_CONTENTION' }));
    expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
  });
});

describe('ProfileController.rejectIdentity — meeting-invite guard (Copilot review, PR #1073)', () => {
  let controller: ProfileController;

  // Synthetic (auth0:-prefixed) identityId — skips the CDP rejection call so these tests can focus
  // on the meeting-invite guard added ahead of it.
  function buildRejectReq(body: unknown, overrides: Record<string, unknown> = {}): any {
    return buildReq({
      params: { identityId: 'auth0:user-1' },
      body,
      path: '/api/profile/identities/auth0:user-1',
      apiGatewayToken: 'v1-token',
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getUsernameFromAuthMock.mockResolvedValue('testuser');
    getEffectiveUsernameMock.mockReturnValue('testuser');
    controller = new ProfileController();
  });

  it('fails closed with a 401, touching no CDP record, when no IdP-asserted LFID resolves', async () => {
    // A claimless session resolves to null through both helpers (getUsernameFromAuth delegates).
    getUsernameFromAuthMock.mockResolvedValue(null);
    getEffectiveUsernameMock.mockReturnValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({}), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(cdpSvc.rejectIdentityForUser).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('skips the guard entirely for a non-email identity removal (no email in the body)', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({}), res, next);

    expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
    expect(withMeetingInviteLockMock).not.toHaveBeenCalled();
  });

  it('blocks removal with a 409 when the address matches the active meeting-invite email (case-insensitive)', async () => {
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: 'id-1', email: 'invite@example.com' });
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({ email: 'Invite@Example.com' }), res, next);

    expect(meetingPrefSvc.getMeetingInviteEmail).toHaveBeenCalledWith(expect.anything(), 'v1-token');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'meeting_invite_email_active',
      message: 'This email is set to receive meeting invitations. Choose a different meeting-invitation email before removing it.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed with a 409 when there is no v1 api-gateway token to check the preference with', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({ email: 'someone@example.com' }, { apiGatewayToken: undefined }), res, next);

    expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'meeting_invite_email_active',
      message: 'Could not confirm your meeting-invitation email. Please try again.',
    });
  });

  it('fails closed with a 409 when the preference lookup itself fails (service returns null)', async () => {
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({ email: 'someone@example.com' }), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not confirm your meeting-invitation email. Please try again.' }));
  });

  it('allows removal when the address does not match the active meeting-invite email', async () => {
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: 'id-1', email: 'other@example.com' });
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({ email: 'someone@example.com' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
    expect(withMeetingInviteLockMock).toHaveBeenCalledWith(expect.anything(), 'testuser', VALKEY_CACHE.MEETING_INVITE_LOCK_TTL_MS, expect.any(Function));
  });

  it('surfaces a lock-contention rejection as a 409 without rejecting the identity', async () => {
    meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: 'id-1', email: 'other@example.com' });
    withMeetingInviteLockMock.mockRejectedValueOnce(Object.assign(new Error('conflicting request'), { statusCode: 409, code: 'LOCK_CONTENTION' }));
    const res = buildRes();
    const next = vi.fn();

    await controller.rejectIdentity(buildRejectReq({ email: 'someone@example.com' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'LOCK_CONTENTION' }));
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ProfileController.getLinuxAlias', () => {
  let controller: ProfileController;

  const claimedEmails = { primary_email: 'user@example.com', alternate_emails: [{ email: 'alias@linux.com' }] };

  beforeEach(() => {
    vi.clearAllMocks();
    getLinuxForwardDomainMock.mockReturnValue('linux.com');
    getEffectiveSubMock.mockReturnValue('auth0|user123');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    isImpersonatingMock.mockReturnValue(false);
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(false);
    profileAuthSvc.getManagementToken.mockReturnValue(undefined);
    emailVerificationSvc.getUserEmails.mockResolvedValue(claimedEmails);
    controller = new ProfileController();
  });

  it('reports forwardAuthRequired without authorizeUrl when Flow C is not configured', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getLinuxAlias(buildReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'claimed', forwardAuthRequired: true }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('authorizeUrl');
    expect(forwardsSvc.getForward).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('reports forwardAuthRequired with authorizeUrl when Flow C is configured but no management token is in session', async () => {
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    const res = buildRes();
    const next = vi.fn();

    await controller.getLinuxAlias(buildReq({ headers: { referer: '/profile/linux-email' } }), res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'claimed',
        forwardAuthRequired: true,
        authorizeUrl: '/api/profile/auth/start?returnTo=%2Fprofile%2Flinux-email',
      })
    );
  });

  it('omits forwardAuthRequired and reads the forward target when a management token is present', async () => {
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    forwardsSvc.getForward.mockResolvedValue({ target_email: 'forward@example.com' });
    const res = buildRes();
    const next = vi.fn();

    await controller.getLinuxAlias(buildReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'claimed', forwardTo: 'forward@example.com' }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('forwardAuthRequired');
  });

  it('degrades to service_unavailable when a management token is present but the forward is unreadable', async () => {
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    forwardsSvc.getForward.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.getLinuxAlias(buildReq(), res, next);

    expect(res.json).toHaveBeenCalledWith({
      state: 'service_unavailable',
      domain: 'linux.com',
      alias: null,
      email: null,
      forwardTo: null,
      primaryEmail: null,
    });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('forwardAuthRequired');
    expect(next).not.toHaveBeenCalled();
  });

  it('suppresses forwardAuthRequired during impersonation even without a management token', async () => {
    isImpersonatingMock.mockReturnValue(true);
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    const res = buildRes();
    const next = vi.fn();

    await controller.getLinuxAlias(buildReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'claimed', forwardTo: null }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('forwardAuthRequired');
    expect(forwardsSvc.getForward).not.toHaveBeenCalled();
  });
});

describe('ProfileController Linux.com forward target ownership', () => {
  let controller: ProfileController;

  const forwardDomain = 'alias.example';
  const ownedEmails = {
    primary_email: 'User@Example.com',
    alternate_emails: [
      { email: 'verified-alt@example.com', verified: true },
      { email: 'unverified-alt@example.com', verified: false },
    ],
  };

  const claimReq = (forwardTo: string): any => buildReq({ body: { alias: 'myalias', forwardTo }, path: '/api/profile/linux-email/claim' });
  const updateReq = (forwardTo: string): any => buildReq({ body: { forwardTo }, path: '/api/profile/linux-email/forward' });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(auth0ToCdpProviderMap, { 'google-oauth2': 'google', github: 'github', email: 'email' });
    Object.assign(cdpPlatformToTypeMap, { google: 'email', email: 'email', github: 'username' });
    getLinuxForwardDomainMock.mockReturnValue(forwardDomain);
    getEffectiveSubMock.mockReturnValue('auth0|user123');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    enrollmentSvc.hasLinuxComAddon.mockResolvedValue(true);
    forwardsSvc.checkAlias.mockResolvedValue({ exists: false });
    forwardsSvc.setTarget.mockImplementation(async (_req: unknown, _token: string, target: string) => ({ target_email: target }));
    emailVerificationSvc.addAlias.mockResolvedValue({ success: true, email: `myalias@${forwardDomain}` });
    emailVerificationSvc.getUserEmails.mockResolvedValue(ownedEmails);
    emailVerificationSvc.listIdentities.mockResolvedValue([]);
    controller = new ProfileController();
  });

  afterEach(() => {
    for (const map of [auth0ToCdpProviderMap, cdpPlatformToTypeMap]) {
      for (const key of Object.keys(map)) {
        delete map[key];
      }
    }
  });

  describe('claimLinuxAlias', () => {
    it('rejects a target the caller does not own before claiming the alias', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('someone-else@example.org'), res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
      expect(forwardsSvc.setTarget).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('accepts the primary email case-insensitively and forwards to the stored address', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('  USER@example.COM '), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(emailVerificationSvc.getUserEmails).toHaveBeenCalledWith(expect.anything(), 'auth0|user123');
      expect(forwardsSvc.setTarget).toHaveBeenCalledWith(expect.anything(), 'mgmt-token', 'User@Example.com', forwardDomain);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ state: 'claimed', forwardTo: 'User@Example.com' }));
    });

    it('accepts a verified alternate email', async () => {
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('verified-alt@example.com'), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(forwardsSvc.setTarget).toHaveBeenCalledWith(expect.anything(), 'mgmt-token', 'verified-alt@example.com', forwardDomain);
    });

    it('rejects an unverified alternate email', async () => {
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('unverified-alt@example.com'), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
    });

    it('rejects a target on the forward domain itself', async () => {
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq(`other@${forwardDomain}`), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(emailVerificationSvc.getUserEmails).not.toHaveBeenCalled();
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
    });

    it('accepts an email from a linked email-type identity', async () => {
      emailVerificationSvc.listIdentities.mockResolvedValue([
        { provider: 'google-oauth2', user_id: 'g-1', profileData: { email: 'linked@example.net' } },
        { provider: 'github', user_id: 'gh-1', profileData: { email: 'gh-only@example.net', nickname: 'octo' } },
      ]);
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('linked@example.net'), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(forwardsSvc.setTarget).toHaveBeenCalledWith(expect.anything(), 'mgmt-token', 'linked@example.net', forwardDomain);
    });

    it('rejects an email that only appears on a non-email identity', async () => {
      emailVerificationSvc.listIdentities.mockResolvedValue([
        { provider: 'github', user_id: 'gh-1', profileData: { email: 'gh-only@example.net', nickname: 'octo' } },
      ]);
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('gh-only@example.net'), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when the caller email list is unavailable', async () => {
      emailVerificationSvc.getUserEmails.mockResolvedValue(null);
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('user@example.com'), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
    });

    it('propagates an identity-list outage instead of claiming', async () => {
      const outage = new Error('identity list unavailable');
      emailVerificationSvc.listIdentities.mockRejectedValue(outage);
      const next = vi.fn();

      await controller.claimLinuxAlias(claimReq('user@example.com'), buildRes(), next);

      expect(next).toHaveBeenCalledWith(outage);
      expect(emailVerificationSvc.addAlias).not.toHaveBeenCalled();
    });
  });

  describe('updateLinuxForward', () => {
    it('rejects a target the caller does not own without calling set_target', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.updateLinuxForward(updateReq('someone-else@example.org'), res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(forwardsSvc.setTarget).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('rejects an unverified alternate email', async () => {
      const next = vi.fn();

      await controller.updateLinuxForward(updateReq('unverified-alt@example.com'), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(forwardsSvc.setTarget).not.toHaveBeenCalled();
    });

    it('updates the forward to a verified alternate email', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.updateLinuxForward(updateReq('Verified-Alt@example.com'), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(forwardsSvc.setTarget).toHaveBeenCalledWith(expect.anything(), 'mgmt-token', 'verified-alt@example.com', forwardDomain);
      expect(res.json).toHaveBeenCalledWith({ forwardTo: 'verified-alt@example.com' });
    });
  });
});

describe('ProfileController.setPrimaryEmail', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    controller = new ProfileController();
  });

  it('responds 403 management_token_required with the /profile/emails authorize_url when no management token is in session', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue(undefined);
    const res = buildRes();
    const next = vi.fn();

    await controller.setPrimaryEmail(buildReq({ params: { emailId: 'user@example.com' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'management_token_required',
      message: 'Profile authorization required to change the primary email',
      authorize_url: '/api/profile/auth/start?returnTo=%2Fprofile%2Femails',
    });
    expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // Meeting invites stick to an address, not the primary role (#3983).
  describe('meeting-invite pin', () => {
    const OLD_PRIMARY = 'old-primary@example.com';
    const NEW_PRIMARY = 'new-primary@example.com';

    function buildPrimaryReq(overrides: Record<string, unknown> = {}): any {
      return buildReq({ params: { emailId: NEW_PRIMARY }, path: `/api/profile/emails/${NEW_PRIMARY}/primary`, apiGatewayToken: 'v1-token', ...overrides });
    }

    beforeEach(() => {
      profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
      getUsernameFromAuthMock.mockResolvedValue('testuser');
      getEffectiveSubMock.mockReturnValue('auth0|testuser');
      meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: null, email: null });
      emailVerificationSvc.getUserEmails.mockResolvedValue({ primary_email: OLD_PRIMARY, alternate_emails: [] });
      meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: true, data: { email_id: 'id-old', email: OLD_PRIMARY } });
      emailVerificationSvc.setPrimaryEmail.mockResolvedValue({ success: true });
    });

    it('pins the current primary as the invite email before switching the primary, under the invite lock', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), res, next);

      expect(withMeetingInviteLockMock).toHaveBeenCalledWith(expect.anything(), 'testuser', VALKEY_CACHE.MEETING_INVITE_LOCK_TTL_MS, expect.any(Function));
      expect(emailVerificationSvc.getUserEmails).toHaveBeenCalledWith(expect.anything(), 'auth0|testuser');
      expect(meetingPrefSvc.setMeetingInviteEmail).toHaveBeenCalledWith(expect.anything(), 'v1-token', OLD_PRIMARY);
      expect(meetingPrefSvc.setMeetingInviteEmail.mock.invocationCallOrder[0]).toBeLessThan(emailVerificationSvc.setPrimaryEmail.mock.invocationCallOrder[0]);
      expect(emailVerificationSvc.setPrimaryEmail).toHaveBeenCalledWith(expect.anything(), 'mgmt-token', NEW_PRIMARY);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(next).not.toHaveBeenCalled();
    });

    it('leaves an existing override alone', async () => {
      meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue({ email_id: 'id-alt', email: 'alt@example.com' });
      const res = buildRes();

      await controller.setPrimaryEmail(buildPrimaryReq(), res, vi.fn());

      expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
      expect(emailVerificationSvc.setPrimaryEmail).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('skips the pin when the target is already the primary', async () => {
      emailVerificationSvc.getUserEmails.mockResolvedValue({ primary_email: ` ${NEW_PRIMARY.toUpperCase()} `, alternate_emails: [] });
      const res = buildRes();

      await controller.setPrimaryEmail(buildPrimaryReq(), res, vi.fn());

      expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it.each([
      ['the invite preference lookup fails', () => meetingPrefSvc.getMeetingInviteEmail.mockResolvedValue(null)],
      ['the current primary cannot be resolved', () => emailVerificationSvc.getUserEmails.mockResolvedValue(null)],
      ['the pin write fails', () => meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'unavailable', error: 'down' })],
    ])('blocks the primary change with a 503 advisory when %s', async (_label, arrange) => {
      arrange();
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_ADVISORY', statusCode: 503 }));
      expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    });

    it('blocks with a 400 pointing at the invite setting, not a retry, when the pin is rejected as invalid', async () => {
      meetingPrefSvc.setMeetingInviteEmail.mockResolvedValue({ success: false, reason: 'validation', error: 'not an active, verified address' });
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: expect.stringContaining('Choose a different address for meeting invitations') })
      );
      expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    });

    it('keeps the pin and responds 502 when the primary switch itself fails after pinning', async () => {
      emailVerificationSvc.setPrimaryEmail.mockResolvedValue({ success: false, message: 'auth-service down' });
      const res = buildRes();
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), res, next);

      expect(meetingPrefSvc.setMeetingInviteEmail).toHaveBeenCalledWith(expect.anything(), 'v1-token', OLD_PRIMARY);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 502 }));
      expect(res.status).not.toHaveBeenCalled();
    });

    it('never logs the email address', async () => {
      await controller.setPrimaryEmail(buildPrimaryReq(), buildRes(), vi.fn());

      expect(logger.startOperation).toHaveBeenCalledWith(expect.anything(), 'set_primary_email');
      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'set_primary_email', expect.anything(), { pinned_invite: true });
    });

    it('blocks the primary change with a 503 advisory when the v1 api-gateway token is missing', async () => {
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq({ apiGatewayToken: undefined }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_ADVISORY', statusCode: 503 }));
      expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
      expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    });

    it('rejects with a 400 instead of skipping the lock when the username cannot be resolved', async () => {
      getUsernameFromAuthMock.mockResolvedValue(undefined);
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }));
      expect(withMeetingInviteLockMock).not.toHaveBeenCalled();
      expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    });

    it('forwards lock contention without changing the primary', async () => {
      const conflict = Object.assign(new Error('conflicting request'), { statusCode: 409, code: 'LOCK_CONTENTION' });
      withMeetingInviteLockMock.mockRejectedValueOnce(conflict);
      const next = vi.fn();

      await controller.setPrimaryEmail(buildPrimaryReq(), buildRes(), next);

      expect(next).toHaveBeenCalledWith(conflict);
      expect(emailVerificationSvc.setPrimaryEmail).not.toHaveBeenCalled();
    });
  });
});

describe('ProfileController.sendPasswordResetEmail', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    controller = new ProfileController();
  });

  it('responds 403 management_token_required with the /profile/password authorize_url when no management token is in session', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue(undefined);
    const res = buildRes();
    const next = vi.fn();

    await controller.sendPasswordResetEmail(buildReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'management_token_required',
      message: 'Profile authorization required to send a password reset link',
      authorize_url: '/api/profile/auth/start?returnTo=%2Fprofile%2Fpassword',
    });
    expect(emailVerificationSvc.sendPasswordResetLink).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('ProfileController.startProfileAuth — returnTo allowlist', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(false);
    controller = new ProfileController();
  });

  it('falls back to /profile for the dead /settings entry — the profile shell never mounts there', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.startProfileAuth(buildReq({ query: { returnTo: '/settings' } }), res, next);

    expect(res.redirect).toHaveBeenCalledWith('/profile?error=profile_auth_not_configured');
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps /profile/settings as an allowed returnTo', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.startProfileAuth(buildReq({ query: { returnTo: '/profile/settings' } }), res, next);

    expect(res.redirect).toHaveBeenCalledWith('/profile/settings?error=profile_auth_not_configured');
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejected getAuthorizationUrl to next instead of leaving it unhandled', async () => {
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    const error = new Error('valkey unavailable');
    profileAuthSvc.getAuthorizationUrl.mockRejectedValue(error);
    const res = buildRes();
    const next = vi.fn();

    await controller.startProfileAuth(buildReq({ query: {} }), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.redirect).not.toHaveBeenCalled();
  });
});

// The Add-identity dialog opens from the mentorship registration form as well as the Identities
// tab, and connecting an account leaves the page for Auth0, so the flow carries the page to come
// back to. Same allowlist as Flow C, defaulting to the Identities tab.
describe('ProfileController social connect — returnTo', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    isImpersonatingMock.mockReturnValue(false);
    socialVerificationSvc.isValidProvider.mockReturnValue(true);
    socialVerificationSvc.getAuthorizeUrl.mockReturnValue('https://auth.example.com/authorize');
    controller = new ProfileController();
  });

  it('stashes the page that started the connect, since the callback only carries Auth0 params', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    const res = buildRes();

    await controller.startSocialConnect(buildReq({ query: { provider: 'github', returnTo: '/mentorship/mentor' } }), res);

    expect(socialVerificationSvc.storeConnectReturnTo).toHaveBeenCalledWith(expect.anything(), '/mentorship/mentor');
    expect(res.redirect).toHaveBeenCalledWith('https://auth.example.com/authorize');
  });

  it('refuses a returnTo that is not an allowlisted page, so the flow cannot be aimed elsewhere', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    const res = buildRes();

    await controller.startSocialConnect(buildReq({ query: { provider: 'github', returnTo: 'https://evil.example.com/steal' } }), res);

    expect(socialVerificationSvc.storeConnectReturnTo).toHaveBeenCalledWith(expect.anything(), '/profile/identities');
  });

  it('carries the returnTo through the Flow C chain when there is no management token yet', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue(undefined);
    const res = buildRes();

    await controller.startSocialConnect(buildReq({ query: { provider: 'github', returnTo: '/mentorship/mentor' } }), res);

    expect(socialVerificationSvc.storePendingSocialConnect).toHaveBeenCalledWith(expect.anything(), 'github', '/mentorship/mentor');
    expect(res.redirect).toHaveBeenCalledWith('/api/profile/auth/start?returnTo=%2Fmentorship%2Fmentor');
  });

  it('sends a failed handshake back to the page that started it', async () => {
    socialVerificationSvc.getConnectReturnTo.mockReturnValue('/mentorship/mentor');
    const res = buildRes();

    await controller.handleSocialCallback(buildReq({ path: '/social/callback', query: { error: 'access_denied' } }), res);

    expect(res.redirect).toHaveBeenCalledWith('/mentorship/mentor?error=social_auth_failed');
    // Cleared on the way through, so the next callback can't inherit this page.
    expect(socialVerificationSvc.clearConnectReturnTo).toHaveBeenCalled();
  });

  it('falls back to the Identities tab when the session has no stashed page', async () => {
    socialVerificationSvc.getConnectReturnTo.mockReturnValue(undefined);
    const res = buildRes();

    await controller.handleSocialCallback(buildReq({ path: '/social/callback', query: { error: 'access_denied' } }), res);

    expect(res.redirect).toHaveBeenCalledWith('/profile/identities?error=social_auth_failed');
  });
});

// The root callbacks (/passwordless/callback, /social/callback in server.ts) are redirect-only and
// sit outside the /api error-handler mount, so they enforce impersonation read-only in-handler via
// blockCallbackDuringImpersonation rather than the blockDuringImpersonation route middleware.
describe('ProfileController impersonation-blocked auth callbacks', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProfileController();
  });

  it('handleProfileAuthCallback redirects to the default returnTo without consuming the nonce or exchanging the code', async () => {
    isImpersonatingMock.mockReturnValue(true);
    const res = buildRes();
    const req = buildReq({ path: '/passwordless/callback', query: { code: 'c', state: 's' } });

    await controller.handleProfileAuthCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile?error=impersonation_read_only');
    // Not consumed: a still-valid nonce must survive a blocked callback so it can be retried
    // after impersonation ends, instead of being burned by the destructive GETDEL.
    expect(authStateSvc.consume).not.toHaveBeenCalled();
    expect(profileAuthSvc.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('handleProfileAuthCallback falls through to the normal invalid_state branch when not impersonating', async () => {
    isImpersonatingMock.mockReturnValue(false);
    authStateSvc.consume.mockResolvedValue(null); // consume() already rejected the mismatched/unknown nonce
    const res = buildRes();
    const req = buildReq({ path: '/passwordless/callback', query: { code: 'c', state: 'mismatched' } });

    await controller.handleProfileAuthCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
  });

  it('handleSocialCallback redirects to /profile/identities without linking the identity', async () => {
    isImpersonatingMock.mockReturnValue(true);
    // Without a management token, the unguarded path would also stop before exchangeCodeForToken/
    // linkIdentity (at the no_management_token branch) — stub it so those assertions can actually
    // fail if the impersonation guard regresses.
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    const res = buildRes();

    await controller.handleSocialCallback(buildReq({ path: '/social/callback', query: { code: 'c', state: 's' } }), res);

    expect(res.redirect).toHaveBeenCalledWith('/profile/identities?error=impersonation_read_only');
    expect(socialVerificationSvc.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(emailVerificationSvc.linkIdentity).not.toHaveBeenCalled();
  });
});

// express-openid-connect reads the whole session once per request and blind-overwrites it on every
// response (#1938) — a concurrent request's stale snapshot can wipe req.appSession.profileAuthState
// between /auth/start and the callback. Flow C's CSRF nonce now lives in AuthStateService, entirely
// outside req.appSession, so validation must depend only on the consumed record, never on session
// contents. These tests exercise that boundary directly against the (mocked) AuthStateService.
describe('ProfileController Flow C state survives a concurrent session write (#1938)', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    isImpersonatingMock.mockReturnValue(false);
    profileAuthSvc.exchangeCodeForToken.mockResolvedValue({ access_token: 'tok', token_type: 'Bearer', scope: 'openid', expires_in: 3600 });
    profileAuthSvc.decodeAndValidateSub.mockReturnValue(true);
    socialVerificationSvc.getPendingSocialConnect.mockReturnValue(undefined);
    controller = new ProfileController();
  });

  function buildCallbackReq(overrides: Record<string, unknown> = {}): any {
    return buildReq({
      path: '/passwordless/callback',
      query: { code: 'c', state: 'nonce-1' },
      oidc: { user: { sub: 'user-1' } },
      ...overrides,
    });
  }

  it('a stale session snapshot (concurrent write wiped profileAuthState) does not block a nonce AuthStateService already validated', async () => {
    authStateSvc.consume.mockResolvedValue({ sub: 'user-1', createdAt: Date.now() });
    const res = buildRes();
    // Simulates the library's blind full-object write: a concurrent request's snapshot, taken
    // before /auth/start ran, has no trace of the nonce at all.
    const req = buildCallbackReq({ appSession: {} });

    await controller.handleProfileAuthCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile?success=profile_token_obtained');
    expect(profileAuthSvc.exchangeCodeForToken).toHaveBeenCalledWith(req, 'c');
  });

  it('mirror case: a nonce AuthStateService could not validate is rejected even with an unrelated appSession present', async () => {
    authStateSvc.consume.mockResolvedValue(null); // unknown/expired/already-consumed nonce
    const res = buildRes();
    const req = buildCallbackReq({ appSession: { profileAuthState: 'nonce-1' } }); // stale session value is irrelevant now

    await controller.handleProfileAuthCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
    expect(profileAuthSvc.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects a nonce that was issued to a different sub', async () => {
    authStateSvc.consume.mockResolvedValue({ sub: 'someone-else', createdAt: Date.now() });
    const res = buildRes();
    const req = buildCallbackReq();

    await controller.handleProfileAuthCallback(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
    expect(profileAuthSvc.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  // Single-use replay rejection is enforced by AuthStateService.consume's atomic GETDEL (covered in
  // auth-state.service.spec.ts), not by this controller. This test only checks that the controller
  // correctly propagates whatever `consume()` returns on each call — a null second result (as a
  // replayed nonce would produce) still redirects to invalid_state.
  it('propagates a null consume result on the second callback as invalid_state', async () => {
    authStateSvc.consume.mockResolvedValueOnce({ sub: 'user-1', createdAt: Date.now() }).mockResolvedValueOnce(null);
    const firstRes = buildRes();
    const secondRes = buildRes();

    await controller.handleProfileAuthCallback(buildCallbackReq(), firstRes);
    expect(firstRes.redirect).toHaveBeenCalledWith('/profile?success=profile_token_obtained');

    await controller.handleProfileAuthCallback(buildCallbackReq(), secondRes);
    expect(secondRes.redirect).toHaveBeenCalledWith('/profile?error=invalid_state');
  });
});

describe('ProfileController.getDeveloperTokenInfo — v1 token omission (Copilot review, PR #2379)', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    isImpersonatingMock.mockReturnValue(false);
    getUsernameFromAuthMock.mockResolvedValue('user-1');
    controller = new ProfileController();
  });

  it('returns only the bearer token and type, with no v1Token in the response even when a v1 gateway token is present', async () => {
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    // apiGatewayToken is set here to prove the omission is real: pre-fix code derived v1Token
    // from this field, so a regression that reintroduces that logic would fail this assertion.
    await controller.getDeveloperTokenInfo(buildReq({ bearerToken: 'session-bearer-token', apiGatewayToken: 'v1-gateway-token' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ token: 'session-bearer-token', type: 'Bearer' });
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ v1Token: expect.anything() }));
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a validation error and skips the response when no bearer token is present', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.getDeveloperTokenInfo(buildReq({ bearerToken: undefined }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(res.json).not.toHaveBeenCalled();
  });
});

/**
 * getCurrentUserProfile — real member-since date sourced from the NATS envelope's top-level
 * `created_at` (#2836/#2837), never a fabricated timestamp. Covers both the impersonating and
 * non-impersonating branches, plus the NATS-failure/absent-field fallback to ''.
 */
describe('ProfileController.getCurrentUserProfile — created_at (#2837)', () => {
  let controller: ProfileController;

  function buildProfileReq(overrides: Record<string, unknown> = {}): any {
    return buildReq({
      path: '/api/profile',
      oidc: { user: { sub: 'auth0|user-1', email: 'user@example.com' } },
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isImpersonatingMock.mockReturnValue(false);
    getUsernameFromAuthMock.mockResolvedValue('testuser');
    controller = new ProfileController();
  });

  it('uses the real NATS created_at when not impersonating', async () => {
    userSvc.getUserInfo.mockResolvedValue({ success: true, data: { name: 'Test User' }, created_at: '2023-03-15T10:00:00Z' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '2023-03-15T10:00:00Z' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the real NATS created_at while impersonating', async () => {
    isImpersonatingMock.mockReturnValue(true);
    getEffectiveSubMock.mockReturnValue('auth0|target-user');
    getEffectiveEmailMock.mockReturnValue('target@example.com');
    userSvc.getUserInfo.mockResolvedValue({ success: true, data: { name: 'Target User' }, created_at: '2022-01-01T00:00:00Z' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '2022-01-01T00:00:00Z' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to empty string (never a fabricated timestamp) when the NATS read fails', async () => {
    userSvc.getUserInfo.mockResolvedValue({ success: false, error: 'upstream unavailable' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to empty string while impersonating when the NATS read fails', async () => {
    isImpersonatingMock.mockReturnValue(true);
    getEffectiveSubMock.mockReturnValue('auth0|target-user');
    getEffectiveEmailMock.mockReturnValue('target@example.com');
    userSvc.getUserInfo.mockResolvedValue({ success: false, error: 'upstream unavailable' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps the real created_at when the read succeeds with no stored metadata (data absent)', async () => {
    userSvc.getUserInfo.mockResolvedValue({ success: true, created_at: '2023-03-15T10:00:00Z' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '2023-03-15T10:00:00Z' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  // Pre-#90-deploy compatibility: a successful legacy reply that carries no created_at at all
  // must never fall back to a fabricated timestamp — only an empty string.
  it('falls back to empty string when a successful reply omits created_at entirely', async () => {
    userSvc.getUserInfo.mockResolvedValue({ success: true, data: { name: 'Test User' } });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to empty string while impersonating when a successful reply omits created_at entirely', async () => {
    isImpersonatingMock.mockReturnValue(true);
    getEffectiveSubMock.mockReturnValue('auth0|target-user');
    getEffectiveEmailMock.mockReturnValue('target@example.com');
    userSvc.getUserInfo.mockResolvedValue({ success: true, data: { name: 'Target User' } });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to empty string when a successful reply has an empty created_at', async () => {
    userSvc.getUserInfo.mockResolvedValue({ success: true, data: { name: 'Test User' }, created_at: '' });
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to empty string (never a fabricated timestamp) when getUserInfo throws', async () => {
    userSvc.getUserInfo.mockRejectedValue(new Error('upstream timeout'));
    const res = { ...buildRes(), set: vi.fn() };
    const next = vi.fn();

    await controller.getCurrentUserProfile(buildProfileReq(), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ created_at: '' }) }));
    expect(next).not.toHaveBeenCalled();
  });
});

// lfx-self-serve-ops#183: after a successful OTP verify + identity link the BFF upserts the address
// into v1 as Active+IsVerified — awaited, but fail-open so verification never breaks on a v1 error.
describe('ProfileController.verifyAndLinkEmail — v1 verified-email sync (lfx-self-serve-ops#183)', () => {
  const verifiedEmail = 'secondary@example.com';
  let controller: ProfileController;

  function buildVerifyReq(): any {
    return buildReq({
      path: '/api/profile/identities/email/verify',
      body: { email: verifiedEmail, otp: '123456' },
      oidc: { user: { sub: 'auth0|user-1', username: 'user-1' } },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('M2M_AUTH_ISSUER_BASE_URL', '');
    controller = new ProfileController();

    getUsernameFromAuthMock.mockResolvedValue('auth0|user-1');
    getEffectiveUsernameMock.mockReturnValue('user-1');
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
    emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'id-token' } });
    emailVerificationSvc.linkIdentity.mockResolvedValue({ success: true });
    cdpSvc.getIdentitiesForUser.mockResolvedValue([]);
    userSvc.syncVerifiedEmailToUserService.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('syncs the verified address to v1 after a successful identity link', async () => {
    const req = buildVerifyReq();
    const res = buildRes();

    await controller.verifyAndLinkEmail(req, res, vi.fn());

    expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalledWith(req, verifiedEmail);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Email identity verified and linked successfully' });
  });

  it('still returns 200 success when the v1 sync reports failure (fail-open)', async () => {
    userSvc.syncVerifiedEmailToUserService.mockResolvedValue(false);
    const res = buildRes();

    await controller.verifyAndLinkEmail(buildVerifyReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Email identity verified and linked successfully' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('holds the success response until the v1 sync settles (awaited, not fire-and-forget)', async () => {
    let resolveSync!: (synced: boolean) => void;
    userSvc.syncVerifiedEmailToUserService.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSync = resolve;
        })
    );
    const res = buildRes();

    const pending = controller.verifyAndLinkEmail(buildVerifyReq(), res, vi.fn());
    // One macrotask drains the already-resolved upstream mocks, so execution has reached the sync call.
    await new Promise((resolve) => setImmediate(resolve));

    expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();

    resolveSync(true);
    await pending;

    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Email identity verified and linked successfully' });
  });

  it('callback path: populates the gateway token via the shared helper, then syncs the pending verification email', async () => {
    populateApiGatewayTokenMock.mockImplementation(async (req: any) => {
      req.apiGatewayToken = 'fresh-gw-token';
    });
    authStateSvc.consume.mockResolvedValue({ sub: 'auth0|user-1', returnTo: '/profile/emails' });
    profileAuthSvc.exchangeCodeForToken.mockResolvedValue({ access_token: 'mgmt-token', token_type: 'Bearer', scope: '', expires_in: 3600 });
    profileAuthSvc.decodeAndValidateSub.mockReturnValue(true);
    const req = buildReq({
      path: '/api/profile/auth/callback',
      query: { state: 'state-1', code: 'code-1' },
      oidc: { user: { sub: 'auth0|user-1', username: 'user-1' } },
      appSession: { pendingEmailVerification: { email: 'pending@example.com', otp: '654321' } },
    });
    const res = buildRes();

    await controller.handleProfileAuthCallback(req, res);

    expect(populateApiGatewayTokenMock).toHaveBeenCalledWith(req);
    // The v1 sync needs the populated token — the helper must run before it.
    expect(populateApiGatewayTokenMock.mock.invocationCallOrder[0]).toBeLessThan(userSvc.syncVerifiedEmailToUserService.mock.invocationCallOrder[0]);
    expect(req.apiGatewayToken).toBe('fresh-gw-token');
    expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalledWith(req, 'pending@example.com');
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('success=profile_token_obtained'));
  });

  it('callback path: holds the redirect until the v1 sync settles (awaited, not fire-and-forget)', async () => {
    authStateSvc.consume.mockResolvedValue({ sub: 'auth0|user-1', returnTo: '/profile/emails' });
    profileAuthSvc.exchangeCodeForToken.mockResolvedValue({ access_token: 'mgmt-token', token_type: 'Bearer', scope: '', expires_in: 3600 });
    profileAuthSvc.decodeAndValidateSub.mockReturnValue(true);
    let resolveSync!: (synced: boolean) => void;
    userSvc.syncVerifiedEmailToUserService.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSync = resolve;
        })
    );
    const req = buildReq({
      path: '/api/profile/auth/callback',
      query: { state: 'state-1', code: 'code-1' },
      oidc: { user: { sub: 'auth0|user-1', username: 'user-1' } },
      appSession: { pendingEmailVerification: { email: 'pending@example.com', otp: '654321' } },
    });
    const res = buildRes();

    const pending = controller.handleProfileAuthCallback(req, res);
    // One macrotask drains the already-resolved upstream mocks, so execution has reached the sync call.
    await new Promise((resolve) => setImmediate(resolve));

    expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalledWith(req, 'pending@example.com');
    expect(res.redirect).not.toHaveBeenCalled();

    resolveSync(true);
    await pending;

    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('success=profile_token_obtained'));
  });
});

describe('ProfileController.sendEmailVerification — enumeration-safe (lfx-self-serve-ops#443)', () => {
  let controller: ProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    getUsernameFromAuthMock.mockResolvedValue('lf-fixture-sender');
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(false);
    // A regression that awaited owner resolution would never produce a response.
    emailVerificationSvc.resolveEmailToUsername.mockImplementation(() => new Promise(() => undefined));
    emailVerificationSvc.resolveEmailToSub.mockImplementation(() => new Promise(() => undefined));
    controller = new ProfileController();
  });

  afterEach(() => {
    vi.useRealTimers();
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(false);
    emailVerificationSvc.resolveEmailToUsername.mockReset();
    emailVerificationSvc.resolveEmailToSub.mockReset();
  });

  it.each([false, true])('returns the same generic 200 after the floor (linked=%s)', async (linked) => {
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(linked);
    emailVerificationSvc.sendVerificationCode.mockResolvedValue(
      linked ? { success: false, error: 'email already linked', message: 'upstream conflict wording' } : { success: true, message: 'upstream sent wording' }
    );
    const req = buildReq({ body: { email: 'typed@example.test' }, path: '/api/profile/identities/email/send-code' });
    const res = buildRes();
    const next = vi.fn();
    const pending = controller.sendEmailVerification(req, res, next);

    await vi.advanceTimersByTimeAsync(EMAIL_VERIFICATION_MIN_RESPONSE_MS - 1);
    expect(res.json).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
    expect(next).not.toHaveBeenCalled();
    const warnings = vi.mocked(logger.warning).mock.calls.map(([, , message, metadata]) => ({ message, metadata }));
    const successes = vi.mocked(logger.success).mock.calls.map(([, , , metadata]) => metadata);
    expect(JSON.stringify({ warnings, successes })).not.toContain('typed@example.test');
    expect(JSON.stringify({ warnings, successes })).not.toContain('linked_to');
  });

  it('does not add another floor after a slow upstream send', async () => {
    emailVerificationSvc.sendVerificationCode.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), EMAIL_VERIFICATION_MIN_RESPONSE_MS + 200))
    );
    const res = buildRes();
    const pending = controller.sendEmailVerification(buildReq({ body: { email: 'fresh@example.test' } }), res, vi.fn());
    await vi.advanceTimersByTimeAsync(EMAIL_VERIFICATION_MIN_RESPONSE_MS + 199);
    expect(res.json).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
  });

  it.each([400, 503])('preserves a non-conflict %s response after the floor', async (status) => {
    const response = { success: false, error: status === 503 ? 'Service temporarily unavailable' : 'invalid email', message: 'Try again later' };
    emailVerificationSvc.sendVerificationCode.mockResolvedValue(response);
    const res = buildRes();
    const pending = controller.sendEmailVerification(buildReq({ body: { email: 'fresh@example.test' } }), res, vi.fn());
    await vi.advanceTimersByTimeAsync(EMAIL_VERIFICATION_MIN_RESPONSE_MS - 1);
    expect(res.json).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(res.status).toHaveBeenCalledExactlyOnceWith(status);
    expect(res.json).toHaveBeenCalledExactlyOnceWith(response);
  });
});

describe('ProfileController.verifyAndLinkEmail — step-2 failures are indistinguishable', () => {
  let controller: ProfileController;

  function verificationReq(): any {
    return buildReq({ body: { email: 'typed@example.test', otp: '000000' }, path: '/api/profile/identities/email/verify' });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubEnv('M2M_AUTH_ISSUER_BASE_URL', '');
    getEffectiveUsernameMock.mockReturnValue('lf-fixture-verifier');
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue('synthetic-management-token');
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(false);
    controller = new ProfileController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(false);
  });

  it.each(['email already linked', 'failed to exchange OTP for token: invalid code', 'expired otp', undefined])(
    'masks the upstream failure %s with the same floor-held 400',
    async (error) => {
      isIdentityAlreadyLinkedErrorMock.mockReturnValue(error === 'email already linked');
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: false, error, message: 'upstream-specific message' });
      const res = buildRes();
      const pending = controller.verifyAndLinkEmail(verificationReq(), res, vi.fn());
      await vi.advanceTimersByTimeAsync(EMAIL_VERIFICATION_MIN_RESPONSE_MS - 1);
      expect(res.json).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(res.status).toHaveBeenCalledExactlyOnceWith(400);
      expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: false, error: EMAIL_VERIFICATION_FAILED_ERROR, message: EMAIL_VERIFICATION_FAILED_MESSAGE });
      expect(emailVerificationSvc.linkIdentity).not.toHaveBeenCalled();
      expect(userSvc.syncVerifiedEmailToUserService).not.toHaveBeenCalled();
    }
  );

  it('preserves service-unavailable failures as 503 without a verification delay', async () => {
    const response = { success: false, error: 'Service temporarily unavailable', message: 'Try again later' };
    emailVerificationSvc.verifyOtp.mockResolvedValue(response);
    const res = buildRes();
    await controller.verifyAndLinkEmail(verificationReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledExactlyOnceWith(503);
    expect(res.json).toHaveBeenCalledExactlyOnceWith(response);
  });

  it('keeps token_missing distinct after a successful OTP with no identity token', async () => {
    emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true });
    const res = buildRes();
    await controller.verifyAndLinkEmail(verificationReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledExactlyOnceWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'token_missing' }));
    expect(emailVerificationSvc.linkIdentity).not.toHaveBeenCalled();
  });

  it('still exposes a conflict only after the OTP succeeds', async () => {
    emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
    emailVerificationSvc.linkIdentity.mockResolvedValue({ success: false, error: 'email already linked' });
    emailVerificationSvc.resolveEmailToUsername.mockResolvedValue('lf-fixture-owner');
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(true);
    const res = buildRes();
    await controller.verifyAndLinkEmail(verificationReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledExactlyOnceWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'email already linked' }));
    expect(userSvc.syncVerifiedEmailToUserService).not.toHaveBeenCalled();
  });

  it('requires management authorization before consuming the OTP', async () => {
    profileAuthSvc.getManagementToken.mockReturnValue(null);
    const res = buildRes();
    await controller.verifyAndLinkEmail(verificationReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledExactlyOnceWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'management_token_required' }));
    expect(emailVerificationSvc.verifyOtp).not.toHaveBeenCalled();
  });
});

// auth-service (lfx-v2-auth-service#114) recognizes an address already connected to the caller when
// the OTP request carries the caller's own Flow C token, and replies with a token-free success.
describe('ProfileController — already-connected email (#4253)', () => {
  const ownedEmail = 'owned@example.test';
  const alreadyConnectedReply = { success: true, message: 'email already connected to this account', data: { status: 'already_connected' } };
  let controller: ProfileController;

  function verifyReq(): any {
    return buildReq({
      path: '/api/profile/identities/email/verify',
      body: { email: ownedEmail, otp: '123456' },
      oidc: { user: { sub: 'auth0|user-1', username: 'user-1' } },
    });
  }

  function expectNoWrites(): void {
    expect(emailVerificationSvc.linkIdentity).not.toHaveBeenCalled();
    expect(populateApiGatewayTokenMock).not.toHaveBeenCalled();
    expect(userSvc.syncVerifiedEmailToUserService).not.toHaveBeenCalled();
    expect(cdpSvc.getIdentitiesForUser).not.toHaveBeenCalled();
    expect(cdpSvc.verifyIdentityForUser).not.toHaveBeenCalled();
    expect(cdpSvc.rejectIdentityForUser).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('M2M_AUTH_ISSUER_BASE_URL', '');
    isImpersonatingMock.mockReturnValue(false);
    isIdentityAlreadyLinkedErrorMock.mockReturnValue(false);
    getEffectiveUsernameMock.mockReturnValue('user-1');
    profileAuthSvc.isProfileAuthConfigured.mockReturnValue(true);
    profileAuthSvc.getManagementToken.mockReturnValue('synthetic-user-mgmt-token');
    emailVerificationSvc.linkIdentity.mockResolvedValue({ success: true });
    cdpSvc.getIdentitiesForUser.mockResolvedValue([]);
    userSvc.syncVerifiedEmailToUserService.mockResolvedValue(true);
    socialVerificationSvc.getPendingSocialConnect.mockReturnValue(undefined);
    controller = new ProfileController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('verifyAndLinkEmail', () => {
    it('returns the already-connected success without linking, syncing, or touching CDP', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue(alreadyConnectedReply);
      const req = verifyReq();
      const res = buildRes();

      await controller.verifyAndLinkEmail(req, res, vi.fn());

      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledExactlyOnceWith(req, ownedEmail, '123456', 'synthetic-user-mgmt-token');
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: true, status: EMAIL_ALREADY_CONNECTED_STATUS, message: EMAIL_ALREADY_CONNECTED_MESSAGE });
      expect(logger.success).toHaveBeenCalledExactlyOnceWith(req, 'verify_and_link_email', expect.any(Number), { status: EMAIL_ALREADY_CONNECTED_STATUS });
      expect(generateM2MTokenMock).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it('sends the user token and links a new address exactly as before, without a status', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      const req = verifyReq();
      const res = buildRes();

      await controller.verifyAndLinkEmail(req, res, vi.fn());

      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledWith(req, ownedEmail, '123456', 'synthetic-user-mgmt-token');
      expect(emailVerificationSvc.linkIdentity).toHaveBeenCalledExactlyOnceWith(req, 'synthetic-user-mgmt-token', 'synthetic-identity-token');
      expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalledWith(req, ownedEmail);
      expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: true, message: 'Email identity verified and linked successfully' });
    });

    it('keeps the legacy fallback tokenless: never forwards the M2M link credential to OTP verification', async () => {
      profileAuthSvc.isProfileAuthConfigured.mockReturnValue(false);
      generateM2MTokenMock.mockResolvedValue('synthetic-m2m-token');
      vi.stubEnv('M2M_AUTH_ISSUER_BASE_URL', 'https://issuer.example.test/');
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      const req = verifyReq();
      const res = buildRes();

      await controller.verifyAndLinkEmail(req, res, vi.fn());

      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledExactlyOnceWith(req, ownedEmail, '123456', undefined);
      expect(emailVerificationSvc.linkIdentity).toHaveBeenCalledWith(req, 'synthetic-m2m-token', 'synthetic-identity-token');
    });

    it('treats a status-only success on the tokenless fallback as malformed (token_missing)', async () => {
      profileAuthSvc.isProfileAuthConfigured.mockReturnValue(false);
      generateM2MTokenMock.mockResolvedValue('synthetic-m2m-token');
      vi.stubEnv('M2M_AUTH_ISSUER_BASE_URL', 'https://issuer.example.test/');
      emailVerificationSvc.verifyOtp.mockResolvedValue(alreadyConnectedReply);
      const res = buildRes();

      await controller.verifyAndLinkEmail(verifyReq(), res, vi.fn());

      expect(res.status).toHaveBeenCalledExactlyOnceWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'token_missing' }));
      expectNoWrites();
    });

    it.each([{ status: 'connected' }, { status: 'ALREADY_CONNECTED' }, {}])('rejects a tokenless success with data %j as token_missing', async (data) => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data });
      const res = buildRes();

      await controller.verifyAndLinkEmail(verifyReq(), res, vi.fn());

      expect(res.status).toHaveBeenCalledExactlyOnceWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'token_missing' }));
      expectNoWrites();
    });

    it('never treats an unsuccessful reply carrying the status as success (floor-held generic 400)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: false, error: 'invalid code', data: { status: 'already_connected' } });
      const res = buildRes();

      const pending = controller.verifyAndLinkEmail(verifyReq(), res, vi.fn());
      await vi.advanceTimersByTimeAsync(EMAIL_VERIFICATION_MIN_RESPONSE_MS);
      await pending;

      expect(res.status).toHaveBeenCalledExactlyOnceWith(400);
      expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: false, error: EMAIL_VERIFICATION_FAILED_ERROR, message: EMAIL_VERIFICATION_FAILED_MESSAGE });
      expectNoWrites();
    });

    it('requires management authorization before consuming the OTP', async () => {
      profileAuthSvc.getManagementToken.mockReturnValue(null);
      const req = verifyReq();
      req.appSession = {};
      const res = buildRes();

      await controller.verifyAndLinkEmail(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledExactlyOnceWith(403);
      expect(emailVerificationSvc.verifyOtp).not.toHaveBeenCalled();
      expect(req.appSession.pendingEmailVerification).toEqual({ email: ownedEmail, otp: '123456' });
    });

    it('keeps service unavailability a retryable 503', async () => {
      const response = { success: false, error: 'Service temporarily unavailable', message: 'Try again later' };
      emailVerificationSvc.verifyOtp.mockResolvedValue(response);
      const res = buildRes();

      await controller.verifyAndLinkEmail(verifyReq(), res, vi.fn());

      expect(res.status).toHaveBeenCalledExactlyOnceWith(503);
      expect(res.json).toHaveBeenCalledExactlyOnceWith(response);
    });

    it('answers a post-proof link conflict with neutral copy that never asserts another account or names the owner', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      emailVerificationSvc.linkIdentity.mockResolvedValue({ success: false, error: 'email already linked', message: 'linked to lf-fixture-owner' });
      emailVerificationSvc.resolveEmailToUsername.mockResolvedValue('lf-fixture-owner');
      isIdentityAlreadyLinkedErrorMock.mockReturnValue(true);
      const res = buildRes();

      await controller.verifyAndLinkEmail(verifyReq(), res, vi.fn());

      expect(res.status).toHaveBeenCalledExactlyOnceWith(409);
      expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: false, error: 'email already linked', message: EMAIL_ALREADY_LINKED_MESSAGE });
      expect(EMAIL_ALREADY_LINKED_MESSAGE).not.toMatch(/another account/i);
      expect(JSON.stringify(res.json.mock.calls)).not.toContain('lf-fixture-owner');
    });
  });

  describe('handleProfileAuthCallback with a pending email verification', () => {
    function callbackReq(appSession: Record<string, unknown> = { pendingEmailVerification: { email: ownedEmail, otp: '654321' } }): any {
      return buildReq({
        path: '/api/profile/auth/callback',
        query: { state: 'state-1', code: 'code-1' },
        oidc: { user: { sub: 'auth0|user-1', username: 'user-1' } },
        appSession,
      });
    }

    const successRedirect = '/profile/emails?success=profile_token_obtained';
    const retryRedirect = `${successRedirect}&${EMAIL_CALLBACK_STATUS_PARAM}=${EMAIL_CALLBACK_RETRY_REQUIRED_STATUS}`;

    beforeEach(() => {
      authStateSvc.consume.mockResolvedValue({ sub: 'auth0|user-1', returnTo: '/profile/emails' });
      profileAuthSvc.exchangeCodeForToken.mockResolvedValue({ access_token: 'synthetic-user-mgmt-token', token_type: 'Bearer', scope: '', expires_in: 3600 });
      profileAuthSvc.decodeAndValidateSub.mockReturnValue(true);
    });

    it('recognizes an already-connected address with the stored user token and writes nothing', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue(alreadyConnectedReply);
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(profileAuthSvc.storeManagementToken.mock.invocationCallOrder[0]).toBeLessThan(profileAuthSvc.getManagementToken.mock.invocationCallOrder[0]);
      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledExactlyOnceWith(req, ownedEmail, '654321', 'synthetic-user-mgmt-token');
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(`${successRedirect}&${EMAIL_CALLBACK_STATUS_PARAM}=${EMAIL_ALREADY_CONNECTED_STATUS}`);
      expect(req.appSession.pendingEmailVerification).toBeUndefined();
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending email already connected to this account');
      expectNoWrites();
    });

    it('links a new address with no email outcome marker (unchanged behavior)', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(emailVerificationSvc.linkIdentity).toHaveBeenCalledExactlyOnceWith(req, 'synthetic-user-mgmt-token', 'synthetic-identity-token');
      expect(userSvc.syncVerifiedEmailToUserService).toHaveBeenCalledWith(req, ownedEmail);
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(successRedirect);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending email verification completed');
    });

    it.each([
      ['gateway token population', (err: Error) => populateApiGatewayTokenMock.mockRejectedValueOnce(err)],
      ['v1 email sync', (err: Error) => userSvc.syncVerifiedEmailToUserService.mockRejectedValueOnce(err)],
    ])('keeps a completed link successful when %s fails, without logging the email', async (_label, arrange) => {
      const err = new Error('synthetic follow-up failure');
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      arrange(err);
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(logger.warning).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending verification follow-up sync failed (non-blocking)', {
        err,
      });
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending email verification completed');
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(successRedirect);
      expect(req.appSession.pendingEmailVerification).toBeUndefined();
      expect(emailVerificationSvc.linkIdentity).toHaveBeenCalledTimes(1);
      expect(cdpSvc.getIdentitiesForUser).toHaveBeenCalledWith(req, 'user-1');
    });

    it('adds no email outcome to an ordinary authorization without a pending verification', async () => {
      const res = buildRes();

      await controller.handleProfileAuthCallback(callbackReq({}), res);

      expect(emailVerificationSvc.verifyOtp).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(successRedirect);
    });

    it('does not consume the code when the user token is unavailable, and drops the attempt with the retry marker', async () => {
      profileAuthSvc.getManagementToken.mockReturnValue(null);
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(emailVerificationSvc.verifyOtp).not.toHaveBeenCalled();
      expect(req.appSession.pendingEmailVerification).toBeUndefined();
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(retryRedirect);
      expect(logger.warning).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending verification skipped: management token unavailable');
      expectNoWrites();
    });

    it.each([
      [
        'an OTP/provider failure',
        () => emailVerificationSvc.verifyOtp.mockResolvedValue({ success: false, error: 'failed to exchange OTP for token: invalid code' }),
      ],
      ['a service outage', () => emailVerificationSvc.verifyOtp.mockResolvedValue({ success: false, error: 'Service temporarily unavailable' })],
      ['a malformed tokenless success', () => emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { status: 'unexpected' } })],
      ['a thrown verification error', () => emailVerificationSvc.verifyOtp.mockRejectedValue(new Error('boom'))],
    ])('reports %s with the same generic retry marker and no link', async (_label, arrange) => {
      arrange();
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledTimes(1);
      expect(req.appSession.pendingEmailVerification).toBeUndefined();
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(retryRedirect);
      expect(logger.warning).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logger.warning).mock.calls[0][3]).not.toHaveProperty('email');
      expectNoWrites();
    });

    it('reports a link failure with the retry marker and skips the follow-up writes', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: true, data: { id_token: 'synthetic-identity-token' } });
      emailVerificationSvc.linkIdentity.mockResolvedValue({ success: false, error: 'email already linked' });
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(emailVerificationSvc.linkIdentity).toHaveBeenCalledTimes(1);
      expect(populateApiGatewayTokenMock).not.toHaveBeenCalled();
      expect(userSvc.syncVerifiedEmailToUserService).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledExactlyOnceWith(retryRedirect);
      expect(logger.warning).toHaveBeenCalledExactlyOnceWith(req, 'profile_auth_callback', 'Pending verification link failed', {
        error: 'email already linked',
      });
    });

    it('never replays the attempt: a second callback finds nothing pending', async () => {
      emailVerificationSvc.verifyOtp.mockResolvedValue({ success: false, error: 'expired otp' });
      const req = callbackReq();

      await controller.handleProfileAuthCallback(req, buildRes());
      const secondRes = buildRes();
      await controller.handleProfileAuthCallback(callbackReq(req.appSession), secondRes);

      expect(emailVerificationSvc.verifyOtp).toHaveBeenCalledTimes(1);
      expect(secondRes.redirect).toHaveBeenCalledExactlyOnceWith(successRedirect);
    });

    it('leaves the pending attempt untouched while impersonating', async () => {
      isImpersonatingMock.mockReturnValue(true);
      const req = callbackReq();
      const res = buildRes();

      await controller.handleProfileAuthCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith('/profile?error=impersonation_read_only');
      expect(emailVerificationSvc.verifyOtp).not.toHaveBeenCalled();
      expect(req.appSession.pendingEmailVerification).toEqual({ email: ownedEmail, otp: '654321' });
    });
  });
});
