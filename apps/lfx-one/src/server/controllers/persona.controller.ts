// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { personaDetectionService, personaEnrichmentService } from '../utils/persona-helper';

/**
 * Controller for handling persona detection HTTP requests
 */
export class PersonaController {
  /**
   * GET /api/user/personas - Get personas for the authenticated user.
   * When `?enriched=true`, responds with projects enriched with name/logo/parent/description metadata.
   * `?project=<slug>` also folds a project-scoped marketing_auditor/campaign_manager grant for that
   * slug into the response, so a caller with only a per-project (not ROOT) grant is reflected too.
   */
  public async getUserPersonas(req: Request, res: Response, next: NextFunction): Promise<void> {
    const enriched = req.query['enriched'] === 'true';
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'] : undefined;
    const startTime = logger.startOperation(req, 'get_user_personas', { enriched, projectSlug });

    try {
      const result = enriched
        ? await personaEnrichmentService.getEnrichedPersonas(req, projectSlug)
        : await personaDetectionService.getPersonas(req, projectSlug);

      logger.success(req, 'get_user_personas', startTime, {
        persona_count: result.personas.length,
        project_count: result.projects.length,
        personas: result.personas,
        enriched,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
