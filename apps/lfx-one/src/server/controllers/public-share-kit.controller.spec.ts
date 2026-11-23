// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ShareKitContent } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ContentUnavailableError, ResourceNotFoundError } from '../errors';
import { ShareKitService } from '../services/share-kit.service';
import { PublicShareKitController } from './public-share-kit.controller';

const kit = { eventSlug: 'example-summit-2027', title: 'Example Summit' } as ShareKitContent;

function buildReqRes(eventSlug: string): { req: Request; res: Response & { json: Mock; setHeader: Mock }; next: NextFunction & Mock } {
  const req = { params: { eventSlug }, path: `/public/api/events/${eventSlug}/share-kit`, log: {} } as unknown as Request;
  const res = { json: vi.fn(), setHeader: vi.fn() } as unknown as Response & { json: Mock; setHeader: Mock };
  const next = vi.fn() as unknown as NextFunction & Mock;
  return { req, res, next };
}

describe('PublicShareKitController.getShareKit', () => {
  let controller: PublicShareKitController;

  beforeEach(() => {
    vi.clearAllMocks();
    const service = new ShareKitService({ kits: new Map([['example-summit-2027', kit]]), invalid: new Set(['broken-event']) });
    controller = new PublicShareKitController(service);
  });

  it('returns the kit for a known slug', () => {
    const { req, res, next } = buildReqRes('example-summit-2027');
    controller.getShareKit(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(kit);
  });

  it('never includes a member code in the response', () => {
    const { req, res, next } = buildReqRes('example-summit-2027');
    controller.getShareKit(req, res, next);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('memberOffer');
  });

  it('404s an unknown slug', () => {
    const { req, res, next } = buildReqRes('unknown-event');
    controller.getShareKit(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('404s a malformed slug without looking it up', () => {
    const { req, res, next } = buildReqRes('../etc');
    controller.getShareKit(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
  });

  it('500s a slug whose content failed validation', () => {
    const { req, res, next } = buildReqRes('broken-event');
    controller.getShareKit(req, res, next);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ContentUnavailableError);
    expect(error.statusCode).toBe(500);
  });
});
