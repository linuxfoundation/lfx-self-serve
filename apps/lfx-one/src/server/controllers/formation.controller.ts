// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import type { FormationSubStage } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { parseIfMatch } from '../helpers/if-match.helper';
import { validateFoundationUidParameter, validateItemKeyParameter, validateUidParameter } from '../helpers/validation.helper';
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
 * `PATCH /formations/:projectUid/items/:itemKey` — note/evidence_link (GH-2576 Phase 2). Requires
 * `If-Match`; no BFF-side write-access check — see `formationService.updateFormationItem`'s doc
 * comment for the guard-tier audit this corrects. Returns `{item, etag}` and also sets the `ETag`
 * response header, so a caller holding either already holds the version for its next write.
 */
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
    const ifMatch = parseIfMatch(req, 'update_formation_item');
    const { item, etag } = await formationService.updateFormationItem(req, projectUid, itemKey, ifMatch, req.body ?? {});
    if (etag) res.set('ETag', etag);
    logger.success(req, 'update_formation_item', startTime, { projectUid, itemKey });
    return res.json({ item, etag });
  } catch (error) {
    return next(error);
  }
};

/**
 * `POST /formations/:projectUid/items/:itemKey/assignment` — assignee/due_date (GH-2576 Phase 2,
 * new route). Requires `If-Match`. `assignee_not_on_project` (#2594) passes through unvalidated.
 */
export const updateFormationItemAssignment = async (req: Request, res: Response, next: NextFunction) => {
  const { projectUid, itemKey } = req.params;
  const startTime = logger.startOperation(req, 'update_formation_item_assignment', { projectUid, itemKey });

  if (!validateUidParameter(projectUid, req, next, { operation: 'update_formation_item_assignment' })) {
    return;
  }
  if (!validateItemKeyParameter(itemKey, req, next, { operation: 'update_formation_item_assignment' })) {
    return;
  }

  try {
    const ifMatch = parseIfMatch(req, 'update_formation_item_assignment');
    const { item, etag } = await formationService.updateFormationItemAssignment(req, projectUid, itemKey, ifMatch, req.body ?? {});
    if (etag) res.set('ETag', etag);
    logger.success(req, 'update_formation_item_assignment', startTime, { projectUid, itemKey });
    return res.json({ item, etag });
  } catch (error) {
    return next(error);
  }
};

/**
 * `POST /formations/:projectUid/items/:itemKey/status` — status/reason/sub_items (GH-2576 Phase 2).
 * Requires `If-Match`. The rule that stops an assignee closing their own item is enforced entirely
 * by the API gateway (`writer_guard` + `member` on `team:formation`); nothing here re-checks it.
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
    const ifMatch = parseIfMatch(req, 'update_formation_item_status');
    const { item, etag } = await formationService.updateFormationItemStatus(req, projectUid, itemKey, ifMatch, req.body ?? {});
    if (etag) res.set('ETag', etag);
    logger.success(req, 'update_formation_item_status', startTime, { projectUid, itemKey });
    return res.json({ item, etag });
  } catch (error) {
    return next(error);
  }
};

function parseSubStage(value: unknown): FormationSubStage | undefined {
  return typeof value === 'string' && (FORMATION_QUEUE_SUB_STAGES as string[]).includes(value) ? (value as FormationSubStage) : undefined;
}

export const getFormationsQueue = async (req: Request, res: Response, next: NextFunction) => {
  const subStage = parseSubStage(req.query['sub_stage']);
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
  const foundationUidParam = req.query['foundation_uid'];
  if (!validateFoundationUidParameter(foundationUidParam, req, next, { operation: 'get_formations_queue' })) {
    return;
  }
  const foundationUid = foundationUidParam;
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

    const result = await formationService.getMyFormationWork(req, username);
    res.set('Cache-Control', 'private, no-cache');
    logger.success(req, 'get_my_formation_work', startTime, { formation_count: result.formations.length, item_count: result.items.length });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
