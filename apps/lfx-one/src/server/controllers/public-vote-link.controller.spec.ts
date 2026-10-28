// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors';

const { getVoteLinkBallot, submitVoteLinkResponse } = vi.hoisted(() => ({
  getVoteLinkBallot: vi.fn(),
  submitVoteLinkResponse: vi.fn(),
}));

vi.mock('../services/vote.service', () => ({
  VoteService: class {
    public getVoteLinkBallot = getVoteLinkBallot;
    public submitVoteLinkResponse = submitVoteLinkResponse;
  },
}));

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../services/logger.service';
import { PublicVoteLinkController } from './public-vote-link.controller';

const TOKEN = 'v1.synthetic.secret-token';

function buildRes() {
  const res = { set: vi.fn(), json: vi.fn(), status: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// Everything handed to the logger except the request itself (its first argument): the real logger reads only
// request id/method/url off it, so what matters is the operation name and metadata we pass.
const loggedPayload = () =>
  JSON.stringify(
    [logger.startOperation, logger.success, logger.info, logger.warning, logger.error, logger.debug].map((fn) =>
      vi.mocked(fn).mock.calls.map(([, ...rest]) => rest)
    )
  );

describe('PublicVoteLinkController', () => {
  const controller = new PublicVoteLinkController();
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn() as unknown as NextFunction;
  });

  it('forwards the ballot request body unchanged and returns the upstream response as-is, uncached', async () => {
    const ballot = { vote_uid: 'v-1', name: 'Synthetic vote' };
    getVoteLinkBallot.mockResolvedValue(ballot);
    const body = { vote_token: TOKEN };
    const req = { body } as Request;
    const res = buildRes();

    await controller.getLinkBallot(req, res as unknown as Response, next);

    expect(getVoteLinkBallot).toHaveBeenCalledWith(req, body);
    expect(res.json).toHaveBeenCalledWith(ballot);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', 'submitLinkResponse'],
    ['PUT', 'updateLinkResponse'],
  ] as const)('forwards a %s response body unchanged and answers 204', async (method, handler) => {
    submitVoteLinkResponse.mockResolvedValue(undefined);
    const body = { vote_token: TOKEN, abstain: false, user_vote_content: [{ question_id: 'q', answer: 'a' }] };
    const req = { body } as unknown as Request;
    const res = buildRes();

    await controller[handler](req, res as unknown as Response, next);

    expect(submitVoteLinkResponse).toHaveBeenCalledWith(req, method, body);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('passes the upstream status and message through to the error handler', async () => {
    const upstream = new MicroserviceError('invalid voting link', 404, 'NOT_FOUND', {});
    getVoteLinkBallot.mockRejectedValue(upstream);

    await controller.getLinkBallot({ body: { vote_token: TOKEN } } as Request, buildRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(upstream);
  });

  it.each([
    ['empty object', {}],
    ['empty string', { vote_token: '' }],
    ['non-string', { vote_token: 42 }],
    ['oversized', { vote_token: 'x'.repeat(5000) }],
  ])('rejects a body without a bounded string token (%s)', async (_label, body) => {
    await controller.getLinkBallot({ body } as Request, buildRes() as unknown as Response, next);

    expect(getVoteLinkBallot).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('never logs the token or request body', async () => {
    getVoteLinkBallot.mockResolvedValue({});
    submitVoteLinkResponse.mockRejectedValueOnce(new MicroserviceError('poll has ended', 400, 'BAD_REQUEST', {}));
    const body = { vote_token: TOKEN, abstain: false };

    await controller.getLinkBallot({ body } as Request, buildRes() as unknown as Response, next);
    await controller.submitLinkResponse({ body } as Request, buildRes() as unknown as Response, next);
    await controller.updateLinkResponse({ body: { vote_token: '' } } as Request, buildRes() as unknown as Response, next);

    expect(loggedPayload()).not.toContain(TOKEN);
    expect(loggedPayload()).not.toContain('vote_token');
  });
});
