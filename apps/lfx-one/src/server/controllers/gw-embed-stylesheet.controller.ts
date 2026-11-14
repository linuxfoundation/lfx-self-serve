// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { GW_EMBED_STYLESHEET_KEY_PATTERN, GW_EMBED_STYLESHEET_NAME_PATTERN } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import { gwEmbedStylesheetCacheControl, ifNoneMatchHits, pickGwEmbedStylesheetEncoding } from '../helpers/gw-embed-stylesheet-response.helper';
import { GwEmbedStylesheetService } from '../services/gw-embed-stylesheet.service';

const OPERATION = 'gw_embed_stylesheet';

/**
 * HTTP boundary for the scoped embed stylesheet: validates the hashed file name and the optional
 * key, asks the service for the sheet and writes the response. Everything about fetching, scoping,
 * compressing and caching the body lives in `GwEmbedStylesheetService`.
 *
 * Public by design: the loader fetches without credentials, the content is public, and the only
 * upstream the service can reach is the configured `GW_EMBED_URL` with a name matching the hashed
 * pattern, so this is not a fetch proxy.
 *
 * Two URL forms, and the caching follows from what each one names:
 *
 * - `<route>/<key>/<name>`, which the outlet builds from `RuntimeConfig.gwEmbedStylesheetKey`. The
 *   name carries the upstream content hash and the key carries LFX's own share (theme layer and
 *   transform), so the URL names exactly one body: `immutable`, for a week (see `GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S`). A key that is not this
 *   server's own (a page rendered by a replica of another release, during a rollout) still gets the
 *   current body, but `no-store`, so that body is never pinned under a URL that names another.
 * - `<route>/<name>`, the fallback when the page had no key. It is not content-addressed, so it
 *   keeps the short max-age with an ETag.
 *
 * Failures are `no-store` as well: the route serves `.css` paths, which Cloudflare caches by
 * extension, and an error cached there would outlive the cause. A 404 during a Gatewaze rollout is
 * expected to clear within a minute.
 */
export class GwEmbedStylesheetController {
  public constructor(private readonly service: GwEmbedStylesheetService = new GwEmbedStylesheetService()) {}

  public async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = String(req.params['name'] ?? '');
    const key = req.params['key'] === undefined ? undefined : String(req.params['key']);
    if (!GW_EMBED_STYLESHEET_NAME_PATTERN.test(name) || (key !== undefined && !GW_EMBED_STYLESHEET_KEY_PATTERN.test(key))) {
      res.setHeader('Cache-Control', 'no-store');
      next(new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: OPERATION }));
      return;
    }

    try {
      const sheet = await this.service.load(req, name);
      const { encoding, body } = pickGwEmbedStylesheetEncoding(req, sheet);
      // One ETag per encoding: the bytes differ, so a strong validator must too.
      const etag = encoding === 'identity' ? sheet.etag : `${sheet.etag.slice(0, -1)}-${encoding}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', gwEmbedStylesheetCacheControl(key));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Vary', 'Accept-Encoding');
      if (ifNoneMatchHits(req.headers['if-none-match'], etag)) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      if (encoding !== 'identity') {
        // Set before the body is written, so the app-wide compression middleware sees it and leaves
        // the response alone ("already encoded").
        res.setHeader('Content-Encoding', encoding);
      }
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
    } catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      next(error);
    }
  }
}
