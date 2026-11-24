// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  IMPERSONATION_SEARCH_FAILED_MESSAGE,
  IMPERSONATION_SEARCH_NATS_ERROR_CODE,
  IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
  IMPERSONATION_USER_NOT_FOUND_MESSAGE,
} from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { natsRequest, logger } = vi.hoisted(() => ({
  natsRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(function () {
    return {
      getCodec: () => ({
        encode: (v: string) => v,
        decode: (v: unknown) => v as string,
      }),
      request: natsRequest,
    };
  }),
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

    await expect(service.exchangeToken(req, 'HWilson', 'subject-token')).rejects.toMatchObject({
      statusCode: 404,
      code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
      message: IMPERSONATION_USER_NOT_FOUND_MESSAGE,
    });

    try {
      await service.exchangeToken(req, 'HWilson', 'subject-token');
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

  it('sends the given subject token, never req.bearerToken', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, data: { access_token: 'target-token' } }) });

    await service.exchangeToken(req, 'jdoe', 'real-token');

    expect(JSON.parse(natsRequest.mock.calls[0][1])).toEqual({ subject_token: 'real-token', target_user: 'jdoe' });
  });

  it('maps a NATS transport failure to CTE_NATS_ERROR 502', async () => {
    natsRequest.mockRejectedValue(new Error('TIMEOUT'));

    await expect(service.exchangeToken(req, 'jdoe', 'subject-token')).rejects.toMatchObject({
      statusCode: 502,
      code: 'CTE_NATS_ERROR',
    });
  });
});

describe('ImpersonationService.searchUsers', () => {
  let service: ImpersonationService;

  beforeEach(() => {
    natsRequest.mockReset();
    service = new ImpersonationService();
  });

  it("sends the admin's token and the query to auth-service and returns the users", async () => {
    const users = [{ user_id: 'auth0|1', username: 'jdoe', name: 'Jane Doe', email: 'jane.doe@example.test' }];
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, users }) });

    await expect(service.searchUsers(req, 'jane', 'admin-token', 10)).resolves.toEqual(users);

    const [subject, payload] = natsRequest.mock.calls[0];
    expect(subject).toBe(NatsSubjects.USER_SEARCH);
    expect(JSON.parse(payload)).toEqual({ subject_token: 'admin-token', query: 'jane', limit: 10 });
  });

  it('returns an empty list when the reply carries no users', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true }) });

    await expect(service.searchUsers(req, 'jane', 'admin-token', 10)).resolves.toEqual([]);
  });

  it.each([
    ['subject_token is not authorized to impersonate', 403, 'IMPERSONATION_SEARCH_FORBIDDEN'],
    ['query needs at least one term of 3 or more characters', 400, 'IMPERSONATION_SEARCH_INVALID'],
    ['user search is unavailable', 503, 'IMPERSONATION_SEARCH_UNAVAILABLE'],
    ['unexpected failure', 502, 'IMPERSONATION_SEARCH_FAILED'],
  ])('maps the auth-service error %j to %i and keeps the raw text off the public message', async (upstreamError, statusCode, code) => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: false, error: upstreamError }) });

    const error = (await service.searchUsers(req, 'jane', 'admin-token', 10).catch((e: unknown) => e)) as MicroserviceError;

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error.statusCode).toBe(statusCode);
    expect(error.code).toBe(code);
    expect(error.message).not.toBe(upstreamError);
    expect(error.errorBody).toEqual({ upstreamError });
  });

  it('replies with a fixed message when the request itself fails, keeping the transport error in the log-only body', async () => {
    natsRequest.mockRejectedValue(new Error('timeout while searching for jane.doe@example.test'));

    const error = (await service.searchUsers(req, 'jane', 'admin-token', 10).catch((e: unknown) => e)) as MicroserviceError;

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(IMPERSONATION_SEARCH_NATS_ERROR_CODE);
    expect(error.message).toBe(IMPERSONATION_SEARCH_FAILED_MESSAGE);
    expect(error.message).not.toContain('jane.doe');
    expect(error.errorBody).toEqual({ transportError: 'timeout while searching for jane.doe@example.test' });
  });

  it('traces the search with only the length of the query', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, users: [] }) });

    await service.searchUsers(req, 'jane.doe@example.test', 'admin-token', 10);

    expect(logger.debug).toHaveBeenCalledWith(req, 'impersonation_user_search', expect.any(String), { query_length: 21, limit: 10 });
  });

  it('never logs the query', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, users: [] }) });

    await service.searchUsers(req, 'jane.doe@example.test', 'admin-token', 10);

    for (const method of Object.values(logger)) {
      expect(JSON.stringify(method.mock.calls)).not.toContain('jane.doe');
    }
  });
});
