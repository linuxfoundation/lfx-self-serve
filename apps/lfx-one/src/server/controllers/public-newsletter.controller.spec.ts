// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/newsletter.service', () => ({ NewsletterService: vi.fn() }));

import { ResourceNotFoundError } from '../errors';
import type { NewsletterService } from '../services/newsletter.service';
import { PublicNewsletterController } from './public-newsletter.controller';

const ISSUE_UID = '1d96e14d-7a48-464e-b6cc-5b91d377c45d';

function buildReqRes(projectSlug = 'acme', newsletterUid = ISSUE_UID): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
  const req = {
    params: { projectSlug, newsletterUid },
    path: `/public/api/newsletters/${projectSlug}/${newsletterUid}/preview`,
    log: {},
  } as unknown as Request;
  const res = { json: vi.fn() } as unknown as Response & { json: Mock };
  const next = vi.fn() as unknown as NextFunction & Mock;
  return { req, res, next };
}

describe('PublicNewsletterController.getSharePreview', () => {
  let getSharePreview: Mock;
  let controller: PublicNewsletterController;

  beforeEach(() => {
    vi.clearAllMocks();
    getSharePreview = vi.fn().mockResolvedValue({ subject: 'Weekly Update #42' });
    controller = new PublicNewsletterController({ getSharePreview } as unknown as NewsletterService);
  });

  it('responds with the preview the service allows', async () => {
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(getSharePreview).toHaveBeenCalledWith(req, 'acme', ISSUE_UID);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ subject: 'Weekly Update #42' });
  });

  it('answers "nothing to show" with a local 404', async () => {
    getSharePreview.mockResolvedValue(null);
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it.each([
    ['../etc', ISSUE_UID],
    ['acme', 'news-1'],
    ['acme', `${ISSUE_UID}/../x`],
    ['', ISSUE_UID],
  ])('404s malformed params (%s, %s) before any lookup', async (projectSlug, newsletterUid) => {
    const { req, res, next } = buildReqRes(projectSlug, newsletterUid);

    await controller.getSharePreview(req, res, next);

    expect(getSharePreview).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it('passes a lookup failure to the error handler', async () => {
    const failure = new Error('upstream down');
    getSharePreview.mockRejectedValue(failure);
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(next).toHaveBeenCalledWith(failure);
  });
});
