// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { isBffTransportFailure, isUpstreamAnswer } from './upstream-error.utils';

const res = (body: unknown, status = 503): HttpErrorResponse => new HttpErrorResponse({ status, error: body });

/**
 * THREE origins produce the same status, and only one of them may be quoted as the service's
 * decision. This suite exists because that was got wrong three times in a row on #1923, each
 * time by testing something that CORRELATES with the answer instead of the answer itself:
 * a code string, a syscall allowlist, then the absence of a transport marker.
 *
 * Each case below is a real shape observed while fixing those rounds.
 */
describe('isUpstreamAnswer', () => {
  it('accepts a response the service itself formed', () => {
    expect(isUpstreamAnswer(res({ upstreamCode: 'provider_unavailable' }))).toBe(true);
  });

  it.each([
    ['a BFF transport failure', { transport: true, code: 'ECONNRESET' }],
    // The case every previous attempt missed: it never reached the BFF, so it carries NEITHER a
    // transport marker nor an upstream body -- and `!transport` reads it as the service speaking.
    ['an ingress 503 that never reached the BFF', { code: 'SERVICE_UNAVAILABLE' }],
    ['a gateway JSON body', { message: 'Service Unavailable' }],
    ['a gateway HTML/empty body', null],
    ['an empty object', {}],
    ['a blank upstreamCode', { upstreamCode: '' }],
    ['a non-string upstreamCode', { upstreamCode: 503 }],
  ])('refuses %s', (_label, body) => {
    expect(isUpstreamAnswer(res(body))).toBe(false);
  });

  it('is not satisfied merely by a parsed body with a message', () => {
    // Gateways emit exactly this, which is why "did we parse something?" is not the test.
    expect(isUpstreamAnswer(res({ message: 'the keyword actions could not be applied' }))).toBe(false);
  });
});

describe('isBffTransportFailure', () => {
  it('identifies an error the BFF raised itself', () => {
    expect(isBffTransportFailure(res({ transport: true, code: 'ETIMEDOUT' }))).toBe(true);
  });

  it('is NOT the complement of isUpstreamAnswer', () => {
    // An ingress response is neither. Treating "not upstream" as "our transport" is the exact
    // conflation that put a gateway 503 into a disabled-feature branch.
    const ingress = res({ code: 'SERVICE_UNAVAILABLE' });
    expect(isUpstreamAnswer(ingress)).toBe(false);
    expect(isBffTransportFailure(ingress)).toBe(false);
  });
});
