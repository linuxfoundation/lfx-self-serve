// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';

/**
 * Whether an error response was FORMED BY the upstream service, as opposed to happening to it.
 *
 * This exists because the same HTTP status arrives from three different origins, and only one of
 * them licenses a claim about what the service decided:
 *
 *  1. the service itself answered — the only origin that can say "this feature is off here",
 *     "this campaign is not yours", or anything else about application state;
 *  2. the BFF raised the error before or during transport — marked `transport: true` by
 *     BaseApiError.toResponse;
 *  3. an ingress or gateway answered instead, and the request never reached the BFF at all — so
 *     it carries NEITHER of the above markers.
 *
 * Case 3 is the one that keeps being missed, because the obvious tests all get it wrong:
 * `!transport` folds it in with case 1; a syscall-code allowlist never matches it (an ingress 503
 * maps to SERVICE_UNAVAILABLE, indistinguishable from a real one); and "is there a message?"
 * passes trivially, since gateways emit `{ message: 'Service Unavailable' }`.
 *
 * So this asks for POSITIVE proof instead: `upstreamCode` is populated only from the upstream
 * body's own `error` field (MicroserviceError.toResponse), so nothing about the shape of a
 * gateway or transport failure can satisfy it.
 *
 * USE THIS rather than testing a status alone. A bare `status === 503` check is a claim that the
 * service said something, and two thirds of the time it did not.
 */
export function isUpstreamAnswer(err: HttpErrorResponse | null | undefined): boolean {
  const code = (err?.error as { upstreamCode?: unknown } | null | undefined)?.upstreamCode;
  return typeof code === 'string' && code !== '';
}

/**
 * Whether the BFF raised this itself — a lost connection, a timeout, a parse failure.
 *
 * Distinct from `!isUpstreamAnswer(err)`: that is also true for an ingress response. Use this
 * only when the distinction between "our transport broke" and "something upstream broke" changes
 * what the user should do; otherwise treat both as "the request did not complete".
 */
export function isBffTransportFailure(err: HttpErrorResponse | null | undefined): boolean {
  return (err?.error as { transport?: unknown } | null | undefined)?.transport === true;
}

/**
 * Whether a 503 is the newsletter service saying scheduling is switched off in this environment.
 *
 * Extracted so the decision can be pinned without standing up NewsletterManageComponent's full
 * DI graph -- the branch it drives had no test at any level (dealako, round 4), and it is the one
 * that tells an operator to Send now, which sends immediately a newsletter they had deliberately
 * scheduled for later.
 *
 * THREE conditions, and each excludes a different impostor:
 *   - status 503 at all;
 *   - the newsletter service formed the response (isUpstreamAnswer) -- an ingress or gateway 503
 *     carries no upstreamCode and is not the service speaking;
 *   - the reason is `provider_unavailable` specifically -- the service can also answer 503
 *     because a dependency of ITS own is briefly down, which is transient, not a disabled
 *     feature.
 */
export function isSchedulingDisabledReply(err: HttpErrorResponse | null | undefined): boolean {
  if (err?.status !== 503 || !isUpstreamAnswer(err)) {
    return false;
  }
  return (err.error as { upstreamCode?: unknown } | null | undefined)?.upstreamCode === 'provider_unavailable';
}
