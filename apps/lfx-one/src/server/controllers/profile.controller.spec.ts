// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real values, not hand-copied literals — so a future TTL retune (see LFXV2 #2241) can't leave
// this spec's assertions asserting a value the product no longer uses.
import { VALKEY_CACHE } from '../../../../../packages/shared/src/constants/valkey-cache.constants';
import { API_GATEWAY_AUTH } from '../../../../../packages/shared/src/constants/api-gateway-auth.constants';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  getUsernameFromAuthMock,
  generateM2MTokenMock,
  getEffectiveEmailMock,
  getEffectiveSubMock,
  isImpersonatingMock,
  getLinuxForwardDomainMock,
  withMeetingInviteLockMock,
  objectStoreSvc,
  userSvc,
  profileAuthSvc,
  emailVerificationSvc,
  cdpSvc,
  forwardsSvc,
  enrollmentSvc,
  meetingPrefSvc,
  socialVerificationSvc,
  authStateSvc,
} = vi.hoisted(() => ({
  getUsernameFromAuthMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveSubMock: vi.fn(),
  isImpersonatingMock: vi.fn(() => false),
  getLinuxForwardDomainMock: vi.fn(() => 'linux.com'),
  withMeetingInviteLockMock: vi.fn((_req: unknown, _username: string, _ttlMs: number, fn: () => Promise<unknown>) => fn()),
  meetingPrefSvc: {
    getMeetingInviteEmail: vi.fn(),
    setMeetingInviteEmail: vi.fn(),
  },
  objectStoreSvc: {
    uploadProfilePicture: vi.fn(),
    ensureBucket: vi.fn(),
    readiness: vi.fn(),
  },
  userSvc: {
    updateUserMetadata: vi.fn(),
    getUserInfo: vi.fn(),
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
    linkIdentity: vi.fn(),
    unlinkIdentity: vi.fn(),
  },
  cdpSvc: { rejectIdentityForUser: vi.fn() },
  forwardsSvc: {
    getForward: vi.fn(),
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
  API_GATEWAY_AUTH,
  ALLOWED_AVATAR_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  AUTH0_TO_CDP_PROVIDER_MAP: {},
  CDP_DISPLAYABLE_IDENTITY_COMBOS: [],
  CDP_PLATFORM_ICONS: {},
  CDP_PLATFORM_TO_TYPE_MAP: {},
  CDP_TO_AUTH0_PROVIDER_MAP: {},
  EMAIL_ALREADY_LINKED_MESSAGE: 'already linked',
  EMAIL_REGEX: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/,
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
  isIdentityAlreadyLinkedError: vi.fn(() => false),
  isMeetingInvitePrimarySentinel: (value: string | null | undefined) => (value ?? '').trim().toLowerCase() === 'primary',
  emailsEqual: (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase(),
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: getUsernameFromAuthMock,
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveSub: getEffectiveSubMock,
  getEffectiveUsername: vi.fn(),
  isImpersonating: isImpersonatingMock,
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
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

  it.each(['required', 'unavailable', 'not_configured'] as const)(
    'classifies a missing Gateway token (%s) without falling back to the primary token',
    async (status) => {
      const next = vi.fn();
      const res = buildRes();

      await controller.getMeetingInviteEmail(buildReq({ bearerToken: 'primary-token', apiGatewayAuthStatus: status }), res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: status === 'required' ? 'API_GATEWAY_AUTH_REQUIRED' : 'SERVICE_UNAVAILABLE',
          statusCode: status === 'required' ? 403 : 503,
          operation: 'get_meeting_invite_email',
          service: 'profile_controller',
        })
      );
      if (status === 'required') {
        expect(next.mock.calls[0][0].toResponse()).toMatchObject({ details: { authorize_url: '/api-gateway/auth/start' } });
      } else {
        expect(next.mock.calls[0][0].message).toBe('Meeting invitation email settings are temporarily unavailable. Please refresh the page and try again.');
      }
      expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );

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

  it('keeps email validation ahead of the new authorization challenge', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(
      buildSetReq({ email: 'not-an-email' }, { apiGatewayToken: undefined, apiGatewayAuthStatus: 'required' }),
      buildRes(),
      next
    );

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

  it.each(['required', 'unavailable', 'not_configured'] as const)(
    'classifies a missing Gateway token (%s) before locking or writing the preference',
    async (status) => {
      const next = vi.fn();
      const res = buildRes();

      await controller.setMeetingInviteEmail(
        buildSetReq({ email: 'invite@example.com' }, { apiGatewayToken: undefined, bearerToken: 'primary-token', apiGatewayAuthStatus: status }),
        res,
        next
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: status === 'required' ? 'API_GATEWAY_AUTH_REQUIRED' : 'SERVICE_ADVISORY',
          statusCode: status === 'required' ? 403 : 503,
          operation: 'set_meeting_invite_email',
          service: 'profile_controller',
        })
      );
      if (status === 'required') {
        expect(next.mock.calls[0][0].toResponse()).toMatchObject({ details: { authorize_url: '/api-gateway/auth/start' } });
      } else {
        expect(next.mock.calls[0][0].message).toBe('Meeting invitation email settings are temporarily unavailable. Please refresh the page and try again.');
      }
      expect(meetingPrefSvc.setMeetingInviteEmail).not.toHaveBeenCalled();
      expect(withMeetingInviteLockMock).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );

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
    controller = new ProfileController();
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

  it.each(['required', 'unavailable'] as const)('does not challenge a non-email removal when Gateway authorization is %s', async (status) => {
    const res = buildRes();
    const next = vi.fn();
    const req = buildRejectReq({}, { apiGatewayToken: undefined, apiGatewayAuthStatus: status, params: { identityId: 'cdp-identity' } });

    await controller.rejectIdentity(req, res, next);

    expect(cdpSvc.rejectIdentityForUser).toHaveBeenCalledExactlyOnceWith(req, 'testuser', 'cdp-identity');
    expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
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

  it.each(['required', 'unavailable', 'not_configured'] as const)(
    'classifies a missing Gateway token (%s) before unlinking or rejecting an email identity',
    async (status) => {
      profileAuthSvc.getManagementToken.mockReturnValue('mgmt-token');
      const res = buildRes();
      const next = vi.fn();

      await controller.rejectIdentity(
        buildRejectReq(
          { email: 'someone@example.com', provider: 'email', auth0UserId: 'synthetic-provider-id' },
          { apiGatewayToken: undefined, bearerToken: 'primary-token', apiGatewayAuthStatus: status, params: { identityId: 'cdp-identity' } }
        ),
        res,
        next
      );

      if (status === 'required') {
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'API_GATEWAY_AUTH_REQUIRED', statusCode: 403 }));
        expect(next.mock.calls[0][0].toResponse()).toMatchObject({ details: { authorize_url: '/api-gateway/auth/start' } });
        expect(res.json).not.toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
          error: 'meeting_invite_email_active',
          message: 'Could not confirm your meeting-invitation email. Please try again.',
        });
        expect(next).not.toHaveBeenCalled();
      }
      expect(meetingPrefSvc.getMeetingInviteEmail).not.toHaveBeenCalled();
      expect(emailVerificationSvc.unlinkIdentity).not.toHaveBeenCalled();
      expect(cdpSvc.rejectIdentityForUser).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );

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
