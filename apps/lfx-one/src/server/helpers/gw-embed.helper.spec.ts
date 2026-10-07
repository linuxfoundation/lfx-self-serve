// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { getGwEmbedBaseUrl, loadGwEmbedTheme, resetGwEmbedThemeCache } from './gw-embed.helper';

describe('getGwEmbedBaseUrl', () => {
  afterEach(() => {
    delete process.env['GW_EMBED_URL'];
  });

  it('returns the configured https origin and path', () => {
    process.env['GW_EMBED_URL'] = 'https://admin.example.test/embed';
    const url = getGwEmbedBaseUrl('spec');
    expect(url.origin).toBe('https://admin.example.test');
    expect(url.pathname).toBe('/embed');
  });

  it('allows plain http for local development', () => {
    process.env['GW_EMBED_URL'] = 'http://localhost:8080/embed';
    expect(getGwEmbedBaseUrl('spec').href).toBe('http://localhost:8080/embed');
  });

  it.each([
    ['unset', undefined, 'not configured'],
    ['blank', '   ', 'not configured'],
    ['trailing slash', 'https://admin.example.test/embed/', 'trailing slash'],
    ['not a URL', 'admin.example.test/embed', 'not a valid URL'],
    ['ftp scheme', 'ftp://admin.example.test/embed', 'https'],
    ['plain http on a non-local host', 'http://admin.example.test/embed', 'localhost only'],
    ['credentials in the URL', 'https://user:secret@admin.example.test/embed', 'credentials'],
    ['query string', 'https://admin.example.test/embed?x=1', 'query string'],
    ['fragment', 'https://admin.example.test/embed#x', 'query string'],
  ])('rejects %s as a 503 GW_EMBED_URL_MISCONFIGURED', (_label, value, reason) => {
    if (value === undefined) {
      delete process.env['GW_EMBED_URL'];
    } else {
      process.env['GW_EMBED_URL'] = value;
    }
    expect(() => getGwEmbedBaseUrl('spec')).toThrowError(
      expect.objectContaining({ statusCode: 503, code: 'GW_EMBED_URL_MISCONFIGURED', message: expect.stringContaining(reason) })
    );
  });
});

describe('loadGwEmbedTheme', () => {
  afterEach(() => {
    resetGwEmbedThemeCache();
  });

  it('reads the theme from the source tree under the dev cwd and memoises it', () => {
    const first = loadGwEmbedTheme('spec');
    expect(first).toContain('LFX theme for the embedded Gatewaze admin');
    expect(loadGwEmbedTheme('spec')).toBe(first);
  });
});
