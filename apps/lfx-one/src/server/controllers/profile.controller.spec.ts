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
} = vi.hoisted(() => ({
  getUsernameFromAuthMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveSubMock: vi.fn(),
  isImpersonatingMock: vi.fn(() => false),
  getLinuxForwardDomainMock: vi.fn(() => 'linux.com'),
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
  EMAIL_REGEX: /.+/,
  PURCHASE_LINUX_URL: 'https://example.com',
  PROFILE_EMAIL_PATH: '/profile/email',
  PROFILE_EMAILS_PATH: '/profile/emails',
  PROFILE_PASSWORD_PATH: '/profile/password',
  PROFILE_SETTINGS_PATH: '/profile/settings',
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({ isIdentityAlreadyLinkedError: vi.fn(() => false) }));

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
