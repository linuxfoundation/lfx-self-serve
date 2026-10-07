// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { GW_EMBED_STYLESHEET_MAX_AGE_S, GW_EMBED_STYLESHEET_NAME_PATTERN, GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import { GwEmbedStylesheetService } from '../services/gw-embed-stylesheet.service';

/**
 * HTTP boundary for the scoped embed stylesheet: validates the hashed file name, asks the service
 * for the sheet and writes the response. Everything about fetching, scoping and caching lives in
 * `GwEmbedStylesheetService`.
 *
 * Public by design: the loader fetches without credentials, the content is public, and the only
 * upstream the service can reach is the configured `GW_EMBED_URL` with a name matching the hashed
 * pattern, so this is not a fetch proxy.
 *
 * The body is LFX output under an upstream-hashed name, so it is cached with a short max-age and
 * an ETag rather than as immutable — a theme or transform fix must reach users without a URL
 * change.
 */
export class GwEmbedStylesheetController {
  public constructor(private readonly service: GwEmbedStylesheetService = new GwEmbedStylesheetService()) {}

  public async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = String(req.params['name'] ?? '');
    if (!GW_EMBED_STYLESHEET_NAME_PATTERN.test(name)) {
      next(new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: 'gw_embed_stylesheet' }));
      return;
    }

    try {
      const { css, etag } = await this.service.load(req, name);
      res.setHeader('ETag', etag);
      res.setHeader(
        'Cache-Control',
        `public, max-age=${GW_EMBED_STYLESHEET_MAX_AGE_S}, stale-while-revalidate=${GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S}`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.send(css);
    } catch (error) {
      next(error);
    }
  }
}
