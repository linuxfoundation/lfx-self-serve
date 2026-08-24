// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPublications, createPublication, getPublication, updatePublication } = vi.hoisted(() => ({
  listPublications: vi.fn(),
  createPublication: vi.fn(),
  getPublication: vi.fn(),
  updatePublication: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest
// config — mock the (type-only) barrel the controller imports from, same as
// newsletter.controller.spec.ts.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('../services/newsletter-publications.service', () => ({
  NewsletterPublicationsService: class {
    public listPublications = listPublications;
    public createPublication = createPublication;
    public getPublication = getPublication;
    public updatePublication = updatePublication;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { NewsletterPublicationsController } from './newsletter-publications.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() } as any;
}

// Build a request; `ifMatch` (when provided) is surfaced via the `header()` accessor the controller uses.
function buildReq(params: Record<string, string>, body: unknown = {}, ifMatch?: string, query: Record<string, string> = {}) {
  return {
    params,
    body,
    query,
    path: '/x',
    header: (h: string) => (h === 'If-Match' ? (ifMatch ?? '') : ''),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewsletterPublicationsController — path-param guards', () => {
  // The `require*Uid` guards run inside the try block, so a missing path param
  // reaches next(error) as a ServiceValidationError (Express 4 would not catch a
  // rejected handler promise).
  it('routes a missing projectUid to next(error)', async () => {
    const next = vi.fn();
    await new NewsletterPublicationsController().listPublications(buildReq({ projectUid: '  ' }), buildRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(listPublications).not.toHaveBeenCalled();
  });

  it('routes a missing publicationUid on get to next(error)', async () => {
    const next = vi.fn();
    await new NewsletterPublicationsController().getPublication(buildReq({ projectUid: 'p1', publicationUid: '' }), buildRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getPublication).not.toHaveBeenCalled();
  });
});

describe('NewsletterPublicationsController.listPublications — happy path', () => {
  it('returns the publications list', async () => {
    listPublications.mockResolvedValue({ publications: [{ id: 'pub-1' }] });
    const res = buildRes();
    const next = vi.fn();
    await new NewsletterPublicationsController().listPublications(buildReq({ projectUid: 'p1' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(listPublications).toHaveBeenCalledWith(expect.anything(), 'p1', { page_token: undefined, page_size: undefined });
    expect(res.json).toHaveBeenCalledWith({ publications: [{ id: 'pub-1' }] });
  });

  it('forwards page_token and page_size, and passes next_page_token back', async () => {
    listPublications.mockResolvedValue({ publications: [{ id: 'pub-2' }], next_page_token: 'tok-2' });
    const res = buildRes();
    const next = vi.fn();
    const req = buildReq({ projectUid: 'p1' }, {}, undefined, { page_token: 'tok-1', page_size: '5' });

    await new NewsletterPublicationsController().listPublications(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(listPublications).toHaveBeenCalledWith(expect.anything(), 'p1', { page_token: 'tok-1', page_size: 5 });
    expect(res.json).toHaveBeenCalledWith({ publications: [{ id: 'pub-2' }], next_page_token: 'tok-2' });
  });

  it.each(['0', '-1', 'abc', '1.5'])('rejects page_size=%s without calling the service', async (pageSize) => {
    const next = vi.fn();
    const req = buildReq({ projectUid: 'p1' }, {}, undefined, { page_size: pageSize });

    await new NewsletterPublicationsController().listPublications(req, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(listPublications).not.toHaveBeenCalled();
  });
});

describe('NewsletterPublicationsController.createPublication — validateCreatePublicationPayload', () => {
  it('creates and returns 201 for a valid payload', async () => {
    createPublication.mockResolvedValue({ id: 'pub-1', version: 1 });
    const res = buildRes();
    const next = vi.fn();
    await new NewsletterPublicationsController().createPublication(buildReq({ projectUid: 'p1' }, { slug: 's', name: 'N' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(createPublication).toHaveBeenCalledWith(expect.anything(), 'p1', { slug: 's', name: 'N' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();
  });

  it.each([
    ['missing slug', { name: 'N' }],
    ['blank slug', { slug: '  ', name: 'N' }],
    ['missing name', { slug: 's' }],
    ['blank name', { slug: 's', name: '  ' }],
  ])('rejects %s without calling the service', async (_label, payload) => {
    const next = vi.fn();
    await new NewsletterPublicationsController().createPublication(buildReq({ projectUid: 'p1' }, payload), buildRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createPublication).not.toHaveBeenCalled();
  });
});

describe('NewsletterPublicationsController.updatePublication — parseIfMatch + validateUpdatePublicationPayload', () => {
  it('updates for a valid If-Match + payload', async () => {
    updatePublication.mockResolvedValue({ id: 'pub-1', version: 2 });
    const res = buildRes();
    const next = vi.fn();
    await new NewsletterPublicationsController().updatePublication(buildReq({ projectUid: 'p1', publicationUid: 'pub-1' }, { name: 'New' }, '1'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(updatePublication).toHaveBeenCalledWith(expect.anything(), 'p1', 'pub-1', 1, { name: 'New' });
    expect(res.json).toHaveBeenCalled();
  });

  it('strips a weak-tag / quoted If-Match to the integer version', async () => {
    updatePublication.mockResolvedValue({ id: 'pub-1', version: 4 });
    const next = vi.fn();
    await new NewsletterPublicationsController().updatePublication(
      buildReq({ projectUid: 'p1', publicationUid: 'pub-1' }, { name: 'New' }, 'W/"3"'),
      buildRes(),
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(updatePublication).toHaveBeenCalledWith(expect.anything(), 'p1', 'pub-1', 3, { name: 'New' });
  });

  it.each([
    ['missing If-Match', { name: 'N' }, undefined],
    ['non-integer If-Match', { name: 'N' }, 'abc'],
    ['zero If-Match', { name: 'N' }, '0'],
  ])('rejects %s', async (_label, payload, ifMatch) => {
    const next = vi.fn();
    await new NewsletterPublicationsController().updatePublication(buildReq({ projectUid: 'p1', publicationUid: 'pub-1' }, payload, ifMatch), buildRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(updatePublication).not.toHaveBeenCalled();
  });

  it.each([
    ['empty payload', {}],
    ['blank name', { name: '  ' }],
    ['null body', null],
  ])('rejects %s after a valid If-Match (400, not a 500)', async (_label, payload) => {
    const next = vi.fn();
    await new NewsletterPublicationsController().updatePublication(buildReq({ projectUid: 'p1', publicationUid: 'pub-1' }, payload, '1'), buildRes(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(updatePublication).not.toHaveBeenCalled();
  });
});
