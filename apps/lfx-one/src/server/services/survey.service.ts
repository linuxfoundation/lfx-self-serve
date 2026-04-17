// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateSurveyRequest, QueryServiceResponse, Survey } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
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

    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'survey',
    };

    const surveys = await fetchAllQueryResources<Survey>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

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

  // ============================================
  // My Surveys (Me Lens)
  // ============================================

  /**
   * Fetches surveys the current user has responded to.
   * Queries survey_response records by email and username using filters_or.
   */
  public async getMySurveys(req: Request): Promise<Survey[]> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    logger.debug(req, 'get_my_surveys', 'Fetching surveys for current user', {
      username,
      has_email: !!email,
    });

    if (!username && !email) {
      return [];
    }

    // Build filters_or array for email and/or username
    const filtersOr: string[] = [];
    if (email) {
      filtersOr.push(`email:${email}`);
    }
    if (username) {
      filtersOr.push(`username:${username}`);
    }

    // Query survey_response records using filters_or (OR logic on data fields)
    const responses = await fetchAllQueryResources<{ survey_uid: string }>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<{ survey_uid: string }>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'survey_response',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Extract unique survey UIDs
    const surveyUids = [...new Set(responses.filter((r) => r.survey_uid).map((r) => r.survey_uid))];

    if (surveyUids.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_surveys', 'Found user survey responses', {
      response_count: responses.length,
      unique_survey_count: surveyUids.length,
    });

    // Fetch survey details in parallel via the survey microservice
    const surveys = await Promise.all(
      surveyUids.map(async (uid) => {
        try {
          return await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${uid}`, 'GET');
        } catch (error) {
          logger.warning(req, 'get_my_surveys', 'Failed to fetch survey details, skipping', {
            survey_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      })
    );

    // Sort: open/sent surveys first, then by cutoff date descending
    const openStatuses = new Set(['open', 'sent']);
    const sorted = surveys
      .filter((s): s is Survey => s !== null)
      .sort((a, b) => {
        const aOpen = openStatuses.has(a.survey_status) ? 0 : 1;
        const bOpen = openStatuses.has(b.survey_status) ? 0 : 1;
        if (aOpen !== bOpen) {
          return aOpen - bOpen;
        }
        return new Date(b.survey_cutoff_date).getTime() - new Date(a.survey_cutoff_date).getTime();
      });

    // Flatten project_uid from committees to top level for enrichment
    const withProjectUid = sorted.map((s) => {
      const projectUids = [...new Set((s.committees ?? []).map((c) => c.project_uid).filter(Boolean))];
      return {
        ...s,
        project_uid: projectUids.length === 1 ? projectUids[0] : '',
      };
    });

    return this.projectService.enrichWithProjectData(req, withProjectUid);
  }
}
