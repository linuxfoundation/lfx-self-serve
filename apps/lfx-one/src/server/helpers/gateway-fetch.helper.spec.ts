// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn() },
}));

vi.mock('../services/logger.service', () => ({ logger }));

import type { Request } from 'express';

import type { MicroserviceError } from '../errors';
import { gatewayFetch } from './gateway-fetch.helper';

describe('gatewayFetch sensitive response redaction', () => {
  const req = { apiGatewayToken: 'gateway-token' } as Request;
  const options = {
    operation: 'redeem_promotion',
    service: 'rewards_service',
    errorMessage: 'Coupon generation failed',
    errorCode: 'COUPON_GENERATION_FAILED',
    method: 'POST' as const,
    redactResponseBody: true,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not log or serialize a non-OK upstream body', async () => {
    const cancel = vi.fn();
    const upstream = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ CouponCode: 'SECRET-COUPON' })));
          controller.close();
        },
        cancel,
      }),
      { status: 409, statusText: 'Conflict' }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream)
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/redeem', options).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error).toMatchObject({ code: 'COUPON_GENERATION_FAILED' });
    expect(error.errorBody).toBeUndefined();
    expect(upstream.bodyUsed).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SECRET-COUPON');
    expect(logger.warning).toHaveBeenCalledWith(req, 'redeem_promotion', 'Upstream returned non-OK response', expect.objectContaining({ body_redacted: true }));
  });

  it('cancels a redacted response when draining fails', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const upstream = {
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      body: {
        getReader: () => ({
          read: vi.fn().mockRejectedValue(new Error('stream failed')),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream)
    );

    await expect(gatewayFetch(req, 'https://gateway.example.test/redeem', options)).rejects.toMatchObject({
      code: 'COUPON_GENERATION_FAILED',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('does not log or serialize an invalid successful response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('SECRET-COUPON', { status: 200 }))
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/redeem', options).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error).toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
    expect(error.errorBody).toBeUndefined();
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SECRET-COUPON');
  });
});

/**
 * The narrower option, for callers whose upstream refusals are written for the user: the sentence
 * only exists in the body, so discarding the body outright would discard the message with it.
 *
 * Keeping the body on the error is half a control, not a whole one — `MicroserviceError` puts
 * `errorBody` in its log context, and the API error handler logs that. The caller owes a
 * `withoutUpstreamBody` after taking the message out. Documented on the option, and the reason
 * these two behaviours are pinned separately.
 */
describe('gatewayFetch log-only redaction', () => {
  const req = { apiGatewayToken: 'gateway-token' } as Request;
  const options = {
    operation: 'org_cla_request_corporate_signature',
    service: 'org_cla_service',
    errorMessage: 'Failed to request the corporate CLA signature',
    errorCode: 'UPSTREAM_ERROR',
    method: 'POST' as const,
    redactResponseBodyFromLogs: true,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps a non-OK body out of the log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'refused', lf_username: 'SENSITIVE-HANDLE' }), { status: 403 }))
    );

    await gatewayFetch(req, 'https://gateway.example.test/sign', options).catch(() => undefined);

    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('SENSITIVE-HANDLE');
    expect(logger.warning.mock.calls[0]?.[3]).toMatchObject({ status: 403, body_redacted: true });
  });

  it('still attaches the body to the error, so the refusal sentence can be relayed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'refused' }), { status: 403 }))
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/sign', options).catch((caught: unknown) => caught)) as MicroserviceError;

    expect(error.errorBody).toContain('refused');
  });

  // Otherwise a caller that set both would quietly get the weaker of the two.
  it('is superseded by full redaction rather than overriding it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'refused' }), { status: 403 }))
    );

    const error = (await gatewayFetch(req, 'https://gateway.example.test/sign', { ...options, redactResponseBody: true }).catch(
      (caught: unknown) => caught
    )) as MicroserviceError;

    expect(error.errorBody).toBeUndefined();
  });

  /**
   * A 2xx whose body does not parse.
   *
   * The option was written for refusals and so was only ever consulted on the non-OK branch,
   * which left it silently unhonoured on the one path where the *success* payload is the
   * sensitive thing. On the corporate signing call that body is the signing address and the
   * signature identifier, so a single malformed response wrote both to the logs of a caller that
   * had explicitly opted out of exactly that.
   *
   * Both surfaces are asserted, because the body reaches the logs by two routes: the helper's own
   * warning, and `getLogContext()` on the thrown error, which the API error handler logs. Closing
   * only the first moves the leak one layer up instead of fixing it — which is how the same
   * finding came back twice before.
   */
  describe('a 2xx whose body does not parse', () => {
    const SIGN_URL = 'https://demo.docusign.example/signing/envelope-SENSITIVE-ADDRESS';
    const SIGNATURE_ID = 'signature-SENSITIVE-IDENTIFIER';

    function malformedSuccess(): void {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(`{"sign_url":"${SIGN_URL}","signature_id":"${SIGNATURE_ID}" <<truncated`, { status: 200 }))
      );
    }

    it('keeps the unparsed body out of the log line', async () => {
      malformedSuccess();

      await gatewayFetch(req, 'https://gateway.example.test/sign', options).catch(() => undefined);

      const emitted = JSON.stringify(logger.warning.mock.calls);
      expect(emitted).not.toContain('SENSITIVE-ADDRESS');
      expect(emitted).not.toContain('SENSITIVE-IDENTIFIER');
      expect(emitted).not.toContain('docusign');
    });

    /**
     * The redaction must not cost the diagnosis — but the parse message cannot be what preserves
     * it. V8 quotes the offending input (`Unexpected token 'S', "SECRET-COUPON" is not valid
     * JSON`), so logging the message hands over the leading edge of the very body being withheld.
     * The exception name carries the useful half without the payload.
     */
    it('still says what happened and on which operation, without quoting the body', async () => {
      malformedSuccess();

      await gatewayFetch(req, 'https://gateway.example.test/sign', options).catch(() => undefined);

      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'org_cla_request_corporate_signature',
        'Upstream returned invalid JSON response',
        expect.objectContaining({ status: 200, body_redacted: true, error_name: 'SyntaxError' })
      );
    });

    // Nothing relays a producer sentence out of a malformed success, so unlike the non-OK branch
    // there is nothing here to keep the body for — and keeping it would re-log it at the handler.
    it('does not carry the body out on the thrown error either', async () => {
      malformedSuccess();

      const error = (await gatewayFetch(req, 'https://gateway.example.test/sign', options).catch((caught: unknown) => caught)) as MicroserviceError;

      expect(error.errorBody).toBeUndefined();
      expect(JSON.stringify(error.getLogContext())).not.toContain('SENSITIVE-ADDRESS');
      expect(JSON.stringify(error.getLogContext())).not.toContain('SENSITIVE-IDENTIFIER');
    });

    // The counterpart: a caller that has not opted out still gets the body, or this change would
    // have quietly removed a diagnostic from every other consumer of the helper.
    it('leaves the body in place for a caller that did not ask for redaction', async () => {
      malformedSuccess();

      const plain = { ...options, redactResponseBodyFromLogs: false };
      const error = (await gatewayFetch(req, 'https://gateway.example.test/sign', plain).catch((caught: unknown) => caught)) as MicroserviceError;

      expect(error.errorBody).toContain('SENSITIVE-ADDRESS');
      expect(JSON.stringify(logger.warning.mock.calls)).toContain('SENSITIVE-ADDRESS');
    });
  });
});
