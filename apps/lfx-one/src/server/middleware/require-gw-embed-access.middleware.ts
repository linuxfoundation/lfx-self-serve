// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { personaDetectionService } from '../utils/persona-helper';

const ED: PersonaType = 'executive-director';

const projectService = new ProjectService();

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
export async function requireGwEmbedAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
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
