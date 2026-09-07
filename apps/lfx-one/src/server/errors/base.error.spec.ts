// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MicroserviceError } from './microservice.error';

/**
 * `transport: true` is the ONLY reliable way a browser can tell a BFF-raised failure from one the
 * upstream service deliberately returned, and something real turns on it: NewsletterManage reads
 * a bare 503 as "scheduling is disabled here — use Send now", which on a transient outage would
 * send a newsletter immediately that an operator had scheduled for later.
 *
 * The obvious alternative — matching syscall codes client-side — was tried and is wrong three
 * ways: an ingress 503 maps to SERVICE_UNAVAILABLE (identical to a deliberate reply), ETIMEDOUT
 * and EPIPE match no sensible pattern, and TIMEOUT ships as 408 so it never reaches a 503 branch.
 */
describe('BaseApiError.toResponse — the transport marker', () => {
  it('marks an error the BFF raised itself', () => {
    const err = new MicroserviceError('Request failed: fetch failed', 503, 'ECONNRESET', { originalError: new Error('fetch failed'), transportFailure: true });

    expect(err.toResponse()['transport']).toBe(true);
  });

  it('does NOT mark a 503 the upstream service deliberately returned', () => {
    // Same status, same shape, no originalError — this is the disabled-feature reply, and
    // reporting it as transport would suppress the message the operator needs.
    const err = new MicroserviceError('Scheduling is disabled', 503, 'SERVICE_UNAVAILABLE', {});

    expect(err.toResponse()['transport']).toBeUndefined();
  });

  it('does not leak the underlying error object', () => {
    // The FACT of a transport failure travels; its internals must not.
    const err = new MicroserviceError('Request failed', 503, 'ECONNRESET', {
      originalError: new Error('connect ECONNREFUSED 10.0.0.1:443'),
      transportFailure: true,
    });
    const body = JSON.stringify(err.toResponse());

    expect(body).not.toContain('10.0.0.1');
    expect(body).not.toContain('originalError');
  });

  it('does NOT mark a service fault that merely captured a caught error', () => {
    // Seven non-transport sites attach a caught error to `originalError` (committee-access,
    // org-lens x2, guild, snowflake x2, project). Deriving the marker from its presence marked
    // every one of their 5xx responses as a lost connection, so a client would have read a
    // genuine service fault as "our transport broke". The throwing site declares it now.
    const err = new MicroserviceError('Snowflake query failed', 500, 'INTERNAL_ERROR', { originalError: new Error('SQL compilation error') });

    expect(err.toResponse()['transport'], 'a service fault was marked as transport').toBeUndefined();
  });
});
