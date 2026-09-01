// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { parseFormationIntakeBody } from '../helpers/formation-validation.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { FormationService } from '../services/formation.service';
import { logger } from '../services/logger.service';

/** Controller for the fixture-backed "Propose a project" formation endpoints (GH-1962). */
export class FormationController {
  private formationService: FormationService = new FormationService();

  public async createFormation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_formation', {});

    try {
      const intake = parseFormationIntakeBody(req, 'create_formation');
      const formation = await this.formationService.createFormation(req, intake);

      logger.success(req, 'create_formation', startTime, { uid: formation.uid });
      res.status(201).json(formation);
    } catch (error) {
      // Do NOT call logger.error() here — apiErrorHandler logs centrally
      next(error);
    }
  }

  public async getFormationByUid(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_formation_by_uid', { uid });

    try {
      if (!validateUidParameter(uid, req, next, { operation: 'get_formation_by_uid', service: 'formation_controller' })) {
        return;
      }

      const formation = await this.formationService.getFormationByUid(req, uid);
      if (!formation) {
        res.status(404).json({ error: 'Formation not found' });
        return;
      }

      logger.success(req, 'get_formation_by_uid', startTime, { uid });
      res.json(formation);
    } catch (error) {
      // Do NOT call logger.error() here — apiErrorHandler logs centrally
      next(error);
    }
  }
}
