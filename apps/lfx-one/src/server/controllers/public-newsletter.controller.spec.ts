// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Newsletter } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn().mockResolvedValue('m2m-token') }));
vi.mock('../services/newsletter.service', () => ({ NewsletterService: vi.fn() }));
vi.mock('../services/project.service', () => ({ ProjectService: vi.fn() }));

import { ResourceNotFoundError } from '../errors';
import type { NewsletterService } from '../services/newsletter.service';
import type { ProjectService } from '../services/project.service';
import { PublicNewsletterController } from './public-newsletter.controller';

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: 'news-1',
    project_uid: 'proj-1',
    subject: 'Weekly Update #42',
    body_html: '<p>members-only body</p>',
    ed_reply_email: 'ed@acme-motors.example',
    committee_uids: ['group-1'],
    status: 'sent',
    sent_at: '2026-10-30T10:00:00Z',
    total_recipients: 10,
    created_by: 'sender',
    version: 1,
    created_at: '2026-10-30T10:00:00Z',
    updated_at: '2026-10-30T10:00:00Z',
    ...overrides,
  };
}

function buildReqRes(projectSlug = 'acme', newsletterUid = 'news-1'): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
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
  let getNewsletter: Mock;
  let getProjectIdBySlug: Mock;
  let controller: PublicNewsletterController;

  beforeEach(() => {
    vi.clearAllMocks();
    getNewsletter = vi.fn().mockResolvedValue(makeNewsletter());
    getProjectIdBySlug = vi.fn().mockResolvedValue({ uid: 'proj-1', slug: 'acme', exists: true });
    controller = new PublicNewsletterController({ getNewsletter } as unknown as NewsletterService, { getProjectIdBySlug } as unknown as ProjectService);
  });

  it('returns only the subject of a sent issue, read with an M2M token scoped to that call', async () => {
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ subject: 'Weekly Update #42' });
    expect(getProjectIdBySlug).toHaveBeenCalledWith(req, 'acme', { unavailableAsMissing: false });
    expect(getNewsletter).toHaveBeenCalledWith(req, 'proj-1', 'news-1', { bearerToken: 'm2m-token' });
    // The exposure boundary: nothing but the subject leaves this endpoint.
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain('members-only body');
    expect(serialized).not.toContain('acme-motors.example');
  });

  it.each(['draft', 'scheduled', 'sending'])('answers a %s issue with the same 404 as a missing one', async (status) => {
    getNewsletter.mockResolvedValue(makeNewsletter({ status: status as Newsletter['status'] }));
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it('404s an issue that belongs to a different project than the slug', async () => {
    getNewsletter.mockResolvedValue(makeNewsletter({ project_uid: 'other-proj' }));
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it('404s an unknown project slug without reading any newsletter', async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'nope', exists: false });
    const { req, res, next } = buildReqRes('nope');

    await controller.getSharePreview(req, res, next);

    expect(getNewsletter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it.each([
    ['../etc', 'news-1'],
    ['acme', 'news-1/../../x'],
    ['acme', 'a b'],
    ['', 'news-1'],
  ])('rejects malformed params (%s, %s) before any upstream call', async (projectSlug, newsletterUid) => {
    const { req, res, next } = buildReqRes(projectSlug, newsletterUid);

    await controller.getSharePreview(req, res, next);

    expect(getProjectIdBySlug).not.toHaveBeenCalled();
    expect(getNewsletter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it('passes an upstream failure to the error handler', async () => {
    const failure = new Error('upstream down');
    getNewsletter.mockRejectedValue(failure);
    const { req, res, next } = buildReqRes();

    await controller.getSharePreview(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});
