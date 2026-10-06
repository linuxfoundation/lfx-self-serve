// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import {
  GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES,
  GW_EMBED_STYLESHEET_MAX_AGE_S,
  GW_EMBED_STYLESHEET_MAX_BYTES,
  GW_EMBED_STYLESHEET_MAX_IN_FLIGHT,
  GW_EMBED_STYLESHEET_NAME_PATTERN,
  GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS,
  GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S,
  GW_EMBED_STYLESHEET_UPSTREAM_TIMEOUT_MS,
} from '@lfx-one/shared/constants';
import { containCss } from '../../../scripts/lib/contain-gw-embed-css.mjs';
import { MicroserviceError } from '../errors';
import { getGwEmbedBaseUrl, loadGwEmbedTheme } from '../helpers/gw-embed.helper';
import { logger } from '../services/logger.service';

const OPERATION = 'gw_embed_stylesheet';
const SERVICE = 'gw_embed';

interface CachedStylesheet {
  css: string;
  etag: string;
}

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
 * pattern, so it is not a fetch proxy. Because it is anonymous, it also brakes itself: failures
 * are remembered per name for a short while, and only a few upstream fetches run at once.
 *
 * The body is LFX output under an upstream-hashed name, so it is cached with a short max-age and
 * an ETag rather than as immutable — a theme or transform fix must reach users without a URL
 * change.
 */
export class GwEmbedStylesheetController {
  private readonly cache = new Map<string, CachedStylesheet>();
  private readonly inFlight = new Map<string, Promise<CachedStylesheet>>();
  private readonly failures = new Map<string, { until: number; error: MicroserviceError }>();

  public async serve(req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = String(req.params['name'] ?? '');
    if (!GW_EMBED_STYLESHEET_NAME_PATTERN.test(name)) {
      next(new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: OPERATION }));
      return;
    }

    try {
      const { css, etag } = await this.load(req, name);
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

  private load(req: Request, name: string): Promise<CachedStylesheet> {
    const cached = this.cache.get(name);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const failure = this.failures.get(name);
    if (failure) {
      if (failure.until > Date.now()) {
        return Promise.reject(failure.error);
      }
      this.failures.delete(name);
    }

    // Coalesce: a burst of first page views after a release must not each fetch and parse 2MB.
    let pending = this.inFlight.get(name);
    if (!pending) {
      if (this.inFlight.size >= GW_EMBED_STYLESHEET_MAX_IN_FLIGHT) {
        return Promise.reject(
          new MicroserviceError('The embed stylesheet is being prepared; retry shortly', 503, 'gw_embed_stylesheet_busy', {
            operation: OPERATION,
            service: SERVICE,
          })
        );
      }
      pending = this.fetchAndContain(req, name)
        .catch((error: unknown) => {
          const failed =
            error instanceof MicroserviceError
              ? error
              : new MicroserviceError('Could not prepare the embed stylesheet', 502, 'gw_embed_stylesheet_failed', { operation: OPERATION, service: SERVICE });
          // Misconfiguration is not remembered: fixing the env must take effect at once.
          if (failed.code !== 'GW_EMBED_URL_MISCONFIGURED' && failed.code !== 'GW_EMBED_THEME_UNAVAILABLE') {
            this.failures.set(name, { until: Date.now() + GW_EMBED_STYLESHEET_NEGATIVE_CACHE_MS, error: failed });
          }
          throw failed;
        })
        .finally(() => this.inFlight.delete(name));
      this.inFlight.set(name, pending);
    }
    return pending;
  }

  private async fetchAndContain(req: Request, name: string): Promise<CachedStylesheet> {
    const base = getGwEmbedBaseUrl(OPERATION);
    // Both resolved before any network work, so a bad env or a missing build copy costs nothing.
    const theme = loadGwEmbedTheme(OPERATION);
    const upstream = new URL(`${base.pathname.replace(/\/$/, '')}/${name}`, base);
    const started = Date.now();

    let response: globalThis.Response;
    try {
      response = await fetch(upstream, { signal: AbortSignal.timeout(GW_EMBED_STYLESHEET_UPSTREAM_TIMEOUT_MS), redirect: 'error' });
    } catch (error) {
      logger.warning(req, OPERATION, 'Could not fetch the embed stylesheet', { name, error: error instanceof Error ? error.message : String(error) });
      throw new MicroserviceError('Could not fetch the embed stylesheet', 502, 'gw_embed_stylesheet_unreachable', {
        operation: OPERATION,
        service: SERVICE,
        originalError: error instanceof Error ? error : undefined,
        transportFailure: true,
      });
    }

    if (!response.ok) {
      logger.warning(req, OPERATION, 'Upstream answered a non-success status for the embed stylesheet', { name, status: response.status });
      await response.body?.cancel().catch(() => undefined);
      throw new MicroserviceError(
        'The embed stylesheet is not available upstream',
        response.status === 404 ? 404 : 502,
        'gw_embed_stylesheet_upstream_status',
        {
          operation: OPERATION,
          service: SERVICE,
        }
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('text/css')) {
      logger.warning(req, OPERATION, 'Upstream answered the embed stylesheet with an unexpected content type', { name, content_type: contentType });
      await response.body?.cancel().catch(() => undefined);
      throw new MicroserviceError('The embed stylesheet upstream answered with an unexpected content type', 502, 'gw_embed_stylesheet_bad_content_type', {
        operation: OPERATION,
        service: SERVICE,
      });
    }

    const tooLarge = (): MicroserviceError =>
      new MicroserviceError('The embed stylesheet is larger than allowed', 502, 'gw_embed_stylesheet_too_large', { operation: OPERATION, service: SERVICE });

    const declaredHeader = response.headers.get('content-length');
    if (declaredHeader !== null) {
      const declared = Number(declaredHeader);
      if (!Number.isFinite(declared) || declared < 0 || declared > GW_EMBED_STYLESHEET_MAX_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw tooLarge();
      }
    }

    const raw = await readBounded(response, GW_EMBED_STYLESHEET_MAX_BYTES, tooLarge);

    const { css: contained, stats, compoundRootSelectors } = containCss(raw);
    if (stats.rules === 0) {
      logger.warning(req, OPERATION, 'The embed stylesheet contained no rules after transform', { name, bytes_in: raw.length });
      throw new MicroserviceError('The embed stylesheet is empty', 502, 'gw_embed_stylesheet_empty', { operation: OPERATION, service: SERVICE });
    }
    // The LFX theme layer goes after the contained CSS so its overrides win on source order.
    const css = `${contained}\n${theme}\n`;
    const entry: CachedStylesheet = { css, etag: `"${createHash('sha256').update(css).digest('base64url')}"` };

    if (this.cache.size >= GW_EMBED_STYLESHEET_CACHE_MAX_ENTRIES) {
      // Insertion order is eviction order: the oldest release's sheet goes first.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(name, entry);

    logger.info(req, OPERATION, 'Scoped and cached the embed stylesheet', {
      name,
      bytes_in: raw.length,
      bytes_out: css.length,
      rules: stats.rules,
      keyframes: stats.keyframes,
      dropped: stats.dropped,
      compound_root_selectors: compoundRootSelectors.size,
      duration_ms: Date.now() - started,
    });
    return entry;
  }
}

/**
 * Reads the body as UTF-8 while counting bytes, and stops the moment the cap is crossed — a
 * chunked or compressed upstream carries no usable Content-Length, so the cap has to be enforced
 * on what actually arrives, before it is all in memory.
 */
async function readBounded(response: globalThis.Response, maxBytes: number, tooLarge: () => MicroserviceError): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}
