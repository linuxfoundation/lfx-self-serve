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

describe('ApiClientService — a body READ failure is a transport failure, not the upstream answer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Reading the error body and PARSING it are two different failures, and collapsing them into
  // one try/catch (which an earlier revision did) reports the wrong thing for one of them:
  //
  //   - JSON.parse fails  -> upstream ANSWERED, the answer was not JSON. Benign: the status and
  //                          statusText already describe it.
  //   - response.text() fails -> the body never finished arriving. The request's outcome is
  //                          UNKNOWN, and reporting the upstream's status for it tells the caller
  //                          we received an answer we never got. A non-idempotent caller then
  //                          retries a request that may already have landed.
  const failingBody = (status: number, readError: Error) =>
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status,
        statusText: 'Bad Gateway',
        text: () => Promise.reject(readError),
      })
    );

  it('classifies an aborted body read as 408 UNCONFIRMED, not as the upstream status', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', failingBody(502, aborted));

    const err = await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e);

    const me = err as MicroserviceError;
    expect(me, 'a body-read failure escaped unclassified').toBeInstanceOf(MicroserviceError);
    // NOT 502: we never received the upstream's answer, so we must not report one.
    expect(me.statusCode, 'the upstream status was reported for an answer that never arrived').toBe(408);
    expect(me.toResponse()['transport'], 'a lost body read was not marked as a transport failure').toBe(true);
  });

  it('classifies any other body-read failure as 503 UNCONFIRMED', async () => {
    vi.stubGlobal('fetch', failingBody(502, new Error('socket hang up')));

    const err = await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e);

    const me = err as MicroserviceError;
    expect(me.statusCode).toBe(503);
    expect(me.toResponse()['transport']).toBe(true);
  });

  it('still reports the upstream status when the body merely fails to PARSE', async () => {
    // The other half of the split: upstream ANSWERED, the answer was not JSON. That is the
    // upstream's own 502 and must keep its status -- downgrading it to a transport failure would
    // tell a caller to retry a request the boundary already refused.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: () => Promise.resolve('<html>not json</html>'),
        })
      )
    );

    const err = await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e);

    const me = err as MicroserviceError;
    expect(me.statusCode, 'an answered 502 was reclassified as a transport failure').toBe(502);
    expect(me.toResponse()['transport']).toBeUndefined();
  });

  it('never leaks the upstream body into the client-visible message', async () => {
    // The bot's revision built the message from `errorBody?.message || errorBody?.error`, handing
    // an authenticated client whatever the upstream chose to say.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: () => Promise.resolve(JSON.stringify({ message: 'INTERNAL-HOST-42 db=prod-primary' })),
        })
      )
    );

    const err = await new ApiClientService({ retryAttempts: 1 }).request('GET', 'https://example.invalid/x').catch((e: unknown) => e);

    const body = (err as MicroserviceError).toResponse();
    expect(JSON.stringify(body), 'an upstream internal detail reached the client').not.toContain('INTERNAL-HOST-42');
  });
});
