// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceResponse, Survey } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling survey business logic with microservice proxy
 */
export class SurveyService {
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
  }

  /**
   * Fetches all surveys based on query parameters
   * Uses query service which returns Survey entities
   */
  public async getSurveys(req: Request, query: Record<string, any> = {}): Promise<Survey[]> {
    logger.debug(req, 'get_surveys', 'Starting survey fetch', {
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: 'survey',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    logger.debug(req, 'get_surveys', 'Fetched resources from query service', {
      count: resources.length,
    });

    const surveys: Survey[] = resources.map((resource) => resource.data);

    logger.debug(req, 'get_surveys', 'Completed survey fetch', {
      final_count: surveys.length,
    });

    return surveys;
  }

  /**
   * Fetches a single survey by UID
   */
  public async getSurveyById(req: Request, surveyUid: string): Promise<Survey> {
    logger.debug(req, 'get_survey_by_id', 'Fetching survey by ID', {
      survey_uid: surveyUid,
    });

    const survey = await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, 'GET');

    if (!survey || !survey.id) {
      throw new ResourceNotFoundError('Survey', surveyUid, {
        operation: 'get_survey_by_id',
        service: 'survey_service',
        path: `/surveys/${surveyUid}`,
      });
    }

    logger.debug(req, 'get_survey_by_id', 'Completed survey fetch', {
      survey_uid: surveyUid,
    });

    return survey;
  }

  /**
   * Deletes a survey using ETag for concurrency control
   */
  public async deleteSurvey(req: Request, surveyUid: string): Promise<void> {
    logger.debug(req, 'delete_survey', 'Deleting survey with ETag', {
      survey_uid: surveyUid,
    });

    // Step 1: Fetch survey with ETag
    const { etag } = await this.etagService.fetchWithETag<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, 'delete_survey');

    logger.debug(req, 'delete_survey', 'Fetched ETag for deletion', {
      survey_uid: surveyUid,
    });

    // Step 2: Delete survey with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, etag, 'delete_survey');
  }
}
