// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GenerateWeeklyBriefRequest, SaveWeeklyBriefRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { WeeklyBriefService } from '../services/weekly-brief.service';

/**
 * Narrow `req.body` to a SaveWeeklyBriefRequest, returning a ServiceValidationError
 * with a per-field reason when anything is missing or has the wrong type.
 * Without this, e.g. a string `revision` of "1" would cause `revision + 1`
 * to concatenate to "11" downstream.
 */
function validateSaveBriefBody(body: unknown): { ok: true; value: SaveWeeklyBriefRequest } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (!body || typeof body !== 'object') {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  if (typeof b['brief_text'] !== 'string') {
    fieldErrors['brief_text'] = 'brief_text is required and must be a string';
  }
  if (typeof b['revision'] !== 'number' || !Number.isFinite(b['revision'] as number)) {
    fieldErrors['revision'] = 'revision is required and must be a finite number';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: {
      brief_text: b['brief_text'] as string,
      revision: b['revision'] as number,
    },
  };
}

/**
 * Controller for the WG Weekly Brief endpoints.
 *
 * Upstream HTTP status codes (404 → empty-state via service, 429 throttle,
 * 409 revision conflict) are propagated through `next(error)` to the shared
 * apiErrorHandler, which renders the original `statusCode` from MicroserviceError.
 */
export class WeeklyBriefController {
  private weeklyBriefService: WeeklyBriefService = new WeeklyBriefService();

  /**
   * GET /committees/:committeeId/weekly-briefs/current
   */
  public async getCurrentBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'get_weekly_brief_current', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'get_weekly_brief_current',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      const result = await this.weeklyBriefService.getCurrentBrief(req, committeeId);

      logger.success(req, 'get_weekly_brief_current', startTime, {
        committee_id: committeeId,
        has_brief: !!result.brief,
        state: result.brief?.state,
        revision: result.brief?.revision,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/generate
   */
  public async generateBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const body: GenerateWeeklyBriefRequest = req.body || {};
    const startTime = logger.startOperation(req, 'generate_weekly_brief', {
      committee_id: committeeId,
      revision: body.revision,
      force: body.force,
      has_reason: !!body.reason,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'generate_weekly_brief',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      const result = await this.weeklyBriefService.generateBrief(req, committeeId, body);

      logger.success(req, 'generate_weekly_brief', startTime, {
        committee_id: committeeId,
        brief_uid: result.brief.uid,
        revision: result.brief.revision,
        regeneration_count: result.brief.regeneration_count,
        generates_used: result.throttle.generates_used,
        regenerations_used: result.throttle.regenerations_used,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /committees/:committeeId/weekly-briefs/current
   */
  public async saveBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'save_weekly_brief', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'save_weekly_brief',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      const validation = validateSaveBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid save-weekly-brief request body', {
            operation: 'save_weekly_brief',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }
      const body = validation.value;

      const result = await this.weeklyBriefService.saveBrief(req, committeeId, body);

      logger.success(req, 'save_weekly_brief', startTime, {
        committee_id: committeeId,
        brief_uid: result.uid,
        revision: result.revision,
        state: result.state,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
