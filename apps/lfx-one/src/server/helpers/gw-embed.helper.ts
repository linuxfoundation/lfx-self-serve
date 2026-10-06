// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MicroserviceError } from '../errors';

/**
 * Resolves where the Gatewaze deployment serves the embeddable admin from the `GW_EMBED_URL` env
 * var (e.g. `https://admin.example.org/embed`, no trailing slash). The browser reads the same
 * value through RuntimeConfig; the server uses it to fetch the bundle's stylesheet for scoping.
 *
 * Mirrors `getGwApiBaseUrl`: a misconfiguration is a 503 with a code that names the variable,
 * never a generic 500.
 */
export function getGwEmbedBaseUrl(operation: string): URL {
  const raw = process.env['GW_EMBED_URL'];
  if (!raw || !raw.trim()) {
    throw new MicroserviceError('GW_EMBED_URL environment variable is not configured', 503, 'GW_EMBED_URL_MISCONFIGURED', {
      operation,
      service: 'gw_embed',
    });
  }
  const trimmed = raw.trim();
  if (trimmed.endsWith('/')) {
    throw new MicroserviceError('GW_EMBED_URL must not have a trailing slash', 503, 'GW_EMBED_URL_MISCONFIGURED', {
      operation,
      service: 'gw_embed',
    });
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MicroserviceError('GW_EMBED_URL is not a valid URL', 503, 'GW_EMBED_URL_MISCONFIGURED', {
      operation,
      service: 'gw_embed',
    });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MicroserviceError('GW_EMBED_URL must be an http(s) URL', 503, 'GW_EMBED_URL_MISCONFIGURED', {
      operation,
      service: 'gw_embed',
    });
  }
  return url;
}

/**
 * The LFX theme layer for the embed (`src/styles/gw-embed-theme.css`), appended after the
 * contained embed stylesheet so its token overrides win on source order without `!important`.
 * Every selector in it writes the scope out by hand (checked by
 * scripts/check-gw-embed-palette.spec.mjs), so it is not passed through the containment transform.
 *
 * Resolved like the PDF templates: in production `import.meta.url` is the server bundle and the
 * build copies the file beside it; under `ng serve` it is read from the source tree.
 */
export function loadGwEmbedTheme(): string {
  const bundlePath = join(dirname(fileURLToPath(import.meta.url)), 'gw-embed-theme.css');
  const devPath = join(process.cwd(), 'src', 'styles', 'gw-embed-theme.css');
  const path = existsSync(bundlePath) ? bundlePath : devPath;
  return readFileSync(path, 'utf8');
}
