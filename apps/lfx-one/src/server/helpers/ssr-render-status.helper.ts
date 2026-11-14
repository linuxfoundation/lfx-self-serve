// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ServerRequestContext } from '@lfx-one/shared/interfaces';

/** Preserve non-200 responses and give not-found precedence over unavailable renders. */
export async function applySsrRenderStatus(response: Response, context: ServerRequestContext): Promise<Response> {
  if (response.status !== 200 || (!context.notFound && !context.unavailable)) {
    return response;
  }

  // Response.status is read-only; buffer the small error page before rebuilding it.
  const body = await response.text();
  return new globalThis.Response(body, {
    status: context.notFound ? 404 : 503,
    statusText: context.notFound ? 'Not Found' : 'Service Unavailable',
    headers: response.headers,
  });
}
