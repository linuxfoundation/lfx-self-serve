// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw fail('GW_EMBED_URL must be an http(s) URL');
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

/** Test seam: forget the memoised theme so a spec can exercise the read path again. */
export function resetGwEmbedThemeCache(): void {
  themeCache = undefined;
}
