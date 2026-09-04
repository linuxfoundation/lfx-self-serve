// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientService } from './api-client.service';
import { MicroserviceError } from '../errors/microservice.error';

/**
 * Every fetch rejection must arrive classified, because `transport: true` -- emitted by
 * BaseApiError.toResponse from the explicit `transportFailure` flag the throwing site sets, NOT
 * from `originalError`, which seven non-transport services also populate -- is what consumers use
 * to tell a
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

  it('never puts the underlying error text in the CLIENT-VISIBLE message', async () => {
    // Copilot, security: this branch also catches `JSON.parse` failures on a SUCCESSFUL upstream
    // response, and Node embeds a body EXCERPT in that error's message -- the opening bytes of
    // whatever came back, typically an internal HTML error page. `toResponse()` returns the
    // message verbatim, so `Request failed: ${error.message}` handed an authenticated client a
    // fragment of an internal response.
    //
    // The secret-shaped string below is what must NOT survive to the wire.
    const leaky = new TypeError('Unexpected token < in JSON at position 0: <html><body>INTERNAL-HOST-42 db=prod-primary');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(leaky))
    );

    const err = (await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e)) as MicroserviceError;

    const wire = JSON.stringify(err.toResponse());
    expect(wire, 'an upstream response fragment reached the client').not.toMatch(/INTERNAL-HOST-42|prod-primary|<html>/);
    // Still classified -- the fix must not cost the transport marker consumers depend on.
    expect(err.statusCode).toBe(503);
    expect(err.toResponse()['transport']).toBe(true);
  });

  it.each([
    ['AbortError', 'request'],
    ['TimeoutError', 'request'],
    ['AbortError', 'streamRequest'],
    ['TimeoutError', 'streamRequest'],
  ])('marks a %s from %s as a 408 carrying transport:true', async (errName, method) => {
    // Copilot: every existing case rejects with a TypeError, so the TIMEOUT branch was never
    // exercised -- deleting `transportFailure: true` from it left this suite green. Consumers
    // read that marker to avoid treating an uncertain mutation as a definite failure, which on
    // an irreversible REMOVE is the difference between "retry safely" and "may duplicate".
    //
    // Both request paths, because each carries its OWN copy of the classification.
    const thrown = Object.assign(new Error('The operation was aborted'), { name: errName });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(thrown))
    );

    const client = new ApiClientService({ retryAttempts: 1 });
    const err = (await (
      method === 'request' ? client.request('GET', 'https://example.invalid/x') : client.streamRequest('GET', 'https://example.invalid/x')
    ).catch((e: unknown) => e)) as MicroserviceError;

    expect(err, 'a timeout escaped unclassified').toBeInstanceOf(MicroserviceError);
    expect(err.statusCode, '408 is the timeout status a consumer keys on').toBe(408);
    expect(err.toResponse()['transport'], 'a timeout lost the transport marker').toBe(true);
  });

  it.each([
    ['a read timeout', Object.assign(new Error('body read timed out'), { name: 'TimeoutError' }), 408],
    ['a dropped connection', new TypeError('terminated'), 503],
  ])('marks %s while reading a non-2xx body as transport, not as that status', async (_label, readError, expectedStatus) => {
    // Copilot: one try wrapped BOTH the body read and the JSON parse, so a mid-body connection
    // drop was swallowed as if it were unparseable JSON. The resulting error carried no
    // `transport: true`, and the guard in the catch rethrows an already-classified error
    // untouched -- so an UNCONFIRMED write read as an answered upstream refusal, which is the one
    // reading that tells a caller retrying is safe.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          headers: new Headers(),
          text: () => Promise.reject(readError),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 }).request('POST', 'https://example.invalid/x').catch((e: unknown) => e)) as MicroserviceError;

    expect(err).toBeInstanceOf(MicroserviceError);
    // NOT 502: the status arrived, the body did not, and nothing establishes what upstream did.
    expect(err.statusCode, 'a failed body read was reported as the upstream status').toBe(expectedStatus);
    expect(err.toResponse()['transport'], 'a failed body read lost the transport marker').toBe(true);
  });

  it('marks a failed non-2xx body read in streamRequest as transport too', async () => {
    // Swept, not reported: the same one-try-around-both gap existed in streamRequest, which
    // carries its own copy of this handling. Each path needs its own case because neither
    // exercises the other.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          headers: new Headers(),
          text: () => Promise.reject(new TypeError('terminated')),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 })
      .streamRequest('POST', 'https://example.invalid/x')
      .catch((e: unknown) => e)) as MicroserviceError;

    expect(err.statusCode, 'a failed body read was reported as the upstream status').toBe(503);
    expect(err.toResponse()['transport'], 'a failed body read lost the transport marker').toBe(true);
  });

  it('still reports an unparseable non-2xx body as that upstream status', async () => {
    // The other direction: an unparseable body is still an ANSWER -- upstream replied with this
    // status -- so it must NOT be recast as a transport failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers(),
          text: () => Promise.resolve('<html>not json</html>'),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e)) as MicroserviceError;

    expect(err.statusCode, 'an answered 403 was recast').toBe(403);
    expect(err.toResponse()['transport']).toBeUndefined();
  });

  it('does NOT recast a genuine upstream 4xx as a transport failure', async () => {
    // The non-2xx MicroserviceError is thrown INSIDE the same try as the fetch call, so a
    // catch-all fallback re-wraps it: a real 403 would leave as a 503 carrying transport:true,
    // and every consumer's unconfirmed-vs-definite split collapses -- an upstream refusal that
    // provably never dispatched would start reading as "may have happened, do not retry".
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers(),
          text: () => Promise.resolve(JSON.stringify({ message: 'not your campaign' })),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e)) as MicroserviceError;

    expect(err.statusCode, 'a real 403 was recast').toBe(403);
    expect(err.toResponse()['transport'], 'an upstream answer was marked as BFF transport').toBeUndefined();
  });

  it('preserves an upstream 4xx when its error body cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers(),
          text: () => Promise.reject(new TypeError('terminated')),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e)) as MicroserviceError;

    expect(err.statusCode).toBe(403);
    expect(err.toResponse()['transport']).toBeUndefined();
  });
});

/**
 * streamRequest carries its OWN copy of the transport classification, and the tests above drive
 * only request(). A regression in the stream branches would drop the marker or recast an upstream
 * 4xx without failing anything -- which is how the duplicated logic diverges silently.
 */
describe('ApiClientService.streamRequest — same classification, separate code path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['a cause WITH a code', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })],
    ['a cause with NO code', Object.assign(new TypeError('fetch failed'), { cause: {} })],
    ['no cause at all', new TypeError('fetch failed')],
  ])('wraps %s as a 503 carrying the transport marker', async (_label, thrown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(thrown))
    );

    const err = (await new ApiClientService({ retryAttempts: 1 })
      .streamRequest('GET', 'https://example.invalid/x')
      .catch((e: unknown) => e)) as MicroserviceError;

    expect(err).toBeInstanceOf(MicroserviceError);
    expect(err.statusCode).toBe(503);
    expect(err.toResponse()['transport']).toBe(true);
  });

  it('does NOT recast a genuine upstream 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers(),
          text: () => Promise.resolve(JSON.stringify({ message: 'not your campaign' })),
        })
      )
    );

    const err = (await new ApiClientService({ retryAttempts: 1 })
      .streamRequest('GET', 'https://example.invalid/x')
      .catch((e: unknown) => e)) as MicroserviceError;

    expect(err.statusCode, 'a real 403 was recast on the stream path').toBe(403);
    expect(err.toResponse()['transport']).toBeUndefined();
  });
});
