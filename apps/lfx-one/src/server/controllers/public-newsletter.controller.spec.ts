// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT_UID = 'project-1111';
const NEWSLETTER_UID = '11111111-1111-4111-8111-111111111111';

const { getPublicViewMock } = vi.hoisted(() => ({
  getPublicViewMock: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', () => ({
  isUuid: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
}));
vi.mock('../services/newsletter.service', () => ({
  NewsletterService: vi.fn(function () {
    return { getPublicView: getPublicViewMock };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { PublicNewsletterController } from './public-newsletter.controller';

function buildReqRes(params: Record<string, string>) {
  // No `bearerToken` field at all — this route is classified `auth: 'public'` in
  // auth.middleware.ts, so a request reaching this controller never carries one.
  const req = { params, path: `/public/api/newsletters/${params['projectUid']}/${params['newsletterUid']}`, log: {} } as any;
  const res = { json: vi.fn() } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('PublicNewsletterController.getPublicView', () => {
  let controller: PublicNewsletterController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicNewsletterController();
  });

  it('returns the public projection for valid path params, never reading a bearer token', async () => {
    const view = { subject: 'Hello', body_html: '<p>Hi</p>', project_name: 'Proj', sent_at: '2026-01-01T00:00:00Z' };
    getPublicViewMock.mockResolvedValue(view);
    const { req, res, next } = buildReqRes({ projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID });
    expect(req.bearerToken).toBeUndefined();

    await controller.getPublicView(req, res, next);

    expect(getPublicViewMock).toHaveBeenCalledWith(req, PROJECT_UID, NEWSLETTER_UID);
    expect(res.json).toHaveBeenCalledWith(view);
    expect(next).not.toHaveBeenCalled();
  });

  it('strips any non-allow-listed field the upstream returns (runtime PII guard)', async () => {
    // Upstream widens with fields that must never reach an anonymous client.
    getPublicViewMock.mockResolvedValue({
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      project_name: 'Proj',
      sent_at: '2026-01-01T00:00:00Z',
      id: 'nl-uuid',
      committee_uids: ['c1'],
      ed_reply_email: 'ed@example.com',
      created_by: 'someone',
      version: 3,
    });
    const { req, res, next } = buildReqRes({ projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID });

    await controller.getPublicView(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      project_name: 'Proj',
      sent_at: '2026-01-01T00:00:00Z',
    });
    const sent = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    for (const leaked of ['id', 'committee_uids', 'ed_reply_email', 'created_by', 'version']) {
      expect(sent).not.toHaveProperty(leaked);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing projectUid without calling the newsletter service', async () => {
    const { req, res, next } = buildReqRes({ projectUid: '', newsletterUid: NEWSLETTER_UID });

    await controller.getPublicView(req, res, next);

    expect(getPublicViewMock).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-UUID newsletterUid without calling the newsletter service', async () => {
    const { req, res, next } = buildReqRes({ projectUid: PROJECT_UID, newsletterUid: 'not-a-uuid' });

    await controller.getPublicView(req, res, next);

    expect(getPublicViewMock).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('forwards a 404 from the upstream service via next(error)', async () => {
    const notFound = Object.assign(new Error('not found'), { statusCode: 404 });
    getPublicViewMock.mockRejectedValue(notFound);
    const { req, res, next } = buildReqRes({ projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID });

    await controller.getPublicView(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(notFound);
  });
});
