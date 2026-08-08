// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { NewsletterPublicationsService } from './newsletter-publications.service';
import type { NewsletterPublicationsServiceClient } from './newsletter-publications-service.client';

const req = {} as unknown as Request;

// The service is a thin pass-through: every method forwards, unchanged, to the
// injected client. These tests pin that contract (argument order + no mutation)
// so a future refactor can't silently drop or reorder a parameter.
describe('NewsletterPublicationsService — delegation', () => {
  // Named-property type (not `Record<string, …>`) so dot access passes the
  // build's `noPropertyAccessFromIndexSignature` check.
  let client: {
    createPublication: ReturnType<typeof vi.fn>;
    listPublications: ReturnType<typeof vi.fn>;
    getPublication: ReturnType<typeof vi.fn>;
    updatePublication: ReturnType<typeof vi.fn>;
  };
  let service: NewsletterPublicationsService;

  beforeEach(() => {
    client = {
      createPublication: vi.fn().mockResolvedValue({ id: 'pub-1' }),
      listPublications: vi.fn().mockResolvedValue({ publications: [] }),
      getPublication: vi.fn().mockResolvedValue({ id: 'pub-1' }),
      updatePublication: vi.fn().mockResolvedValue({ id: 'pub-1' }),
    };
    service = new NewsletterPublicationsService(client as unknown as NewsletterPublicationsServiceClient);
  });

  it('forwards createPublication', async () => {
    await service.createPublication(req, 'p1', { slug: 's', name: 'N' } as any);
    expect(client.createPublication).toHaveBeenCalledWith(req, 'p1', { slug: 's', name: 'N' });
  });

  it('forwards listPublications', async () => {
    await service.listPublications(req, 'p1');
    expect(client.listPublications).toHaveBeenCalledWith(req, 'p1');
  });

  it('forwards getPublication', async () => {
    await service.getPublication(req, 'p1', 'pub-1');
    expect(client.getPublication).toHaveBeenCalledWith(req, 'p1', 'pub-1');
  });

  it('forwards updatePublication with the If-Match version and payload', async () => {
    await service.updatePublication(req, 'p1', 'pub-1', 4, { name: 'New' } as any);
    expect(client.updatePublication).toHaveBeenCalledWith(req, 'p1', 'pub-1', 4, { name: 'New' });
  });
});
