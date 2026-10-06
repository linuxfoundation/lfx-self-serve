// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { GW_EMBED_STYLESHEET_NAME_PATTERN } from '@lfx-one/shared/constants';
import { containCss } from '../../../scripts/lib/contain-gw-embed-css.mjs';
import { MicroserviceError } from '../errors';
import { getGwEmbedBaseUrl, loadGwEmbedTheme } from '../helpers/gw-embed.helper';
import { logger } from '../services/logger.service';

/** How long the upstream fetch may take; the file is ~2MB from a CDN-fronted origin. */
const UPSTREAM_TIMEOUT_MS = 15_000;
/** Largest stylesheet accepted; the real one is ~2.3MB, so this is headroom, not a target. */
const MAX_STYLESHEET_BYTES = 8 * 1024 * 1024;
/**
 * Names are content-hashed, so a cached copy is never stale; the cap only bounds memory across
 * deploys of the upstream. Insertion order is eviction order.
 */
const CACHE_MAX_ENTRIES = 4;

/**
 * Serves the embed's stylesheet scoped to the LFX chrome.
 *
 * `@gatewaze/admin-embed` ships its stylesheet unscoped and lets the host swap the URL it fetches
 * (`GwEmbedSource.resolveStylesheetUrl`). The outlet points it here with the hashed file name;
 * this fetches that file from `GW_EMBED_URL`, runs the same containment transform the old build
 * step ran (`scripts/lib/contain-gw-embed-css.mjs`), appends the LFX theme layer and caches the
 * result by name. The transform therefore runs once per Gatewaze release per pod rather than
 * once per page view, and no CSS parser ships to the browser.
 *
 * Public by design: the loader fetches without credentials, the content is public, and the only
 * upstream this can reach is the configured `GW_EMBED_URL` with a name matching the hashed
 * pattern, so it is not a fetch proxy.
 */
export class GwEmbedStylesheetController {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();

  public async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = String(req.params['name'] ?? '');
    if (!GW_EMBED_STYLESHEET_NAME_PATTERN.test(name)) {
      next(new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: 'gw_embed_stylesheet' }));
      return;
    }

    try {
      const css = await this.load(req, name);
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(css);
    } catch (error) {
      next(error);
    }
  }

  private load(req: Request, name: string): Promise<string> {
    const cached = this.cache.get(name);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    // Coalesce: a burst of first page views after a release must not each fetch and parse 2MB.
    let pending = this.inFlight.get(name);
    if (!pending) {
      pending = this.fetchAndContain(req, name).finally(() => this.inFlight.delete(name));
      this.inFlight.set(name, pending);
    }
    return pending;
  }

  private async fetchAndContain(req: Request, name: string): Promise<string> {
    const base = getGwEmbedBaseUrl('gw_embed_stylesheet');
    const upstream = new URL(`${base.pathname.replace(/\/$/, '')}/${name}`, base);
    const started = Date.now();

    let response: globalThis.Response;
    try {
      response = await fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: 'error' });
    } catch (error) {
      throw new MicroserviceError('Could not fetch the embed stylesheet', 502, 'gw_embed_stylesheet_unreachable', {
        operation: 'gw_embed_stylesheet',
        service: 'gw_embed',
        originalError: error instanceof Error ? error : undefined,
        transportFailure: true,
      });
    }
    if (!response.ok) {
      throw new MicroserviceError(`The embed stylesheet is not available upstream (${response.status})`, response.status === 404 ? 404 : 502, 'gw_embed_stylesheet_upstream_status', {
        operation: 'gw_embed_stylesheet',
        service: 'gw_embed',
      });
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_STYLESHEET_BYTES) {
      throw new MicroserviceError('The embed stylesheet is larger than allowed', 502, 'gw_embed_stylesheet_too_large', {
        operation: 'gw_embed_stylesheet',
        service: 'gw_embed',
      });
    }
    const raw = await response.text();
    if (raw.length > MAX_STYLESHEET_BYTES) {
      throw new MicroserviceError('The embed stylesheet is larger than allowed', 502, 'gw_embed_stylesheet_too_large', {
        operation: 'gw_embed_stylesheet',
        service: 'gw_embed',
      });
    }

    const { css: contained, stats, compoundRootSelectors } = containCss(raw);
    // The LFX theme layer goes after the contained CSS so its overrides win on source order.
    const css = `${contained}\n${loadGwEmbedTheme()}\n`;

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(name, css);

    logger.info(req, 'gw_embed_stylesheet', 'Scoped and cached the embed stylesheet', {
      name,
      bytes_in: raw.length,
      bytes_out: css.length,
      rules: stats.rules,
      keyframes: stats.keyframes,
      dropped: stats.dropped,
      compound_root_selectors: compoundRootSelectors.size,
      duration_ms: Date.now() - started,
    });
    return css;
  }
}
