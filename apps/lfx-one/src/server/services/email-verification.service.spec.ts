// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared barrels transitively pull in @angular/common (partially compiled); load the JIT
// compiler so those injectables resolve under vitest (mirrors meeting-preference.service.spec.ts).
import '@angular/compiler';

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { natsRequest, loggerMock } = vi.hoisted(() => ({
  natsRequest: vi.fn(),
  loggerMock: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./nats.service', () => ({
  NatsService: vi.fn(function () {
    return {
      getCodec: () => ({
        encode: (value: string) => new TextEncoder().encode(value),
        decode: (data: Uint8Array) => new TextDecoder().decode(data),
      }),
      request: natsRequest,
    };
  }),
}));
vi.mock('./logger.service', () => ({ logger: loggerMock }));

import { EmailVerificationService } from './email-verification.service';

const req = {} as unknown as Request;
const EMAIL = 'owned@example.test';
const OTP = '123456';
const USER_MANAGEMENT_TOKEN = 'synthetic-user-management-token';

// The service only reads `response.data`, so a reply is just the encoded JSON body.
function reply(body: unknown): { data: Uint8Array } {
  return { data: new TextEncoder().encode(JSON.stringify(body)) };
}

function decodeRequestPayload(callIndex = 0): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(natsRequest.mock.calls[callIndex][1]));
}

// Every logger argument across the suite, flattened — used to prove the token is never logged.
function loggedPayloads(): string {
  return JSON.stringify(Object.values(loggerMock).flatMap((fn) => fn.mock.calls));
}

describe('EmailVerificationService.verifyOtp', () => {
  let service: EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailVerificationService();
  });

  it('sends the caller management token as user.auth_token when one is supplied', async () => {
    natsRequest.mockResolvedValue(reply({ success: true, data: { id_token: 'synthetic-identity-token' } }));

    await service.verifyOtp(req, EMAIL, OTP, USER_MANAGEMENT_TOKEN);

    expect(natsRequest).toHaveBeenCalledExactlyOnceWith(NatsSubjects.EMAIL_VERIFY_OTP, expect.any(Uint8Array), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });
    expect(decodeRequestPayload()).toEqual({ user: { auth_token: USER_MANAGEMENT_TOKEN }, email: EMAIL, otp: OTP });
    expect(loggedPayloads()).not.toContain(USER_MANAGEMENT_TOKEN);
    expect(loggerMock.debug).toHaveBeenCalledWith(req, 'verify_email_otp', 'Verifying email OTP via NATS', { has_user_token: true });
  });

  it.each([undefined, ''])('keeps the legacy tokenless payload when the user token is %j', async (token) => {
    natsRequest.mockResolvedValue(reply({ success: true, data: { id_token: 'synthetic-identity-token' } }));

    await service.verifyOtp(req, EMAIL, OTP, token);

    expect(decodeRequestPayload()).toEqual({ email: EMAIL, otp: OTP });
    expect(loggerMock.debug).toHaveBeenCalledWith(req, 'verify_email_otp', 'Verifying email OTP via NATS', { has_user_token: false });
  });

  it('passes a token-free already-connected success through unchanged', async () => {
    const upstream = { success: true, message: 'email already connected to this account', data: { status: 'already_connected' } };
    natsRequest.mockResolvedValue(reply(upstream));

    await expect(service.verifyOtp(req, EMAIL, OTP, USER_MANAGEMENT_TOKEN)).resolves.toEqual(upstream);
  });

  it('passes an ordinary identity-token success through unchanged', async () => {
    const upstream = {
      success: true,
      data: { access_token: 'synthetic-access', id_token: 'synthetic-identity-token', scope: 'openid', expires_in: 60, token_type: 'Bearer' },
    };
    natsRequest.mockResolvedValue(reply(upstream));

    await expect(service.verifyOtp(req, EMAIL, OTP, USER_MANAGEMENT_TOKEN)).resolves.toEqual(upstream);
  });

  it('passes an upstream failure through unchanged', async () => {
    const upstream = { success: false, error: 'failed to exchange OTP for token: invalid code' };
    natsRequest.mockResolvedValue(reply(upstream));

    await expect(service.verifyOtp(req, EMAIL, OTP)).resolves.toEqual(upstream);
  });

  it.each(['timeout', '503'])('maps a NATS %s to the retryable service-unavailable response', async (message) => {
    natsRequest.mockRejectedValue(new Error(`request ${message}`));

    await expect(service.verifyOtp(req, EMAIL, OTP, USER_MANAGEMENT_TOKEN)).resolves.toEqual({
      success: false,
      error: 'Service temporarily unavailable',
      message: 'Unable to reach the verification service. Please try again later.',
    });
  });

  it('maps any other dependency error to a generic internal error', async () => {
    natsRequest.mockRejectedValue(new Error('no responders'));

    await expect(service.verifyOtp(req, EMAIL, OTP, USER_MANAGEMENT_TOKEN)).resolves.toEqual({
      success: false,
      error: 'Internal server error',
      message: 'Failed to verify code. Please try again.',
    });
    expect(loggedPayloads()).not.toContain(USER_MANAGEMENT_TOKEN);
  });
});

describe('EmailVerificationService.listIdentities', () => {
  const BEARER_TOKEN = 'synthetic-bearer-token';
  const githubIdentity = { provider: 'github', user_id: 'github-1', connection: 'github', isSocial: true, profileData: { nickname: 'test-user' } };
  const reqWithToken = { bearerToken: BEARER_TOKEN, path: '/api/profile/identities' } as unknown as Request;
  const reqWithoutToken = { path: '/api/profile/identities' } as unknown as Request;
  let service: EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailVerificationService();
  });

  it("sends the request's bearer token, not a bare sub, as user.auth_token", async () => {
    natsRequest.mockResolvedValue(reply({ success: true, data: [githubIdentity] }));

    await expect(service.listIdentities(reqWithToken)).resolves.toEqual([githubIdentity]);

    expect(natsRequest).toHaveBeenCalledExactlyOnceWith(NatsSubjects.USER_IDENTITY_LIST, expect.any(Uint8Array), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });
    expect(decodeRequestPayload()).toEqual({ user: { auth_token: BEARER_TOKEN } });
    // Skip each call's leading `req` (it carries the token by design); the logged fields must not.
    const loggedFields = JSON.stringify(Object.values(loggerMock).flatMap((fn) => fn.mock.calls.map((call: unknown[]) => call.slice(1))));
    expect(loggedFields).not.toContain(BEARER_TOKEN);
  });

  it('rejects with 401, without calling auth-service, when the request has no bearer token', async () => {
    await expect(service.listIdentities(reqWithoutToken)).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });

    expect(natsRequest).not.toHaveBeenCalled();
    expect(loggerMock.warning).not.toHaveBeenCalled();
  });

  it('maps an unsuccessful auth-service reply to AUTH_SERVICE_UNAVAILABLE', async () => {
    natsRequest.mockResolvedValue(reply({ success: false, error: 'a valid JWT token is required' }));

    await expect(service.listIdentities(reqWithToken)).rejects.toMatchObject({ statusCode: 503, code: 'AUTH_SERVICE_UNAVAILABLE' });
  });

  it('maps a NATS transport failure to AUTH_SERVICE_UNAVAILABLE', async () => {
    natsRequest.mockRejectedValue(new Error('request timeout'));

    await expect(service.listIdentities(reqWithToken)).rejects.toMatchObject({ statusCode: 503, code: 'AUTH_SERVICE_UNAVAILABLE' });
  });

  it('logs a missing-token fallback only once in listIdentitiesSafe', async () => {
    await expect(service.listIdentitiesSafe(reqWithoutToken)).resolves.toEqual([]);

    expect(natsRequest).not.toHaveBeenCalled();
    expect(loggerMock.warning).toHaveBeenCalledExactlyOnceWith(reqWithoutToken, 'list_identities_safe', 'Identity list unavailable — continuing without it', {
      err: expect.objectContaining({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' }),
    });
  });

  it.each([
    ['there is no bearer token', reqWithoutToken, undefined],
    ['auth-service rejects the request', reqWithToken, { success: false, error: 'a valid JWT token is required' }],
  ])('listIdentitiesSafe degrades to an empty list when %s', async (_label, request, upstream) => {
    if (upstream) natsRequest.mockResolvedValue(reply(upstream));

    await expect(service.listIdentitiesSafe(request)).resolves.toEqual([]);
  });
});
