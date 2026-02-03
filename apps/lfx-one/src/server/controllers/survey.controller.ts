// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { SurveyService } from '../services/survey.service';

/**
 * Controller for handling survey HTTP requests
 */
export class SurveyController {
  private surveyService: SurveyService = new SurveyService();

  /**
   * GET /surveys
   */
  public async getSurveys(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_surveys', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const surveys = await this.surveyService.getSurveys(req, req.query as Record<string, any>);

      logger.success(req, 'get_surveys', startTime, {
        survey_count: surveys.length,
      });

      res.json(surveys);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /surveys/:uid
   */
  public async getSurveyById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_survey_by_id', {
      survey_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_survey_by_id',
          service: 'survey_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      const survey = await this.surveyService.getSurveyById(req, uid);

      logger.success(req, 'get_survey_by_id', startTime, {
        survey_uid: uid,
        title: survey.survey_title,
      });

      res.json(survey);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /surveys/:uid
   */
  public async deleteSurvey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'delete_survey', {
      survey_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_survey',
          service: 'survey_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      await this.surveyService.deleteSurvey(req, uid);

      logger.success(req, 'delete_survey', startTime, {
        survey_uid: uid,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
