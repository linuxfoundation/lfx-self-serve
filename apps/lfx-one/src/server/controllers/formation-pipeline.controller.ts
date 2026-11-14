// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_PIPELINE_SEARCH_MAX_LENGTH, FORMATION_PIPELINE_STAGES } from '@lfx-one/shared/constants';
import type { FormationPipelineStage } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { validateFoundationUidParameter } from '../helpers/validation.helper';
import { formationPipelineService } from '../services/formation-pipeline.service';
import { logger } from '../services/logger.service';

/**
 * `GET /api/formations/pipeline` (#5475) — every non-Active project by stage, for the formation team; LF staff get the same view
 * without Draft and Confidential projects (#5544). Guarded by `team:formation` / `team:lf-staff` membership inside the service
 * (before any upstream read), not by `requireAuditor`. `stage` repeats;
 * absent, it is every pipeline stage.
 */
export const getFormationPipeline = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'get_formation_pipeline';
  const requested: unknown[] = [req.query['stage'] ?? []].flat();
  const unknownStage = requested.find((stage) => typeof stage !== 'string' || !(FORMATION_PIPELINE_STAGES as readonly string[]).includes(stage));
  if (unknownStage !== undefined) {
    return next(ServiceValidationError.forField('stage', 'stage must be a pipeline stage', { operation, service: 'controller', path: req.path }));
  }
  const foundationUid = req.query['foundation_uid'];
  if (!validateFoundationUidParameter(foundationUid, req, next, { operation })) {
    return;
  }
  const rawSearch = req.query['q'];
  if (rawSearch !== undefined && (typeof rawSearch !== 'string' || rawSearch.length > FORMATION_PIPELINE_SEARCH_MAX_LENGTH)) {
    return next(
      ServiceValidationError.forField('q', `q must be a string of at most ${FORMATION_PIPELINE_SEARCH_MAX_LENGTH} characters`, {
        operation,
        service: 'controller',
        path: req.path,
      })
    );
  }

  const stages = requested.length ? (requested as FormationPipelineStage[]) : [...FORMATION_PIPELINE_STAGES];
  const startTime = logger.startOperation(req, operation, { stages, foundation_uid: foundationUid, has_search: !!rawSearch });

  try {
    const result = await formationPipelineService.getPipeline(req, { stages, foundationUid, search: rawSearch?.trim() || undefined });
    res.set('Cache-Control', 'private, no-store');
    logger.success(req, operation, startTime, { row_count: result.rows.length, total: result.counts.total, viewer: result.viewer });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
