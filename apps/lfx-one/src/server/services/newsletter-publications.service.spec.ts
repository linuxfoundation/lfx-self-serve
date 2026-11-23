// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));

import { NewsletterPublicationsService } from './newsletter-publications.service';

const req = {} as Request;
const COLLECTION = '/projects/p-1/newsletter-publications';

describe('NewsletterPublicationsService upstream calls (#4349)', () => {
  let service: NewsletterPublicationsService;
  beforeEach(() => {
    proxyRequest.mockReset();
    service = new NewsletterPublicationsService();
  });

  it('lists with the page token', async () => {
    await service.listPublications(req, 'p-1', 'token');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', COLLECTION, 'GET', { page_token: 'token' });
  });

  it('creates', async () => {
    const payload = { name: 'Weekly update' };
    await service.createPublication(req, 'p-1', payload);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', COLLECTION, 'POST', undefined, payload);
  });

  it('gets one', async () => {
    await service.getPublication(req, 'p-1', 'pub-1');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `${COLLECTION}/pub-1`, 'GET');
  });

  it('updates with a quoted If-Match', async () => {
    const payload = { name: 'Weekly update' };
    await service.updatePublication(req, 'p-1', 'pub-1', 7, payload);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `${COLLECTION}/pub-1`, 'PUT', undefined, payload, { 'If-Match': '"7"' });
  });

  it('lists editions with status and page token, and omits an empty query', async () => {
    await service.listEditions(req, 'p-1', 'pub-1', { status: 'sent', page_token: 't' });
    expect(proxyRequest).toHaveBeenLastCalledWith(req, 'LFX_V2_SERVICE', `${COLLECTION}/pub-1/editions`, 'GET', { status: 'sent', page_token: 't' });
    await service.listEditions(req, 'p-1', 'pub-1', {});
    expect(proxyRequest).toHaveBeenLastCalledWith(req, 'LFX_V2_SERVICE', `${COLLECTION}/pub-1/editions`, 'GET', undefined);
  });

  it('creates an edition', async () => {
    const payload = { subject: 'Hello' };
    await service.createEdition(req, 'p-1', 'pub-1', payload);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `${COLLECTION}/pub-1/editions`, 'POST', undefined, payload);
  });
});
