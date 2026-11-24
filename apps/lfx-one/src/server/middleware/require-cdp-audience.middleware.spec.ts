// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_AUDIENCE_LOCALS_KEY, CDP_COMPANY_ERROR_CODES } from '@lfx-one/shared/constants';
import type { CdpAudienceAnswer } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cdpAudienceOf, requireCdpAudience } from './require-cdp-audience.middleware';

const resolveCdpAudience = vi.fn();

vi.mock('../helpers/cdp-audience.helper', () => ({ resolveCdpAudience: (...args: unknown[]) => resolveCdpAudience(...args) }));

function buildRes(): Response & { statusCode?: number; body?: unknown; headers: Record<string, string> } {
  const res = {
    locals: {} as Record<string, unknown>,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  } as unknown as Response & { statusCode?: number; body?: unknown; headers: Record<string, string> };
  return res;
}

async function run(answer: CdpAudienceAnswer | Error) {
  if (answer instanceof Error) resolveCdpAudience.mockRejectedValue(answer);
  else resolveCdpAudience.mockResolvedValue(answer);
  const res = buildRes();
  const next = vi.fn();
  await requireCdpAudience({} as Request, res, next as unknown as NextFunction);
  return { res, next };
}

describe('requireCdpAudience (spec 062 FR-012, FR-013)', () => {
  beforeEach(() => {
    resolveCdpAudience.mockReset();
  });

  it('lets an audience member through and keeps the answer for Meetings and Groups', async () => {
    const answer: CdpAudienceAnswer = { status: 'in', lfStaff: false };
    const { res, next } = await run(answer);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals[CDP_AUDIENCE_LOCALS_KEY]).toEqual(answer);
    expect(cdpAudienceOf(res)).toEqual(answer);
  });

  it('answers an outsider exactly as an unknown address (404 NOT_FOUND) without reaching the handler', async () => {
    const { res, next } = await run({ status: 'out', lfStaff: false });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: CDP_COMPANY_ERROR_CODES.NOT_FOUND });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(cdpAudienceOf(res)).toEqual({ status: 'out', lfStaff: false });
  });

  it('fails closed with 503 ROLE_GRANTS_UNAVAILABLE when the audience cannot be verified', async () => {
    const { res, next } = await run({ status: 'unverifiable', lfStaff: false });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ code: CDP_COMPANY_ERROR_CODES.ROLE_GRANTS_UNAVAILABLE });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('passes an unexpected error on without admitting the caller', async () => {
    const failure = new Error('unexpected');
    const { res, next } = await run(failure);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.locals[CDP_AUDIENCE_LOCALS_KEY]).toBeUndefined();
  });
});
