// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateSurveyRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { validateRequiredParameter, validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { SurveyService } from '../services/survey.service';

/**
 * Controller for handling survey HTTP requests
 */
export class SurveyController {
  private surveyService: SurveyService = new SurveyService();

  /**
   * POST /surveys - create a new survey
   */
  public async createSurvey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyData: CreateSurveyRequest = req.body;
    const startTime = logger.startOperation(req, 'create_survey', {
      survey_title: surveyData?.survey_title,
      committee_uid: surveyData?.committee_uid,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      const validationContext = { operation: 'create_survey', service: 'survey_controller' };

      if (!validateRequiredParameter(surveyData?.survey_monkey_id, 'survey_monkey_id', req, next, validationContext)) return;
      if (!validateRequiredParameter(surveyData?.committee_uid, 'committee_uid', req, next, validationContext)) return;
      if (!validateRequiredParameter(surveyData?.survey_title, 'survey_title', req, next, validationContext)) return;

      const survey = await this.surveyService.createSurvey(req, surveyData);

      logger.success(req, 'create_survey', startTime, {
        survey_uid: survey.uid,
        title: survey.survey_title,
      });

      res.status(201).json(survey);
    } catch (error) {
      next(error);
    }
  }

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
   * GET /surveys/my-surveys
   */
  public async getMySurveys(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = req.query['project_uid'] as string | undefined;
    const foundationUid = req.query['foundation_uid'] as string | undefined;
    const startTime = logger.startOperation(req, 'get_my_surveys', {
      project_uid: projectUid,
      foundation_uid: foundationUid,
    });

    try {
      const mySurveys = await this.surveyService.getMySurveys(req, projectUid, foundationUid);

      logger.success(req, 'get_my_surveys', startTime, {
        survey_count: mySurveys.length,
        project_uid: projectUid,
        foundation_uid: foundationUid,
      });

      res.json(mySurveys);
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
        })
      ) {
        return;
      }

      const projectId = req.query['project_id'] as string | undefined;
      const survey = await this.surveyService.getSurveyById(req, uid, projectId);

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
