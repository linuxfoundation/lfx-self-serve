// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { validateUidParameter } from '../helpers/validation.helper';
import { formationService } from '../services/formation.service';

/** HTTP methods that never mutate — the checklist's own item-detail GET stays reachable on a non-live formation. */
const NON_MUTATING_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Shared fail-closed gate (GH-2328) for every formation item-mutation route — registered once via
 * `router.use('/formations/:projectUid/items/:itemKey', requireLiveFormation)` in
 * `formations.route.ts`, ahead of all eight mutation routes, rather than duplicated per-controller.
 * `router.use`'s prefix match means a ninth mutation route added under this same path prefix is
 * gated automatically, with no per-route opt-in to forget.
 *
 * Skips `GET`/`HEAD`/`OPTIONS` — `getFormationItemDetail` must stay readable on a `completed`/
 * `frozen`/unrecognized-lifecycle formation; only state-changing verbs are denied.
 *
 * Delegates the actual lifecycle check to `FormationService.assertFormationMutable`, which reuses
 * `fetchLiveChecklistOrDenyNotFound`'s per-request cache — so this gate costs no upstream call beyond
 * the one the mutation's own `getFormationItemOrThrow` pre-read already makes. `assertFormationMutable`
 * throws `ConflictError('CHECKLIST_READ_ONLY')` (409) on anything but a live lifecycle; that error is
 * passed to `next()` unchanged so the central `apiErrorHandler` logs and serializes it like any other.
 */
export async function requireLiveFormation(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (NON_MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const { projectUid } = req.params;
  if (!validateUidParameter(projectUid, req, next, { operation: 'require_live_formation', service: 'formation_service' })) {
    return;
  }

  try {
    await formationService.assertFormationMutable(req, projectUid);
    next();
  } catch (error) {
    next(error);
  }
}
