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
  NatsService: vi.fn(() => ({
    getCodec: () => ({
      encode: (value: string) => new TextEncoder().encode(value),
      decode: (data: Uint8Array) => new TextDecoder().decode(data),
    }),
    request: natsRequest,
  })),
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
  });

  it.each([undefined, ''])('keeps the legacy tokenless payload when the user token is %j', async (token) => {
    natsRequest.mockResolvedValue(reply({ success: true, data: { id_token: 'synthetic-identity-token' } }));

    await service.verifyOtp(req, EMAIL, OTP, token);

    expect(decodeRequestPayload()).toEqual({ email: EMAIL, otp: OTP });
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
