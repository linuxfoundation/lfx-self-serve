// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  getUsernameFromAuthMock,
  generateM2MTokenMock,
  getEffectiveEmailMock,
  getEffectiveSubMock,
  isImpersonatingMock,
  getLinuxForwardDomainMock,
  objectStoreSvc,
  userSvc,
  profileAuthSvc,
  emailVerificationSvc,
  forwardsSvc,
  enrollmentSvc,
  meetingPrefSvc,
} = vi.hoisted(() => ({
  getUsernameFromAuthMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveSubMock: vi.fn(),
  isImpersonatingMock: vi.fn(() => false),
  getLinuxForwardDomainMock: vi.fn(() => 'linux.com'),
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
  },
  profileAuthSvc: {
    isProfileAuthConfigured: vi.fn(() => false),
    getManagementToken: vi.fn(),
  },
  emailVerificationSvc: {
    getUserEmails: vi.fn(),
  },
  forwardsSvc: {
    getForward: vi.fn(),
  },
  enrollmentSvc: {
    hasLinuxComAddon: vi.fn(),
  },
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', () => ({
  ALLOWED_AVATAR_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  AUTH0_TO_CDP_PROVIDER_MAP: {},
  CDP_DISPLAYABLE_IDENTITY_COMBOS: [],
  CDP_PLATFORM_ICONS: {},
  CDP_PLATFORM_TO_TYPE_MAP: {},
  CDP_TO_AUTH0_PROVIDER_MAP: {},
  EMAIL_ALREADY_LINKED_MESSAGE: 'already linked',
  EMAIL_REGEX: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/,
  PURCHASE_LINUX_URL: 'https://example.com',
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({
  isIdentityAlreadyLinkedError: vi.fn(() => false),
  isMeetingInvitePrimarySentinel: (value: string | null | undefined) => (value ?? '').trim().toLowerCase() === 'primary',
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: getUsernameFromAuthMock,
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveSub: getEffectiveSubMock,
  getEffectiveUsername: vi.fn(),
  isImpersonating: isImpersonatingMock,
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
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
    return {};
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
    return {};
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
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
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
    controller = new ProfileController();
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

  it('responds 503 without calling the meeting service when the v1 api-gateway token is missing', async () => {
    const next = vi.fn();

    await controller.setMeetingInviteEmail(buildSetReq({ email: 'invite@example.com' }, { apiGatewayToken: undefined }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 }));
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
        code: 'SERVICE_UNAVAILABLE',
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
        code: 'SERVICE_UNAVAILABLE',
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
