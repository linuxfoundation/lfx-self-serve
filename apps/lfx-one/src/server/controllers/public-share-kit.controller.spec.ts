// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ShareKitContent } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// The real offer service pulls in the membership lookup's dependencies; every test passes its own stub.
vi.mock('../services/share-kit-member-offer.service', () => ({ ShareKitMemberOfferService: vi.fn() }));

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: vi.fn(() => null) }));

import { EVENT_SHARE_KIT_FLAG } from '@lfx-one/shared/constants';

import { ContentUnavailableError, ResourceNotFoundError } from '../errors';
import { LaunchDarklyServerService } from '../services/launchdarkly-server.service';
import type { ShareKitMemberOfferService } from '../services/share-kit-member-offer.service';
import { ShareKitService } from '../services/share-kit.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { PublicShareKitController } from './public-share-kit.controller';

const kit = { eventSlug: 'example-summit-2027', title: 'Example Summit' } as ShareKitContent;

function buildReqRes(eventSlug: string): { req: Request; res: Response & { json: Mock; setHeader: Mock }; next: NextFunction & Mock } {
  const req = { params: { eventSlug }, path: `/public/api/events/${eventSlug}/share-kit`, log: {} } as unknown as Request;
  const res = { json: vi.fn(), setHeader: vi.fn(), vary: vi.fn() } as unknown as Response & { json: Mock; setHeader: Mock; vary: Mock };
  const next = vi.fn() as unknown as NextFunction & Mock;
  return { req, res, next };
}

describe('PublicShareKitController.getShareKit', () => {
  let controller: PublicShareKitController;
  let isFlagEnabled: Mock;
  let resolveOffer: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    (getEffectiveUsername as Mock).mockReturnValue(null);
    isFlagEnabled = vi.fn().mockResolvedValue(true);
    const service = new ShareKitService({ kits: new Map([['example-summit-2027', kit]]), invalid: new Set(['broken-event']) });
    resolveOffer = vi.fn().mockResolvedValue(undefined);
    controller = new PublicShareKitController(
      service,
      { resolveOffer } as unknown as ShareKitMemberOfferService,
      { isFlagEnabled } as unknown as LaunchDarklyServerService
    );
  });

  it('404s every kit while the flag is off', async () => {
    isFlagEnabled.mockResolvedValue(false);
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(res.json).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    expect(resolveOffer).not.toHaveBeenCalled();
  });

  it('evaluates signed-out visitors as one anonymous context and lets shared caches keep the answer', async () => {
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(isFlagEnabled).toHaveBeenCalledWith(req, EVENT_SHARE_KIT_FLAG, false, { key: 'anonymous-share-kit-visitor', anonymous: true });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    expect(res.vary).toHaveBeenCalledWith('Cookie');
  });

  it('evaluates signed-in visitors by username and keeps their answer out of shared caches', async () => {
    (getEffectiveUsername as Mock).mockReturnValue('staff-user');
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(isFlagEnabled).toHaveBeenCalledWith(req, EVENT_SHARE_KIT_FLAG, false, undefined);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('returns the kit for a known slug', async () => {
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(kit);
  });

  it('never includes a member code in the response', async () => {
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('memberOffer');
  });

  it('404s an unknown slug', async () => {
    const { req, res, next } = buildReqRes('unknown-event');
    await controller.getShareKit(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('404s a malformed slug without looking it up', async () => {
    const { req, res, next } = buildReqRes('../etc');
    await controller.getShareKit(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
  });

  it('500s a slug whose content failed validation', async () => {
    const { req, res, next } = buildReqRes('broken-event');
    await controller.getShareKit(req, res, next);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ContentUnavailableError);
    expect(error.statusCode).toBe(500);
  });

  it('adds the visitor member offer and forbids shared caching', async () => {
    resolveOffer.mockResolvedValue({ status: 'eligible', code: 'EXAMPLE20', companyName: 'Acme Motors' });
    const { req, res, next } = buildReqRes('example-summit-2027');
    await controller.getShareKit(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ ...kit, memberOffer: { status: 'eligible', code: 'EXAMPLE20', companyName: 'Acme Motors' } });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.vary).toHaveBeenCalledWith('Cookie');
  });
});
