// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IMPERSONATION_TARGET_USER_NOT_FOUND_CODE, IMPERSONATION_USER_NOT_FOUND_MESSAGE } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { natsRequest, logger } = vi.hoisted(() => ({
  natsRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(() => ({
    getCodec: () => ({
      encode: (v: string) => v,
      decode: (v: unknown) => v as string,
    }),
    request: natsRequest,
  })),
}));

vi.mock('./logger.service', () => ({ logger }));

import { MicroserviceError } from '../errors';
import { ImpersonationService } from './impersonation.service';

const req = { bearerToken: 'subject-token' } as unknown as Request;

describe('ImpersonationService.exchangeToken', () => {
  let service: ImpersonationService;

  beforeEach(() => {
    natsRequest.mockReset();
    service = new ImpersonationService();
  });

  it('maps the auth-service 400 wrap to TARGET_USER_NOT_FOUND and keeps the raw string off the public message', async () => {
    natsRequest.mockResolvedValue({
      data: JSON.stringify({ success: false, error: 'token exchange request failed: upstream returned status 400' }),
    });

    await expect(service.exchangeToken(req, 'HWilson')).rejects.toMatchObject({
      statusCode: 404,
      code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
      message: IMPERSONATION_USER_NOT_FOUND_MESSAGE,
    });

    try {
      await service.exchangeToken(req, 'HWilson');
    } catch (error) {
      expect(error).toBeInstanceOf(MicroserviceError);
      const microserviceError = error as MicroserviceError;
      expect(microserviceError.errorBody).toEqual({
        target_user: 'HWilson',
        upstreamError: 'token exchange request failed: upstream returned status 400',
      });
      const response = microserviceError.toResponse();
      expect(response['upstreamCode']).toBeUndefined();
      expect(JSON.stringify(response)).not.toContain('token exchange request failed');
      expect(JSON.stringify(response)).not.toContain('upstream returned status 400');
      expect(microserviceError.getLogContext()['error_body']).toEqual({
        target_user: 'HWilson',
        upstreamError: 'token exchange request failed: upstream returned status 400',
      });
    }
  });

  it('maps a NATS transport failure to CTE_NATS_ERROR 502', async () => {
    natsRequest.mockRejectedValue(new Error('TIMEOUT'));

    await expect(service.exchangeToken(req, 'jdoe')).rejects.toMatchObject({
      statusCode: 502,
      code: 'CTE_NATS_ERROR',
    });
  });
});
