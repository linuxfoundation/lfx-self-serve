// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GW_EMBED_STYLESHEET_KEY_PATTERN, GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT } from '@lfx-one/shared/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGwEmbedBaseUrl, getGwEmbedStylesheetKey, loadGwEmbedTheme, resetGwEmbedThemeCache } from './gw-embed.helper';

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

describe('getGwEmbedStylesheetKey', () => {
  afterEach(() => {
    resetGwEmbedThemeCache();
  });

  it('is a fixed-length base64url key that the route accepts, stable within a process', () => {
    const key = getGwEmbedStylesheetKey('spec');
    expect(key).toMatch(GW_EMBED_STYLESHEET_KEY_PATTERN);
    expect(getGwEmbedStylesheetKey('spec')).toBe(key);
  });

  it('remembers a failure too, so a missing theme is not probed again on every page', () => {
    // No theme beside the bundle (this spec runs from source) and none under this cwd.
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-gw-embed-spec');
    try {
      expect(() => getGwEmbedStylesheetKey('spec')).toThrowError(expect.objectContaining({ code: 'GW_EMBED_THEME_UNAVAILABLE' }));
      const probes = cwd.mock.calls.length;
      expect(() => getGwEmbedStylesheetKey('spec')).toThrowError(expect.objectContaining({ code: 'GW_EMBED_THEME_UNAVAILABLE' }));
      expect(cwd.mock.calls.length).toBe(probes);
    } finally {
      cwd.mockRestore();
    }
  });

  it('is derived from the theme layer and the transform fingerprint', () => {
    const theme = loadGwEmbedTheme('spec');
    const expected = createHash('sha256').update(GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT).update('\n').update(theme).digest('base64url').slice(0, 16);
    expect(getGwEmbedStylesheetKey('spec')).toBe(expected);
  });

  it('has a transform fingerprint that matches the transform on disk', () => {
    // The scoped stylesheet is served as immutable under this key. A transform change that kept the
    // old fingerprint would leave every browser on the old output for a year, so the constant must
    // move with the file. If this fails, set GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT to `actual`.
    const actual = createHash('sha256')
      .update(readFileSync(join(process.cwd(), 'scripts', 'lib', 'contain-gw-embed-css.mjs')))
      .digest('hex');
    expect(GW_EMBED_STYLESHEET_TRANSFORM_FINGERPRINT).toBe(actual);
  });
});
