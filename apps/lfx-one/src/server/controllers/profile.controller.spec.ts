// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getUsernameFromAuthMock, generateM2MTokenMock, objectStoreSvc, userSvc, profileAuthSvc } = vi.hoisted(() => ({
  getUsernameFromAuthMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
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
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({ isIdentityAlreadyLinkedError: vi.fn(() => false) }));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: getUsernameFromAuthMock,
  getEffectiveEmail: vi.fn(),
  getEffectiveSub: vi.fn(),
  getEffectiveUsername: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
vi.mock('../helpers/linux-forward.helper', () => ({ getLinuxForwardDomain: vi.fn() }));
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
    return {};
  }),
}));
vi.mock('../services/enrollment.service', () => ({
  EnrollmentService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/forwards.service', () => ({
  ForwardsService: vi.fn(function () {
    return {};
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
});
