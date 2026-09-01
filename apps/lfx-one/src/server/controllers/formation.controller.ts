// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import type { FormationSubStage } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { validateUidParameter } from '../helpers/validation.helper';
import { formationItemAccessService } from '../services/formation-item-access.service';
import { formationService } from '../services/formation.service';
import { logger } from '../services/logger.service';

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
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'get_formation_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'get_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.getFormationItemDetail(req, uid);
    logger.success(req, 'get_formation_item', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * `gate_writer` is checked here (not a route-level middleware) — unlike `requireAuditor`, the
 * gate depends on `item.is_gating`, which must be fetched before a decision can be made.
 */
export const completeFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'complete_formation_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'complete_formation_item' })) {
    return;
  }

  try {
    const item = await formationService.getFormationItemOrThrow(req, uid);
    const canComplete = await formationItemAccessService.canComplete(req, item);
    if (!canComplete) {
      next(
        new AuthorizationError('gate_writer access required to complete this item', {
          operation: 'complete_formation_item',
          service: 'authorization',
          path: req.path,
          code: 'GATE_WRITER_REQUIRED',
        })
      );
      return;
    }

    const result = await formationService.completeFormationItem(req, uid, req.body?.notes);
    logger.success(req, 'complete_formation_item', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const skipFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'skip_formation_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'skip_formation_item' })) {
    return;
  }

  try {
    const item = await formationService.getFormationItemOrThrow(req, uid);
    const canComplete = await formationItemAccessService.canComplete(req, item);
    if (!canComplete) {
      next(
        new AuthorizationError('gate_writer access required to skip this item', {
          operation: 'skip_formation_item',
          service: 'authorization',
          path: req.path,
          code: 'GATE_WRITER_REQUIRED',
        })
      );
      return;
    }

    const result = await formationService.skipFormationItem(req, uid, req.body?.reason);
    logger.success(req, 'skip_formation_item', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const requestFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'request_formation_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'request_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.requestFormationItem(req, uid);
    logger.success(req, 'request_formation_item', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const updateFormationItem = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'update_formation_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'update_formation_item' })) {
    return;
  }

  try {
    const result = await formationService.updateFormationItem(req, uid, req.body ?? {});
    logger.success(req, 'update_formation_item', startTime, { uid });
    return res.json(result);
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
  const startTime = logger.startOperation(req, 'get_formations_queue', { subStage, search });

  try {
    const result = await formationService.getFormationsQueue(req, subStage, search);
    logger.success(req, 'get_formations_queue', startTime, { row_count: result.rows.length });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const acceptFormation = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'accept_formation', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'accept_formation' })) {
    return;
  }

  try {
    const result = await formationService.acceptFormation(req, uid);
    logger.success(req, 'accept_formation', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const declineFormation = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'decline_formation', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'decline_formation' })) {
    return;
  }

  try {
    const result = await formationService.declineFormation(req, uid, req.body?.reason);
    logger.success(req, 'decline_formation', startTime, { uid });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
