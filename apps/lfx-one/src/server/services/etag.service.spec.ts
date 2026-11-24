// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config, so the one runtime constant is stubbed.
vi.mock('@lfx-one/shared/constants', () => ({ HTTP_HEADERS: { IF_MATCH: 'If-Match' } }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), etag: vi.fn() } }));

import { ETagService } from './etag.service';

const req = {} as unknown as Request;

describe('ETagService.updateWithETag', () => {
  let service: ETagService;

  beforeEach(() => {
    proxyRequest.mockReset();
    proxyRequest.mockResolvedValue({ uid: 'doc-1' });
    service = new ETagService();
  });

  it('sends the body with the ETag as If-Match', async () => {
    await service.updateWithETag(req, 'LFX_V2_SERVICE', '/projects/p/links/l', 'etag-1', { name: 'New' }, 'update_link');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/p/links/l', 'PUT', {}, { name: 'New' }, { 'If-Match': 'etag-1' });
  });

  it('sends any extra headers along with If-Match', async () => {
    await service.updateWithETag(req, 'LFX_V2_SERVICE', '/projects/p/links/l', 'etag-1', { name: 'New' }, 'update_link', { 'X-Sync': 'true' });

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/projects/p/links/l',
      'PUT',
      {},
      { name: 'New' },
      { 'X-Sync': 'true', 'If-Match': 'etag-1' }
    );
  });

  it('never lets an extra header replace the ETag the write is guarded by', async () => {
    await service.updateWithETag(req, 'LFX_V2_SERVICE', '/projects/p/links/l', 'etag-1', {}, 'update_link', { 'If-Match': 'forged' });

    expect(proxyRequest.mock.calls[0][6]).toEqual({ 'If-Match': 'etag-1' });
  });
});
