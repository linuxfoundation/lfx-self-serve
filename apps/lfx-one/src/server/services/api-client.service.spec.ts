// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientService } from './api-client.service';
import { MicroserviceError } from '../errors/microservice.error';

/**
 * Every fetch rejection must arrive classified, because `transport: true` (derived from
 * `originalError` in BaseApiError.toResponse) is what several consumers now use to tell a
 * BFF-raised failure from a deliberate upstream one -- including the newsletter panel, where the
 * difference decides whether an operator is told "scheduling is off, use Send now" on what is
 * actually a transient outage.
 *
 * The wrap used to be conditional on `error.cause.code`, which fetch does not guarantee:
 * `redirect: 'error'` rejects with a cause carrying none. Those fell through unwrapped and
 * reached the client as an unmarked 500, so the marker every consumer depends on was absent
 * exactly when it mattered.
 */
describe('ApiClientService — transport failures are always classified', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['a cause WITH a code', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })],
    // The case the conditional missed.
    ['a cause with NO code', Object.assign(new TypeError('fetch failed'), { cause: {} })],
    ['no cause at all', new TypeError('fetch failed')],
  ])('wraps %s as a 503 carrying originalError', async (_label, thrown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(thrown))
    );

    const err = await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e);

    expect(err, 'a raw Error escaped unclassified').toBeInstanceOf(MicroserviceError);
    const me = err as MicroserviceError;
    expect(me.statusCode, '503 means UNCONFIRMED; 500 would claim nothing happened').toBe(503);
    // The marker itself, which is what consumers actually read.
    expect(me.toResponse()['transport']).toBe(true);
  });
});
