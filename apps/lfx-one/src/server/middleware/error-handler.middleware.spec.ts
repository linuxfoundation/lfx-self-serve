// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * What the API error handler writes to the log, and what it writes to the client.
 *
 * These are separate questions for exactly one class of error, and this suite exists for that
 * class: an upstream refusal whose sentence must be shown to the person who triggered it and must
 * not be recorded anywhere. The CLA service answers a signing-scope refusal with a body naming the
 * caller, and a trade-compliance refusal with a body naming the organization's standing. Both are
 * 403s, both are relayed verbatim to the signatory by design (#1983), and neither may appear in a
 * log line.
 *
 * The assertions below deliberately search the *whole* emitted payload rather than named fields.
 * This leak has been reported fixed twice while still being live, both times because the fix was
 * verified by inspecting the field that had been cleaned rather than the line that gets written —
 * and the refusal was still arriving through a different one. Serializing the payload and
 * searching it for the sentence is the only assertion that cannot pass while the leak is open.
 */

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { getLastOperation: vi.fn(() => undefined), info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { apiErrorHandler } = await import('./error-handler.middleware');
const { logger } = await import('../services/logger.service');
const { MicroserviceError } = await import('../errors');
const { withoutUpstreamBody, withProducerRefusalMessage } = await import('../services/cla.service');
const { customErrorSerializer } = await import('../helpers/error-serializer');

/**
 * Shaped like the real thing and synthetic in every part: a scope refusal names the caller, so a
 * fixture copied from a real one would put a real person's LF username in this file.
 */
const REFUSAL = 'user contributor-xyz is not authorized for project acme-motors-example on behalf of Vendor Corp';

/** The generic sentence `gatewayFetch` builds for a non-OK response, before any relay runs. */
const GENERIC = 'Failed to request corporate signature: 403 Forbidden';

/** The error the sign path throws: relay the refusal to the client, drop the body it came from. */
function refusedSigningError(): unknown {
  const upstream = new MicroserviceError(GENERIC, 403, 'FORBIDDEN', {
    operation: 'org_cla_request_corporate_signature',
    service: 'easycla',
    errorBody: JSON.stringify({ message: REFUSAL }),
  });

  return withoutUpstreamBody(withProducerRefusalMessage(upstream, 'org_cla_request_corporate_signature', 'easycla'));
}

function buildReq(): Request {
  return { id: 'req-1', path: '/api/orgs/acme/lens/cla-groups/sign', method: 'POST', get: () => 'vitest' } as unknown as Request;
}

function buildRes(): Response & { statusCode?: number; body?: Record<string, unknown> } {
  const res = {
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      res.body = body;
      return res;
    },
  } as unknown as Response & { statusCode?: number; body?: Record<string, unknown> };

  return res;
}

function handle(error: unknown): { res: ReturnType<typeof buildRes> } {
  const res = buildRes();
  apiErrorHandler(error as Error, buildReq(), res, vi.fn() as unknown as NextFunction);
  return { res };
}

/**
 * Everything the log line would contain, as one searchable string.
 *
 * `err` is run through the real Pino serializer rather than stringified directly, because that
 * serializer is what turns an Error into loggable fields — and it is the component that would
 * copy a plain public property back onto the payload the handler had just been careful about.
 * Skipping it would test a payload nobody emits.
 */
function emittedLogText(): string {
  const warning = vi.mocked(logger.warning).mock.calls.at(-1);
  expect(warning, 'expected a warning to have been logged for a 4xx').toBeDefined();

  const [, operation, message, metadata] = warning as [unknown, string, string, Record<string, unknown>];
  const { err, ...rest } = metadata;

  return JSON.stringify({ operation, message, err: customErrorSerializer(err), rest });
}

beforeEach(() => vi.clearAllMocks());

describe('apiErrorHandler — a relayed upstream refusal', () => {
  it('shows the signatory the refusal in the CLA service’s own words', () => {
    const { res } = handle(refusedSigningError());

    expect(res.statusCode).toBe(403);
    expect(res.body?.['error']).toBe(REFUSAL);
  });

  it('writes none of the refusal to the log', () => {
    handle(refusedSigningError());

    expect(emittedLogText()).not.toContain(REFUSAL);
  });

  // The two identifiers inside the sentence, asserted on their own. A future refusal format that
  // this suite's fixture does not predict would still have to get these two past the assertion.
  it('writes neither the named caller nor the named organization to the log', () => {
    handle(refusedSigningError());

    const logged = emittedLogText();
    expect(logged).not.toContain('contributor-xyz');
    expect(logged).not.toContain('Vendor Corp');
  });

  it('logs the generic upstream sentence instead, so the failure is still diagnosable', () => {
    handle(refusedSigningError());

    const logged = emittedLogText();
    expect(logged).toContain(GENERIC);
    expect(logged).toContain('org_cla_request_corporate_signature');
  });

  // The raw body is a second copy of the same sentence, reached by a different route: the handler
  // spreads `getLogContext()` (which returns `error_body`) and the serializer enumerates the
  // error's own keys. Dropping the body closes both.
  it('writes no upstream response body to the log', () => {
    handle(refusedSigningError());

    expect(emittedLogText()).not.toContain('errorBody');
    expect(emittedLogText()).not.toContain('error_body":"{');
  });
});

describe('apiErrorHandler — errors that set no client message', () => {
  // The fallback the rest of the app relies on. `toResponse` serving `clientMessage` must not
  // change what any error that never sets one puts on the wire.
  it('answers with `message`, exactly as before', () => {
    const { res } = handle(new MicroserviceError('Upstream is unavailable', 503, 'SERVICE_UNAVAILABLE', { operation: 'op', service: 'svc' }));

    expect(res.statusCode).toBe(503);
    expect(res.body?.['error']).toBe('Upstream is unavailable');
  });

  // A 403 the CLA service refused without a usable body: there is nothing to relay, so the
  // generic sentence is both logged and shown. Proves the relay is not silently swallowing text.
  it('shows the generic sentence when the refusal carried no message to relay', () => {
    const bare = new MicroserviceError(GENERIC, 403, 'FORBIDDEN', { operation: 'op', service: 'easycla', errorBody: '<html>gateway</html>' });
    const { res } = handle(withoutUpstreamBody(withProducerRefusalMessage(bare, 'op', 'easycla')));

    expect(res.body?.['error']).toBe(GENERIC);
  });
});
