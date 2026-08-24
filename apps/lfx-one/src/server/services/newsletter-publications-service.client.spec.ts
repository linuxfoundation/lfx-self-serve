// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config, so the
// runtime collaborator (MicroserviceProxyService) is mocked. The shared imports in
// the client are type-only and elided by esbuild, so no interfaces mock is needed.
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));

import type { Request } from 'express';

import { NewsletterPublicationsServiceClient } from './newsletter-publications-service.client';

const req = {} as unknown as Request;

describe('NewsletterPublicationsServiceClient', () => {
  let client: NewsletterPublicationsServiceClient;

  beforeEach(() => {
    proxyRequest.mockReset();
    proxyRequest.mockResolvedValue({});
    client = new NewsletterPublicationsServiceClient();
  });

  it('POSTs to the project-scoped collection with the create payload', async () => {
    await client.createPublication(req, 'proj-1', { slug: 's', name: 'N' } as any);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/proj-1/newsletter-publications', 'POST', undefined, { slug: 's', name: 'N' });
  });

  it('GETs the project-scoped publication collection', async () => {
    await client.listPublications(req, 'proj-1');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/proj-1/newsletter-publications', 'GET', undefined);
  });

  it('forwards the publication list pagination params as query parameters', async () => {
    await client.listPublications(req, 'proj-1', { page_token: 'tok-1', page_size: 5 });
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/proj-1/newsletter-publications', 'GET', {
      page_token: 'tok-1',
      page_size: '5',
    });
  });

  it('GETs a single publication by uid', async () => {
    await client.getPublication(req, 'proj-1', 'pub-9');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/proj-1/newsletter-publications/pub-9', 'GET');
  });

  it('PUTs an update and quotes the version into a strong If-Match header', async () => {
    await client.updatePublication(req, 'proj-1', 'pub-9', 3, { name: 'New' } as any);
    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/projects/proj-1/newsletter-publications/pub-9',
      'PUT',
      undefined,
      { name: 'New' },
      { 'If-Match': '"3"' }
    );
  });
});
