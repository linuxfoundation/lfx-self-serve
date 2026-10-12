// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { applySsrCacheHeaders } from './ssr-cache-headers.helper';
import { applySsrRenderStatus } from './ssr-render-status.helper';

describe('applySsrRenderStatus', () => {
  it('returns 503 for unavailable renders while preserving the rendered body and headers', async () => {
    const response = new Response('<main>Try again</main>', {
      headers: { 'Content-Type': 'text/html', Vary: 'Accept-Language', 'X-Request-Id': 'test-request' },
    });
    applySsrCacheHeaders(response);

    const result = await applySsrRenderStatus(response, { unavailable: true });

    expect(result.status).toBe(503);
    expect(result.statusText).toBe('Service Unavailable');
    expect(await result.text()).toBe('<main>Try again</main>');
    expect([...result.headers]).toEqual([...response.headers]);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('gives not-found precedence when both render flags are set', async () => {
    const result = await applySsrRenderStatus(new Response('Missing'), { notFound: true, unavailable: true });

    expect(result.status).toBe(404);
    expect(result.statusText).toBe('Not Found');
    expect(await result.text()).toBe('Missing');
  });

  it.each([302, 401, 404, 500, 503])('preserves an existing HTTP %s without consuming its body', async (status) => {
    const response = new Response('Original', { status });

    expect(await applySsrRenderStatus(response, { notFound: true, unavailable: true })).toBe(response);
    expect(response.bodyUsed).toBe(false);
  });

  it('leaves an unflagged successful render unchanged', async () => {
    const response = new Response('Page');

    expect(await applySsrRenderStatus(response, {})).toBe(response);
    expect(response.bodyUsed).toBe(false);
  });
});
