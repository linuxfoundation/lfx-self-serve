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
   */
  public async getUserPersonas(req: Request, res: Response, next: NextFunction): Promise<void> {
    const enriched = req.query['enriched'] === 'true';
    const startTime = logger.startOperation(req, 'get_user_personas', { enriched });

    try {
      const result = enriched ? await personaEnrichmentService.getEnrichedPersonas(req) : await personaDetectionService.getPersonas(req);

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
