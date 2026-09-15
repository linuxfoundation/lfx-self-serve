// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn() },
}));

vi.mock('../services/logger.service', () => ({ logger }));

import type { Request } from 'express';

import type { MicroserviceError } from '../errors';
import { gatewayFetchBinary } from './gateway-fetch-binary.helper';

describe('gatewayFetchBinary', () => {
  const req = { apiGatewayToken: 'gateway-token' } as Request;
  const options = {
    operation: 'org_cla_ccla_preview',
    service: 'org_cla_service',
    errorMessage: 'Failed to fetch CCLA review copy',
    errorCode: 'UPSTREAM_ERROR',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns the upstream bytes without parsing them as JSON', async () => {
    const pdf = Buffer.from('%PDF-1.4 review-copy');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
    );

    await expect(gatewayFetchBinary(req, 'https://gw.example.org/preview', options)).resolves.toEqual(pdf);
  });

  it('does not log or serialize a non-OK upstream body when redacted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'SECRET-TEMPLATE-PATH' }), { status: 400, statusText: 'Bad Request' }))
    );

    const error = (await gatewayFetchBinary(req, 'https://gw.example.org/preview', {
      ...options,
      redactResponseBody: true,
    }).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', statusCode: 400 });
    expect(error.errorBody).toBeUndefined();
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SECRET-TEMPLATE-PATH');
  });

  it('relays a 404 as a MicroserviceError with that status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404, statusText: 'Not Found' }))
    );

    await expect(gatewayFetchBinary(req, 'https://gw.example.org/preview', options)).rejects.toMatchObject({
      statusCode: 404,
      code: 'UPSTREAM_ERROR',
    });
  });

  it('rejects an empty 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(), { status: 200 }))
    );

    await expect(gatewayFetchBinary(req, 'https://gw.example.org/preview', options)).rejects.toMatchObject({
      statusCode: 502,
      code: 'UPSTREAM_INVALID_RESPONSE',
    });
  });
});
