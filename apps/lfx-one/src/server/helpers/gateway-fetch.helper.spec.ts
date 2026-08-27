// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn() },
}));

vi.mock('../services/logger.service', () => ({ logger }));

import type { Request } from 'express';

import type { MicroserviceError } from '../errors';
import { gatewayFetch } from './gateway-fetch.helper';

describe('gatewayFetch sensitive response redaction', () => {
  const req = { apiGatewayToken: 'gateway-token' } as Request;
  const options = {
    operation: 'redeem_promotion',
    service: 'rewards_service',
    errorMessage: 'Coupon generation failed',
    errorCode: 'COUPON_GENERATION_FAILED',
    method: 'POST' as const,
    redactResponseBody: true,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not log or serialize a non-OK upstream body', async () => {
    const upstream = new Response(JSON.stringify({ CouponCode: 'SECRET-COUPON' }), { status: 409, statusText: 'Conflict' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream)
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/redeem', options).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error).toMatchObject({ code: 'COUPON_GENERATION_FAILED' });
    expect(error.errorBody).toBeUndefined();
    expect(upstream.bodyUsed).toBe(true);
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SECRET-COUPON');
    expect(logger.warning).toHaveBeenCalledWith(req, 'redeem_promotion', 'Upstream returned non-OK response', expect.objectContaining({ body_redacted: true }));
  });

  it('does not log or serialize an invalid successful response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('SECRET-COUPON', { status: 200 }))
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/redeem', options).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error).toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
    expect(error.errorBody).toBeUndefined();
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SECRET-COUPON');
  });
});
