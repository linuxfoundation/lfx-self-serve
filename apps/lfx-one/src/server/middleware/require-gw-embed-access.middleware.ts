// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_WRITER_SUMMARY_CACHE_TTL_MS, GW_WRITER_SUMMARY_SWEEP_MS } from '@lfx-one/shared/constants';
import type { PersonaType, WriterSummary } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { drainRequestBody, ensureGwRequestId } from '../helpers/gw-api.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveEmail, getEffectiveUsername, hasActiveImpersonationSession } from '../utils/auth-helper';
import { personaDetectionService } from '../utils/persona-helper';

const ED: PersonaType = 'executive-director';

const projectService = new ProjectService();

/**
 * Per-user cache for the writer-summary fallback, mirroring `PersonaDetectionService`'s
 * `personasCache`: same TTL, same store-the-Promise-before-awaiting so concurrent callers share
 * one round trip, same eviction of failures so a blip is not pinned for the whole window.
 *
 * Needed because `/api/gw/*` is not a page-load endpoint. The embed's newsletter and media screens
 * issue many proxied calls each, and `getWriterSummary` fully paginates the caller's direct grants
 * through the query service and then batch access-checks every one of them — its own docstring
 * says it "always fully paginates and access-checks every direct grant", with no short-circuit.
 * Uncached, a plain writer paid that entire sweep on every single proxied request.
 *
 * The ED/root fast paths above are already cheap for exactly this reason (`getPersonas` caches),
 * and the ordering comment claims the enumeration is kept "off the hot path for the personas that
 * actually use the pilot" — which only held if every pilot user were an ED or root writer. Both
 * this middleware and `newsletterAccessGuard` deliberately admit plain writers, so it did not.
 *
 * A `WeakMap<Request, …>` would not help: every proxied call is a distinct Express request.
 */
const writerSummaryCache = new Map<string, { promise: Promise<WriterSummary>; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of writerSummaryCache) {
    if (now >= entry.expiresAt) {
      writerSummaryCache.delete(key);
    }
  }
}, GW_WRITER_SUMMARY_SWEEP_MS).unref();

/**
 * Resolves the caller's writer summary, sharing one lookup per user for a short window.
 *
 * Falls through to an uncached lookup when the request carries no stable identifier, the same way
 * `getPersonaDetections` does — caching under an empty key would serve one caller's grants to
 * another.
 */
async function getCachedWriterSummary(req: Request): Promise<WriterSummary> {
  // Namespaced by identity KIND. Username and email are different identifier spaces drawn from the
  // same map, so an unprefixed key lets one caller's username collide with another's email address
  // — and the colliding party would then be admitted or denied on someone else's grants for the
  // whole TTL. Unlikely, but this is an authorization cache: the cost of the prefix is two
  // characters and the cost of the collision is a wrong access decision.
  const username = getEffectiveUsername(req);
  const email = getEffectiveEmail(req);
  let cacheKey = '';
  if (username) {
    cacheKey = `u:${username}`;
  } else if (email) {
    cacheKey = `e:${email}`;
  }

  if (!cacheKey) {
    return projectService.getWriterSummary(req);
  }

  const cached = writerSummaryCache.get(cacheKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached.promise;
    }
    writerSummaryCache.delete(cacheKey);
  }

  // Stored before the await so concurrent proxied calls share the one sweep.
  const promise = projectService.getWriterSummary(req);
  writerSummaryCache.set(cacheKey, { promise, expiresAt: Date.now() + GW_WRITER_SUMMARY_CACHE_TTL_MS });

  // Evict a failed lookup so the next caller retries rather than being denied for the full TTL.
  promise.catch(() => writerSummaryCache.delete(cacheKey));

  return promise;
}

/**
 * Authorization for the `/api/gw/*` embed proxy.
 *
 * Exists because the BFF was strictly weaker than the UI it serves. Both Angular mounts are gated
 * by `newsletterAccessGuard` — ED persona, or writer on the route's foundation/project — while the
 * proxy admitted any authenticated LFX caller. A Contributor with no project role could relay
 * arbitrary methods, paths and bodies up to the proxy's 100MB ceiling to `GW_API_URL` through
 * LFX's server identity and network position. Gatewaze authenticates the caller's own Supabase
 * bearer, so this conferred no extra *data* access; what it conferred was reachability, which
 * matters while `GW_API_URL` is cluster-internal.
 *
 * Mirrors `newsletterAccessGuard`'s predicate as closely as the route shape allows. The guard
 * checks writer on a NAMED project, taken from `:projectUid` or `?project=`. Proxied requests name
 * a Gatewaze path, not an LFX project, so there is nothing to scope against — the check here is
 * necessarily coarser: does this caller hold ED, root writer, or a writer grant on ANY
 * foundation/project. That closes the "no role at all" hole, which is the actual gap, without
 * pretending to a per-project precision the request cannot express.
 *
 * Ordering is deliberate. `isRootWriter` and the ED persona both come from the single
 * `getPersonas` call, so the common pilot cases cost one round trip. The writer-summary
 * enumeration only runs for a caller neither of those admitted.
 *
 * That ordering alone is not enough, though, and an earlier version of this comment claimed it
 * was — that the enumeration stayed "off the hot path for the personas that actually use the
 * pilot". It only reached callers who are neither root nor ED, but plain writers ARE pilot users
 * (this middleware and `newsletterAccessGuard` both admit them), and `/api/gw/*` is called many
 * times per screen, so those callers paid a full paginated grant sweep per request. Hence
 * `getCachedWriterSummary` above.
 */
export async function requireGwEmbedAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // The controller promises every response on this route carries a correlation id, and it now
    // terminates here for a denial — so this has to set it too, or a 403 is the one response on
    // the route a caller cannot quote back. Shared helper so both sides use ONE id per request;
    // minting here and again in the controller produced two, and the caller saw only the last.
    ensureGwRequestId(res);

    // Hand straight to the controller when the pilot is off or the caller has no bearer. The
    // controller answers both with a uniform 404, and that is the point: a 403 here would tell an
    // unauthorized prober that `/api/gw` exists and is merely disabled. Authorization is only
    // meaningful once the route is live for this caller anyway.
    if (!isServerFeatureEnabled(ServerFeatureFlag.GatewazeEmbedEnabled) || !req.bearerToken) {
      next();
      return;
    }

    // Refuse while impersonating. This route's two identities diverge: the authorization below
    // resolves the IMPERSONATED target from `req.bearerToken`, while the controller forwards the
    // browser's own Gatewaze/Supabase `Authorization` header, which belongs to whoever signed in
    // to Gatewaze — the real user. A write would then execute and be audited as the impersonator
    // while every LFX-side check said it was the target.
    //
    // The outlet also declines to mount while impersonating, but that is a convenience: it runs in
    // the browser and a direct call bypasses it. This is the boundary.
    //
    // A 403 rather than the uniform 404, deliberately: the caller is an authenticated LFX admin
    // who can already see the route exists, so there is nothing to conceal here, and a 404 would
    // read as "the pilot is off" and send them to debug the wrong thing.
    if (hasActiveImpersonationSession(req)) {
      logger.debug(req, 'require_gw_embed_access', 'Refusing embed proxy access during impersonation', { path: req.path });
      await drainRequestBody(req);
      next(
        new AuthorizationError('The embedded admin module is unavailable while impersonating another user', {
          operation: 'require_gw_embed_access',
          service: 'authorization',
          path: req.path,
          code: 'GW_EMBED_IMPERSONATION_BLOCKED',
        })
      );
      return;
    }

    // `'none'` skips the marketing FGA probes: this route has no marketing relation to check, and
    // requesting them would add a ROOT probe ahead of the fast paths below.
    const result = await personaDetectionService.getPersonas(req, undefined, 'none');

    if (result.isRootWriter || result.personas.includes(ED)) {
      next();
      return;
    }

    // Reached only for a caller with neither root nor ED. `hasWriterFoundation` and
    // `hasWriterProject` are reduced from the caller's direct FGA grants, so either one means the
    // UI would have admitted them somewhere.
    const summary = await getCachedWriterSummary(req);
    if (summary.hasWriterFoundation || summary.hasWriterProject) {
      next();
      return;
    }

    // `apiErrorHandler` logs the rejection centrally (ADR 0002); this only carries the triage
    // detail that the generic error log cannot — which predicate failed.
    logger.debug(req, 'require_gw_embed_access', 'Denying embed proxy access', {
      path: req.path,
      personas: result.personas,
      has_writer_foundation: summary.hasWriterFoundation,
      has_writer_project: summary.hasWriterProject,
    });

    // The caller may already be streaming a body — this middleware runs before anything reads it,
    // which is the point. `apiErrorHandler` answers without touching the request stream, so
    // without this the client is left unable to finish writing and the connection hangs until
    // keep-alive: the same failure the controller's 413 path needed its drain protocol to avoid.
    //
    // Discarded rather than drained under a timeout, because the response goes out either way and
    // the bytes are thrown away as they arrive. The caller decides how long it keeps sending; we
    // are not holding the connection open for them.
    await drainRequestBody(req);

    next(
      new AuthorizationError('Newsletter access required for this resource', {
        operation: 'require_gw_embed_access',
        service: 'authorization',
        path: req.path,
        code: 'GW_EMBED_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    // Fail closed. An authorization check that cannot complete must not admit the caller — and
    // `next(error)` surfaces it as a 5xx through the shared pipeline rather than a silent pass.
    //
    // Drained for the same reason the 403 is: this rejects before anything reads the body, so a
    // caller uploading to `host-media` during an FGA blip would otherwise hang rather than see
    // the failure. Outside the try above, so its own guard is what keeps it from masking `error`.
    await drainRequestBody(req);
    next(error);
  }
}
