// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import type { FormationSubStage } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { validateItemKeyParameter, validateUidParameter } from '../helpers/validation.helper';
import { formationService } from '../services/formation.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { AuthenticationError } from '../errors';

export const getProjectFormation = async (req: Request, res: Response, next: NextFunction) => {
  const { slug } = req.params;
  const startTime = logger.startOperation(req, 'get_project_formation', { slug });

  try {
    const result = await formationService.getProjectFormation(req, slug);
    logger.success(req, 'get_project_formation', startTime, { slug, item_count: result.items.length });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const getFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'get_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'get_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'get_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.getFormationItemDetail(req, projectUid, itemKey);
    logger.success(req, 'get_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * `gate_writer` is enforced inside `formationService.completeFormationItem` (`assertCanComplete`),
 * not a route-level middleware — unlike `requireAuditor`, the gate depends on `item.is_gating`,
 * which must be fetched before a decision can be made. It throws `AuthorizationError`, which
 * propagates to `next(error)` below like any other service error.
 */
export const completeFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'complete_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'complete_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'complete_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.completeFormationItem(req, projectUid, itemKey, req.body?.notes);
    logger.success(req, 'complete_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const skipFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'skip_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'skip_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'skip_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.skipFormationItem(req, projectUid, itemKey, req.body?.reason);
    logger.success(req, 'skip_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const requestFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'request_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'request_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'request_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.requestFormationItem(req, projectUid, itemKey);
    logger.success(req, 'request_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const updateFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'update_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'update_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'update_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.updateFormationItem(req, projectUid, itemKey, req.body ?? {});
    logger.success(req, 'update_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Handles the three "plain" status-chip transitions (not_started/in_progress/blocked) — the row's
 * status menu (GH-1958 finding #2). Completion and skip keep their own dedicated endpoints above.
 */
export const updateFormationItemStatus = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'update_formation_item_status', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'update_formation_item_status' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'update_formation_item_status' })) {
    return;
  }

  try {
    const result = await formationService.updateFormationItemStatus(req, projectUid, itemKey, req.body?.status, req.body?.note);
    logger.success(req, 'update_formation_item_status', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * New in GH-2267 Phase 2 — mirrors upstream's `accept`/`reject`/`reopen` actions (design.go items
 * 4-6). Fixture-era gating substitutes `gate_writer` for the real `team:formation` check; see
 * `formationService.acceptFormationItem`'s doc comment.
 */
export const acceptFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'accept_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'accept_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'accept_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.acceptFormationItem(req, projectUid, itemKey, req.body?.note);
    logger.success(req, 'accept_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const rejectFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'reject_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'reject_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'reject_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.rejectFormationItem(req, projectUid, itemKey, req.body?.note);
    logger.success(req, 'reject_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const reopenFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'reopen_formation_item', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'reopen_formation_item' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'reopen_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.reopenFormationItem(req, projectUid, itemKey, req.body?.note);
    logger.success(req, 'reopen_formation_item', startTime, { projectUid, itemKey });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

function parseSubStage(value: unknown): FormationSubStage | undefined {
  return typeof value === 'string' && (FORMATION_QUEUE_SUB_STAGES as string[]).includes(value) ? (value as FormationSubStage) : undefined;
}

// This value is forwarded verbatim into the upstream `parent: project:<uid>` query-service param
// (see formation.service.ts), so unlike sub_stage/search it's guarded against whitespace/oversized
// junk reaching that call rather than just left as a lenient string passthrough.
const MAX_FOUNDATION_UID_LENGTH = 128;

function parseFoundationUid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FOUNDATION_UID_LENGTH || /\s/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export const getFormationsQueue = async (req: Request, res: Response, next: NextFunction) => {
  const subStage = parseSubStage(req.query['sub_stage']);
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
  const foundationUid = parseFoundationUid(req.query['foundation_uid']);
  const startTime = logger.startOperation(req, 'get_formations_queue', { subStage, search, foundation_uid: foundationUid });

  try {
    const result = await formationService.getFormationsQueue(req, subStage, search, foundationUid);
    logger.success(req, 'get_formations_queue', startTime, { row_count: result.rows.length });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * `GET /api/user/formation-work` (GH-1956, Me lens) — self-scoped, so no `requireAuditor` gate
 * unlike `getFormationsQueue`, which is LF-root auditor-gated and unusable for a partner's own view.
 */
export const getMyFormationWork = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_my_formation_work');

  try {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return next(new AuthenticationError('User authentication required', { operation: 'get_my_formation_work' }));
    }

    const result = await formationService.getMyFormationWork(req);
    res.set('Cache-Control', 'private, no-cache');
    logger.success(req, 'get_my_formation_work', startTime, { formation_count: result.formations.length, item_count: result.items.length });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
