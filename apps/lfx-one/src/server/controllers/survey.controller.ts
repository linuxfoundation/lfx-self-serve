// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SURVEY_REMINDER_MAX_RECIPIENTS } from '@lfx-one/shared/constants';
import { CreateSurveyRequest, SendSurveyRemindersRequest } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { validateArrayParameter, validateRequestBody, validateRequiredParameter, validateUidParameter } from '../helpers/validation.helper';
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
    const startTime = logger.startOperation(req, 'get_my_surveys');

    try {
      const mySurveys = await this.surveyService.getMySurveys(req);

      logger.success(req, 'get_my_surveys', startTime, {
        survey_count: mySurveys.length,
      });

      res.json(mySurveys);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /surveys/:uid/my-response — returns the current user's submitted response, or 404 if none.
   */
  public async getMyResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyUid = req.params['uid'];
    const rawResponseUid = typeof req.query['response_uid'] === 'string' ? req.query['response_uid'].trim() : undefined;
    const responseUid = rawResponseUid !== '' ? rawResponseUid : undefined;
    const startTime = logger.startOperation(req, 'get_my_response', { survey_uid: surveyUid });

    try {
      const validationContext = { operation: 'get_my_response', service: 'survey_controller' };
      if (!validateUidParameter(surveyUid, req, next, validationContext)) return;

      const response = await this.surveyService.getMyResponse(req, surveyUid, responseUid);

      if (!response) {
        // Throw ResourceNotFoundError so apiErrorHandler emits a structured
        // 404 with request_id correlation and consistent error logging,
        // matching the pattern used elsewhere (e.g. public-meeting.controller).
        return next(
          new ResourceNotFoundError('Survey response', surveyUid, {
            operation: 'get_my_response',
            service: 'survey_controller',
            path: `/surveys/${surveyUid}/my-response`,
          })
        );
      }

      logger.success(req, 'get_my_response', startTime, { survey_uid: surveyUid });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /surveys/:uid/responses — paginated list of individual per-recipient responses.
   * Forwards page_token / per_page / project_uid(s) to the upstream survey service.
   */
  public async getSurveyResponses(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyUid = req.params['uid'];
    const startTime = logger.startOperation(req, 'get_survey_responses', {
      survey_uid: surveyUid,
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      if (
        !validateUidParameter(surveyUid, req, next, {
          operation: 'get_survey_responses',
          service: 'survey_controller',
        })
      ) {
        return;
      }

      // surveyUid is interpolated directly into the upstream request path — reject anything
      // that isn't a UUID before it reaches the proxy layer (linuxfoundation/lfx-self-serve-ops#436).
      if (!isUuid(surveyUid)) {
        next(
          ServiceValidationError.forField('uid', 'Survey uid must be a valid UUID', {
            operation: 'get_survey_responses',
            service: 'survey_controller',
            path: req.path,
          })
        );
        return;
      }

      const page = await this.surveyService.getSurveyResponses(req, surveyUid, req.query as Record<string, any>);

      logger.success(req, 'get_survey_responses', startTime, {
        survey_uid: surveyUid,
        response_count: page.data.length,
      });

      res.json(page);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /surveys/:uid/reminders — resends the survey email to the selected response rows (#4340).
   */
  public async sendSurveyReminders(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyUid = req.params['uid'];
    const payload: SendSurveyRemindersRequest = req.body;
    const startTime = logger.startOperation(req, 'send_survey_reminders', {
      survey_uid: surveyUid,
      recipient_count: Array.isArray(payload?.recipient_ids) ? payload.recipient_ids.length : undefined,
    });

    try {
      const context = { operation: 'send_survey_reminders', service: 'survey_controller', path: req.path } as const;
      if (!this.validateSurveyUid(surveyUid, req, next, context.operation)) return;
      if (!validateRequestBody(payload, req, next, context)) return;
      if (!validateArrayParameter(payload.recipient_ids, 'recipient_ids', req, next, context)) return;
      if (payload.recipient_ids.length > SURVEY_REMINDER_MAX_RECIPIENTS) {
        throw ServiceValidationError.forField('recipient_ids', `recipient_ids may name at most ${SURVEY_REMINDER_MAX_RECIPIENTS} recipients`, context);
      }
      if (payload.recipient_ids.some((id) => typeof id !== 'string' || !isUuid(id))) {
        throw ServiceValidationError.forField('recipient_ids', 'recipient_ids must contain only response UUIDs', context);
      }

      const result = await this.surveyService.sendSurveyReminders(req, surveyUid, [...new Set(payload.recipient_ids)]);

      logger.success(req, 'send_survey_reminders', startTime, { survey_uid: surveyUid, recipient_count: result.recipient_count });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /surveys/:uid/resync-preview — committee members a resync would add (#4340).
   */
  public async getResyncPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyUid = req.params['uid'];
    const startTime = logger.startOperation(req, 'get_survey_resync_preview', { survey_uid: surveyUid });

    try {
      if (!this.validateSurveyUid(surveyUid, req, next, 'get_survey_resync_preview')) return;
      const committeeUid = this.parseCommitteeUid(req, 'get_survey_resync_preview');

      const preview = await this.surveyService.getResyncPreview(req, surveyUid, committeeUid);

      logger.success(req, 'get_survey_resync_preview', startTime, {
        survey_uid: surveyUid,
        recipient_count: preview.affected_recipients.length,
      });
      res.json(preview);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /surveys/:uid/resync — sends the survey to committee members added since launch (#4340).
   */
  public async resyncRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
    const surveyUid = req.params['uid'];
    const startTime = logger.startOperation(req, 'resync_survey_recipients', { survey_uid: surveyUid });

    try {
      if (!this.validateSurveyUid(surveyUid, req, next, 'resync_survey_recipients')) return;
      const committeeUid = this.parseCommitteeUid(req, 'resync_survey_recipients');

      await this.surveyService.resyncRecipients(req, surveyUid, committeeUid);

      logger.success(req, 'resync_survey_recipients', startTime, { survey_uid: surveyUid, committee_uid: committeeUid });
      res.status(204).send();
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

      // uid is interpolated directly into the upstream request path — reject anything that
      // isn't a UUID before it reaches the proxy layer (linuxfoundation/lfx-self-serve-ops#436).
      if (!isUuid(uid)) {
        next(
          ServiceValidationError.forField('uid', 'Survey uid must be a valid UUID', {
            operation: 'get_survey_by_id',
            service: 'survey_controller',
            path: req.path,
          })
        );
        return;
      }

      const projectId = req.query['project_id'] as string | undefined;
      // includeProject: the edit page's context sync and the writerGuard entity probe need the
      // owning project's slug/tier on the detail payload (GH-1569).
      const survey = await this.surveyService.getSurveyById(req, uid, projectId, true);

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

      // uid is interpolated directly into the upstream request path — reject anything that
      // isn't a UUID before it reaches the proxy layer (linuxfoundation/lfx-self-serve-ops#436).
      if (!isUuid(uid)) {
        next(
          ServiceValidationError.forField('uid', 'Survey uid must be a valid UUID', {
            operation: 'delete_survey',
            service: 'survey_controller',
            path: req.path,
          })
        );
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

  /** surveyUid is interpolated into the upstream path — accept UUIDs only. */
  private validateSurveyUid(surveyUid: string | undefined, req: Request, next: NextFunction, operation: string): surveyUid is string {
    if (!validateUidParameter(surveyUid, req, next, { operation, service: 'survey_controller' })) {
      return false;
    }
    if (!isUuid(surveyUid as string)) {
      next(ServiceValidationError.forField('uid', 'Survey uid must be a valid UUID', { operation, service: 'survey_controller', path: req.path }));
      return false;
    }
    return true;
  }

  /** Optional `committee_uid` query param; must be a UUID when present. */
  private parseCommitteeUid(req: Request, operation: string): string | undefined {
    const value = req.query['committee_uid'];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !isUuid(value)) {
      throw ServiceValidationError.forField('committee_uid', 'committee_uid must be a valid UUID', { operation, service: 'survey_controller', path: req.path });
    }
    return value;
  }
}
