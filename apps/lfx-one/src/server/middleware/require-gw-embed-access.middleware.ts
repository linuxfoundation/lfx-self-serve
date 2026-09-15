// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { ensureGwRequestId } from '../helpers/gw-api.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { personaDetectionService } from '../utils/persona-helper';

const ED: PersonaType = 'executive-director';

const projectService = new ProjectService();

/**
 * Lets a rejected caller finish sending, by reading and discarding whatever it still has.
 *
 * Node only pulls from the socket while something is reading the request stream. Nothing here
 * reads it — authorization deliberately runs before the body is touched — so a client mid-upload
 * would otherwise be stuck unable to complete its write.
 */
function drainRequestBody(req: Request): void {
  if (req.readableEnded || req.method === 'GET' || req.method === 'HEAD') {
    return;
  }
  // Guarded rather than called blind: this runs inside the try that produces the 403, so anything
  // thrown here is caught and the caller gets a 500 instead of the denial. A convenience that can
  // downgrade an authorization decision into a server error is not worth having unguarded.
  if (typeof req.resume === 'function') {
    req.resume();
  }
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
 * enumeration only runs for a caller neither of those admitted, keeping it off the hot path for
 * the personas that actually use the pilot.
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
    const summary = await projectService.getWriterSummary(req);
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
    drainRequestBody(req);

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
    next(error);
  }
}
