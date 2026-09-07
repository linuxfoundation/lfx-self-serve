// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { applySsrCacheHeaders } from './ssr-cache-headers.helper';

describe('applySsrCacheHeaders', () => {
  it('sets private, no-store on a normal 200 SSR render', () => {
    const response = new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

    applySsrCacheHeaders(response);

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('sets private, no-store on a redirect response without dropping its existing headers', () => {
    const response = new Response(null, { status: 302, headers: { Location: '/en-US/', Vary: 'Accept-Language' } });

    applySsrCacheHeaders(response);

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Location')).toBe('/en-US/');
    expect(response.headers.get('Vary')).toBe('Accept-Language');
  });

  it('overwrites a pre-existing Cache-Control value rather than appending to it', () => {
    const response = new Response(null, { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } });

    applySsrCacheHeaders(response);

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
