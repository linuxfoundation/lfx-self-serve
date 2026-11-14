// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { service, assertPublisherRead } = vi.hoisted(() => ({
  service: {
    createEdition: vi.fn(),
    createPublication: vi.fn(),
    getPublication: vi.fn(),
    listEditions: vi.fn(),
    listPublications: vi.fn(),
    updatePublication: vi.fn(),
  },
  assertPublisherRead: vi.fn(),
}));
vi.mock('../services/newsletter-publications.service', () => ({
  NewsletterPublicationsService: class {
    public constructor() {
      return service;
    }
  },
}));
vi.mock('../services/newsletter-member-benefit.service', () => ({
  NewsletterMemberBenefitService: class {
    public assertPublisherRead = assertPublisherRead;
  },
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('@lfx-one/shared/utils/newsletter.utils')),
  isUuid: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: () => 0, success: vi.fn() } }));

import { NewsletterPublicationsController } from './newsletter-publications.controller';

const PUBLICATION_UID = '11111111-1111-4111-8111-111111111111';
const PUBLICATION = { id: PUBLICATION_UID, version: 3, name: 'Weekly update' };

function request(overrides: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  const headers = overrides.headers ?? {};
  return {
    params: { projectUid: 'p-1', publicationUid: PUBLICATION_UID },
    query: {},
    body: {},
    path: '/x',
    header: (name: string) => headers[name],
    ...overrides,
  } as unknown as Request;
}

function response(): Response & { statusCode: number; body: unknown } {
  const res: { statusCode: number; body?: unknown; status: (code: number) => typeof res; json: (body: unknown) => typeof res } = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('NewsletterPublicationsController (#4349)', () => {
  let controller: NewsletterPublicationsController;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new NewsletterPublicationsController();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  it('creates a publication and returns 201', async () => {
    service.createPublication.mockResolvedValue(PUBLICATION);
    const res = response();
    await controller.createPublication(request({ body: { name: 'Weekly update', reply_to_email: 'editor@example.com' } }), res, next);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(PUBLICATION);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['missing name', {}, 'name'],
    ['bad reply-to', { name: 'Weekly', reply_to_email: 'not-an-email' }, 'reply_to_email'],
    ['non-ASCII reply-to', { name: 'Weekly', reply_to_email: 'rédacteur@example.com' }, 'reply_to_email'],
    ['reply-to with a long local part', { name: 'Weekly', reply_to_email: `${'a'.repeat(65)}@example.com` }, 'reply_to_email'],
    ['reply-to that needs quoting', { name: 'Weekly', reply_to_email: 'first last@example.com' }, 'reply_to_email'],
    ['non-string reply-to', { name: 'Weekly', reply_to_email: 42 }, 'reply_to_email'],
    ['blank committee uid', { name: 'Weekly', committee_uids: [' '] }, 'committee_uids'],
    ['bad committee list', { name: 'Weekly', committee_uids: 'c-1' }, 'committee_uids'],
    ['non-object body', null, 'body'],
  ])('rejects %s without calling the service', async (_label, body, field) => {
    await controller.createPublication(request({ body: body as Request['body'] }), response(), next);
    expect(service.createPublication).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(JSON.stringify(next.mock.calls[0][0])).toContain(field);
  });

  it('passes the If-Match version through on update', async () => {
    service.updatePublication.mockResolvedValue(PUBLICATION);
    const res = response();
    await controller.updatePublication(request({ body: { name: 'Weekly update' }, headers: { 'If-Match': '"3"' } }), res, next);
    expect(service.updatePublication).toHaveBeenCalledWith(expect.anything(), 'p-1', PUBLICATION_UID, 3, { name: 'Weekly update' });
    expect(res.body).toEqual(PUBLICATION);
  });

  it('rejects an update with no If-Match', async () => {
    await controller.updatePublication(request({ body: { name: 'Weekly update' } }), response(), next);
    expect(service.updatePublication).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a publication path segment that is not a UUID', async () => {
    await controller.getPublication(request({ params: { projectUid: 'p-1', publicationUid: 'not-a-uuid' } as Request['params'] }), response(), next);
    expect(service.getPublication).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('checks publisher access before listing editions', async () => {
    service.listEditions.mockResolvedValue({ newsletters: [] });
    await controller.listEditions(request({ query: { status: 'draft', page_token: 't' } as unknown as Request['query'] }), response(), next);
    expect(assertPublisherRead).toHaveBeenCalledWith(expect.anything(), 'p-1');
    expect(service.listEditions).toHaveBeenCalledWith(expect.anything(), 'p-1', PUBLICATION_UID, { status: 'draft', page_token: 't' });
  });

  it('does not list editions when publisher access is refused', async () => {
    const denied = new Error('denied');
    assertPublisherRead.mockRejectedValueOnce(denied);
    await controller.listEditions(request(), response(), next);
    expect(service.listEditions).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(denied);
  });

  it('rejects an unknown edition status filter', async () => {
    await controller.listEditions(request({ query: { status: 'bogus' } as unknown as Request['query'] }), response(), next);
    expect(service.listEditions).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('creates an edition under the path publication', async () => {
    service.createEdition.mockResolvedValue({ id: 'n-1', version: 1 });
    const res = response();
    await controller.createEdition(request({ body: { subject: 'Hello' } }), res, next);
    expect(res.statusCode).toBe(201);
    expect(service.createEdition).toHaveBeenCalledWith(expect.anything(), 'p-1', PUBLICATION_UID, { subject: 'Hello' });
  });

  it.each([
    ['bad committee list', { committee_uids: [''] }],
    ['blank committee uid', { committee_uids: ['  '] }],
    ['explicit empty committee list', { committee_uids: [] }],
    ['past schedule', { scheduled_at: '2020-01-01T00:00:00Z' }],
    ['long subject', { subject: 'x'.repeat(201) }],
    ['missing subject', { subject: undefined }],
    ['layout with no blocks array', { body_layout: { template_key: 'set-a' } }],
    ['layout over the byte cap', { body_layout: { blocks: [{ text: 'x'.repeat(800_001) }] } }],
    ['layout nested deeper than the editor supports', { body_layout: { blocks: [{ blocks: [{ blocks: [{ block_type: 'text' }] }] }] } }],
    ['html body over the cap', { body_html: 'x'.repeat(100_001) }],
    ['non-string html body', { body_html: 42 }],
    ['bad reply email', { ed_reply_email: 'not-an-email' }],
    ['non-string reply email', { ed_reply_email: 42 }],
  ])('rejects an edition with a %s', async (_label, body) => {
    await controller.createEdition(request({ body: { subject: 'Hello', ...body } as Request['body'] }), response(), next);
    expect(service.createEdition).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts an edition with a layout and an echoed html body over the html cap', async () => {
    service.createEdition.mockResolvedValue({ id: 'n-1', version: 1 });
    const body = { subject: 'Hello', body_layout: { blocks: [] }, body_html: 'x'.repeat(100_001), ed_reply_email: 'editor@example.com' };
    await controller.createEdition(request({ body }), response(), next);
    expect(service.createEdition).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('counts a sender name by code point after trimming, the way the service does', async () => {
    service.createPublication.mockResolvedValue(PUBLICATION);
    await controller.createPublication(request({ body: { name: 'Weekly', from_name: ` ${'😀'.repeat(100)} ` } }), response(), next);
    expect(service.createPublication).toHaveBeenCalledOnce();

    await controller.createPublication(request({ body: { name: 'Weekly', from_name: '😀'.repeat(101) } }), response(), next);
    expect(service.createPublication).toHaveBeenCalledOnce();
    expect(JSON.stringify(next.mock.calls[0][0])).toContain('from_name');
  });

  it('accepts a padded name that fits once trimmed', async () => {
    service.createPublication.mockResolvedValue(PUBLICATION);
    await controller.createPublication(request({ body: { name: `  ${'n'.repeat(200)}  ` } }), response(), next);
    expect(service.createPublication).toHaveBeenCalledOnce();
  });

  it('rejects an edition whose body names a different publication', async () => {
    await controller.createEdition(request({ body: { publication_uid: '22222222-2222-4222-8222-222222222222' } }), response(), next);
    expect(service.createEdition).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
  it.each([[''], ['   ']])('lets a blank reply-to %j through, since the service treats it as clearing the override', async (replyTo) => {
    service.createPublication.mockResolvedValue(PUBLICATION);
    await controller.createPublication(request({ body: { name: 'Weekly', reply_to_email: replyTo } }), response(), next);
    expect(next).not.toHaveBeenCalled();
    expect(service.createPublication).toHaveBeenCalledOnce();
  });

  it('accepts a padded reply-to that is valid once trimmed', async () => {
    service.createPublication.mockResolvedValue(PUBLICATION);
    await controller.createPublication(request({ body: { name: 'Weekly', reply_to_email: ' editor@example.com ' } }), response(), next);
    expect(service.createPublication).toHaveBeenCalledOnce();
  });

  it.each([[''], ['   ']])('lets a blank edition reply email %j through so it inherits the publication reply-to', async (replyEmail) => {
    service.createEdition.mockResolvedValue({ id: 'n-1', version: 1 });
    await controller.createEdition(request({ body: { subject: 'Hello', ed_reply_email: replyEmail } }), response(), next);
    expect(next).not.toHaveBeenCalled();
    expect(service.createEdition).toHaveBeenCalledOnce();
  });
});
