// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateSurveyRequest, QueryServiceResponse, Survey } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling survey business logic with microservice proxy
 */
export class SurveyService {
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;
  private projectService: ProjectService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
    this.projectService = new ProjectService();
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
   * Resolves project UUID to v1 SFID via NATS before passing as project_id
   */
  public async getSurveyById(req: Request, surveyUid: string, projectId?: string): Promise<Survey> {
    logger.debug(req, 'get_survey_by_id', 'Fetching survey by ID', {
      survey_uid: surveyUid,
      project_id: projectId,
    });

    const params: Record<string, string> = {};

    if (projectId) {
      const sfid = await this.projectService.getProjectSfidByUid(req, projectId);
      if (sfid) {
        params['project_id'] = sfid;
      }
    }

    const survey = await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, 'GET', params);

    if (!survey || !survey.uid) {
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
   * Creates a new survey
   */
  public async createSurvey(req: Request, surveyData: CreateSurveyRequest): Promise<Survey> {
    // Enrich creator fields from the OIDC session (not expected from the frontend)
    const user = req.oidc?.user;
    const enrichedData: CreateSurveyRequest = {
      ...surveyData,
      creator_id: (user?.['sub'] as string) || '',
      creator_username: (user?.['nickname'] as string) || (user?.['name'] as string) || '',
      creator_name: (user?.['name'] as string) || '',
    };

    const sanitizedPayload = logger.sanitize({ surveyData: enrichedData });
    logger.debug(req, 'create_survey', 'Creating survey payload', sanitizedPayload);

    const newSurvey = await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', '/surveys', 'POST', undefined, enrichedData, {
      ['X-Sync']: 'true',
    });

    // After creating, poll the query service until the survey is indexed.
    // The query service uses eventual consistency, so the survey may not appear immediately.
    const surveyUid = newSurvey.uid;
    let fetchedSurvey: Survey | undefined;

    const resolved = await pollEndpoint({
      req,
      operation: 'create_survey',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'survey',
          tags: surveyUid,
        });
        if (resources.length > 0) {
          fetchedSurvey = resources[0].data;
          return true;
        }
        return false;
      },
      metadata: { survey_uid: surveyUid },
    });

    if (resolved && fetchedSurvey) {
      return fetchedSurvey;
    }

    logger.warning(req, 'create_survey', 'Survey not yet indexed in query service, returning POST response', { survey_uid: surveyUid });
    return newSurvey;
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
