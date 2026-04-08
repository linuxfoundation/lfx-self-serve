// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { personaDetectionService } from '../utils/persona-helper';

/**
 * Controller for handling persona detection HTTP requests
 */
export class PersonaController {
  /**
   * GET /api/user/personas - Get personas for the authenticated user
   */
  public async getUserPersonas(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_personas');

    try {
      const result = await personaDetectionService.getPersonas(req);

      logger.success(req, 'get_user_personas', startTime, {
        persona_count: result.personas.length,
        project_count: result.projects.length,
        personas: result.personas,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
