// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';

const MISCONFIGURED = 'GW_EMBED_URL_MISCONFIGURED';

/**
 * Resolves where the Gatewaze deployment serves the embeddable admin from the `GW_EMBED_URL` env
 * var (e.g. `https://admin.example.org/embed`, no trailing slash). The browser reads the same
 * value through RuntimeConfig; the server uses it to fetch the bundle's stylesheet for scoping.
 *
 * Mirrors `getGwApiBaseUrl`: a misconfiguration is a 503 with a code that names the variable,
 * never a generic 500. Only http(s) without credentials is accepted — this is the one origin the
 * anonymous stylesheet route is allowed to fetch from.
 */
export function getGwEmbedBaseUrl(operation: string): URL {
  const fail = (message: string): MicroserviceError => new MicroserviceError(message, 503, MISCONFIGURED, { operation, service: 'gw_embed' });

  const raw = process.env['GW_EMBED_URL'];
  if (!raw || !raw.trim()) {
    throw fail('GW_EMBED_URL environment variable is not configured');
  }
  const trimmed = raw.trim();
  if (trimmed.endsWith('/')) {
    throw fail('GW_EMBED_URL must not have a trailing slash');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw fail('GW_EMBED_URL is not a valid URL');
  }
  // Same rule as the loader (@gatewaze/admin-embed isAllowedBaseUrl): https, or http for a local
  // host only. The value is published to the browser, and a value the loader would refuse must
  // fail here, at configuration time, rather than as gw_ctx_source_invalid on every mount.
  const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localHttp) {
    throw fail('GW_EMBED_URL must be https (http is allowed for localhost only)');
  }
  if (url.username || url.password) {
    throw fail('GW_EMBED_URL must not carry credentials');
  }
  if (url.search || url.hash) {
    throw fail('GW_EMBED_URL must not have a query string or fragment');
  }
  return url;
}

let themeCache: string | undefined;

/**
 * The LFX theme layer for the embed (`src/styles/gw-embed-theme.css`), appended after the
 * contained embed stylesheet so its token overrides win on source order without `!important`.
 * Every selector in it writes the scope out by hand (checked by
 * scripts/check-gw-embed-palette.spec.mjs), so it is not passed through the containment transform.
 *
 * Resolved like the PDF templates: in production `import.meta.url` is the server bundle and the
 * build copies the file beside it; under `ng serve` it is read from the source tree. Read once
 * per process. A missing or unreadable file is a named 503, not an opaque 500, so a broken build
 * copy is diagnosable from the error code alone.
 */
export function loadGwEmbedTheme(operation: string): string {
  if (themeCache !== undefined) {
    return themeCache;
  }
  const bundlePath = join(dirname(fileURLToPath(import.meta.url)), 'gw-embed-theme.css');
  const devPath = join(process.cwd(), 'src', 'styles', 'gw-embed-theme.css');
  const path = existsSync(bundlePath) ? bundlePath : devPath;
  try {
    themeCache = readFileSync(path, 'utf8');
  } catch (error) {
    throw new MicroserviceError('The embed theme layer is not available on this server', 503, 'GW_EMBED_THEME_UNAVAILABLE', {
      operation,
      service: 'gw_embed',
      originalError: error instanceof Error ? error : undefined,
    });
  }
  return themeCache;
}

/**
 * This server's key for its own share of the scoped embed stylesheet: a hash of the theme layer and
 * the containment transform's fingerprint (`GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT`), 16
 * base64url characters. The upstream half of the content is already addressed by the hashed file
 * name, so `<key>/<name>` names exactly one body and that URL can be cached as immutable.
 *
 * Every replica of one release computes the same key, and a release that changes the theme or the
 * transform computes a new one. Throws what `loadGwEmbedTheme` throws.
 */
export function getGwEmbedStylesheetKey(operation: string): string {
  // Memoised, failure included: every SSR render asks for it, and with the theme missing an
  // unmemoised call would repeat the synchronous file probe on every page. The build copy cannot
  // appear later in a running process, so remembering the failure loses nothing.
  if (stylesheetKeyCache === undefined) {
    try {
      const theme = loadGwEmbedTheme(operation);
      stylesheetKeyCache = {
        key: createHash('sha256').update(GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT).update('\n').update(theme).digest('base64url').slice(0, 16),
      };
    } catch (error) {
      stylesheetKeyCache = { error };
    }
  }
  if ('error' in stylesheetKeyCache) {
    throw stylesheetKeyCache.error;
  }
  return stylesheetKeyCache.key;
}

let stylesheetKeyCache: { key: string } | { error: unknown } | undefined;

/** Test seam: forget the memoised theme so a spec can exercise the read path again. */
export function resetGwEmbedThemeCache(): void {
  themeCache = undefined;
  stylesheetKeyCache = undefined;
}
