// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SURVEY_LINK_ALLOWLIST } from '@lfx-one/shared/constants';
import { SurveyStatus } from '@lfx-one/shared/enums';
import { CreateSurveyRequest, MySurveyResponse, QueryServiceResponse, Survey } from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
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

    // Fetch surveys and the current user's survey_responses in parallel so the
    // join (used to stamp response_status='responded') does not add a sequential
    // round-trip. fetchRespondedSurveyUidsForUser returns an empty set when the
    // user cannot be identified or the lookup fails, so callers degrade gracefully.
    const [surveys, respondedSurveyUids] = await Promise.all([
      fetchAllQueryResources<Survey>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<Survey>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          ...params,
          ...(pageToken && { page_token: pageToken }),
        })
      ),
      this.fetchRespondedSurveyUidsForUser(req),
    ]);

    // Count the responded UIDs that intersect with this result set so the log
    // metric is meaningful — respondedSurveyUids covers all of the user's
    // responses (across committees/projects) and would otherwise be > final_count.
    let respondedInResult = 0;
    const enriched =
      respondedSurveyUids.size > 0
        ? surveys.map((s) => {
            if (s.uid && respondedSurveyUids.has(s.uid)) {
              respondedInResult++;
              return { ...s, response_status: 'responded' };
            }
            return s;
          })
        : surveys;

    logger.debug(req, 'get_surveys', 'Completed survey fetch', {
      final_count: enriched.length,
      responded_in_result: respondedInResult,
    });

    return enriched;
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

    // Query survey_response records using filters_or (OR logic on data fields).
    // response_datetime distinguishes invited-only (empty) from submitted (populated).
    const responses = await fetchAllQueryResources<{ survey_uid: string; survey_link?: string; response_datetime?: string }>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<{ survey_uid: string; survey_link?: string; response_datetime?: string }>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        {
          type: 'survey_response',
          filters_or: filtersOr,
          ...(pageToken && { page_token: pageToken }),
        }
      )
    );

    const surveyLinkMap = new Map<string, string>();
    const respondedSurveyUids = new Set<string>();
    for (const r of responses) {
      if (!r.survey_uid) continue;
      if (r.response_datetime && r.response_datetime.trim() !== '') {
        respondedSurveyUids.add(r.survey_uid);
      }
      if (r.survey_link && !surveyLinkMap.has(r.survey_uid)) {
        const validatedLink = validateAndSanitizeUrl(r.survey_link.trim(), SURVEY_LINK_ALLOWLIST);
        if (validatedLink) {
          surveyLinkMap.set(r.survey_uid, validatedLink);
        }
      }
    }

    // Extract unique survey UIDs
    const surveyUids = [...new Set(responses.filter((r) => r.survey_uid).map((r) => r.survey_uid))];

    if (surveyUids.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_surveys', 'Found user survey responses', {
      response_count: responses.length,
      unique_survey_count: surveyUids.length,
    });

    // Fetch survey details in parallel via the survey microservice, then stamp
    // response_status based on whether the user's survey_response row has a populated
    // response_datetime. The UI consumes response_status to open the per-user response
    // drawer on the Me lens and switch the action button to 'Update' (vs 'Take Survey')
    // while the survey is still open.
    // When the detail fetch fails (404 / transient upstream error), keep the row in
    // the list with a stub Survey built from the response record so the user can still
    // see they were invited — silently dropping invited surveys hides the user's history.
    const surveys = await Promise.all(
      surveyUids.map(async (uid) => {
        try {
          const survey = await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${uid}`, 'GET');
          if (survey && respondedSurveyUids.has(uid)) {
            return { ...survey, response_status: 'responded' };
          }
          return survey;
        } catch (error) {
          logger.warning(req, 'get_my_surveys', 'Survey detail unavailable — rendering stub', {
            survey_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          const stub: Survey = {
            uid,
            survey_title: 'Survey (details unavailable)',
            survey_status: 'closed',
            // null instead of '' so Angular's DatePipe doesn't choke on an
            // invalid empty-string input when the table renders the Due column.
            survey_cutoff_date: null,
            is_nps_survey: false,
            is_project_survey: false,
            committees: [],
            committee_category: '',
            total_responses: 0,
            total_recipients: 0,
            created_at: '',
            last_modified_at: '',
            creator_name: '',
          };
          if (respondedSurveyUids.has(uid)) stub.response_status = 'responded';
          return stub;
        }
      })
    );

    // Sort: effectively-open surveys first, then by cutoff date descending.
    // Use the shared helper so SENT-past-cutoff and uppercase API values are
    // classified the same way as the frontend pill counter. Precompute the
    // per-row sort keys so the comparator doesn't recompute status/Date on
    // every comparison.
    const decorated = surveys
      .filter((s): s is Survey => s !== null)
      .map((survey) => {
        const parsedCutoff = survey.survey_cutoff_date ? new Date(survey.survey_cutoff_date).getTime() : NaN;

        return {
          survey,
          openRank: getSurveyDisplayStatus(survey) === SurveyStatus.OPEN ? 0 : 1,
          // Sort is descending (newest cutoff first), so push invalid/missing
          // cutoffs to the end with a finite sentinel to keep ordering deterministic
          // (Infinity sentinels would make `a - b` return NaN when both sides are invalid).
          cutoff: Number.isNaN(parsedCutoff) ? Number.MIN_SAFE_INTEGER : parsedCutoff,
        };
      });

    const sorted = decorated
      .sort((a, b) => {
        if (a.openRank !== b.openRank) {
          return a.openRank - b.openRank;
        }
        return b.cutoff - a.cutoff;
      })
      .map((entry) => entry.survey);

    // Flatten project_uid from committees to top level for enrichment
    const withProjectUid = sorted.map((s) => {
      const projectUids = [...new Set((s.committees ?? []).map((c) => c.project_uid).filter(Boolean))];
      return {
        ...s,
        project_uid: projectUids.length === 1 ? projectUids[0] : '',
        survey_link: surveyLinkMap.get(s.uid),
      };
    });

    return this.projectService.enrichWithProjectData(req, withProjectUid);
  }

  /**
   * Returns the current user's submitted response for a survey, or null if no response exists.
   * Used by the Me lens "View My Response" drawer. Queries type=survey_response filtered by
   * the user's email/username (via filters_or) and matches survey_uid in-memory after the
   * query returns, since the index has no native survey_uid filter on this resource type.
   * Only returns a record whose response_datetime is populated — invitation-only rows are
   * treated as "not yet responded" and return null.
   */
  public async getMyResponse(req: Request, surveyUid: string): Promise<MySurveyResponse | null> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    if (!username && !email) return null;

    const filtersOr: string[] = [];
    if (email) filtersOr.push(`email:${email}`);
    if (username) filtersOr.push(`username:${username}`);

    const responses = await fetchAllQueryResources<MySurveyResponse>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MySurveyResponse>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'survey_response',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    const match = responses.find((r) => r?.survey_uid === surveyUid && r.response_datetime && r.response_datetime.trim() !== '');
    if (!match) return null;

    // Defense-in-depth: validate survey_link against the same allowlist getMySurveys uses
    // before propagating the URL to the UI. Drops the field if validation fails — the rest
    // of the payload (answers, nps_value, response_datetime) is still useful for the drawer.
    const sanitizedLink = match.survey_link ? validateAndSanitizeUrl(match.survey_link.trim(), SURVEY_LINK_ALLOWLIST) : undefined;
    return { ...match, survey_link: sanitizedLink ?? undefined };
  }

  /**
   * Returns the set of survey UIDs the current user has responded to. Queries
   * type=survey_response by username/email via filters_or and dedupes to a Set
   * of survey_uid values. Returns an empty Set when the user cannot be
   * identified or the query fails — callers treat this as "no responses known"
   * and surveys render as not-yet-responded (the safer default).
   */
  private async fetchRespondedSurveyUidsForUser(req: Request): Promise<Set<string>> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    if (!username && !email) {
      return new Set<string>();
    }

    const filtersOr: string[] = [];
    if (email) filtersOr.push(`email:${email}`);
    if (username) filtersOr.push(`username:${username}`);

    try {
      const responses = await fetchAllQueryResources<{ survey_uid?: string; response_datetime?: string }>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<{ survey_uid?: string; response_datetime?: string }>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'survey_response',
            filters_or: filtersOr,
            ...(pageToken && { page_token: pageToken }),
          }
        )
      );
      // A survey_response row exists when the user is invited; response_datetime is only
      // populated once they actually submit. Filter on the populated datetime so invitations
      // don't get misreported as responded.
      const uids = new Set<string>();
      for (const r of responses) {
        if (r.survey_uid && r.response_datetime && r.response_datetime.trim() !== '') {
          uids.add(r.survey_uid);
        }
      }
      return uids;
    } catch (err) {
      logger.warning(req, 'get_surveys', 'Failed to fetch user survey responses for response_status enrichment, returning empty set', {
        err,
      });
      return new Set<string>();
    }
  }
}
