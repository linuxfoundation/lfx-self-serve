// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SURVEY_LINK_ALLOWLIST } from '@lfx-one/shared/constants';
import { SurveyStatus } from '@lfx-one/shared/enums';
import { CreateSurveyRequest, MySurveyResponse, QueryServiceResponse, Survey, SurveyResponseRecord } from '@lfx-one/shared/interfaces';
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
    // The response records carry denormalized survey-level fields so we can build
    // Survey objects directly without a secondary /surveys/{uid} fetch.
    // Respondents don't hold survey:{uid}:viewer, so that fetch would 403 for them.
    const responses = await fetchAllQueryResources<SurveyResponseRecord>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<SurveyResponseRecord>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'survey_response',
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    const validResponses = responses.filter((r) => !!r.survey_uid);

    if (validResponses.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_surveys', 'Found user survey responses', {
      response_count: validResponses.length,
    });

    // Build one Survey row per response record — one per survey × committee so the
    // user can act on (or take) each committee invitation independently.
    const surveys: Survey[] = [];
    for (const r of validResponses) {
      const isResponded = !!(r.response_datetime && r.response_datetime.trim() !== '');
      const surveyLink = r.survey_link ? validateAndSanitizeUrl(r.survey_link.trim(), SURVEY_LINK_ALLOWLIST) : undefined;

      const survey: Survey = {
        uid: r.survey_uid,
        response_uid: r.uid,
        survey_title: r.survey_title || '',
        survey_status: r.survey_status || '',
        // Keep null (not empty string) when absent so Angular's DatePipe doesn't choke.
        survey_cutoff_date: r.survey_cutoff_date || null,
        is_nps_survey: r.is_nps_survey ?? false,
        is_project_survey: r.is_project_survey ?? false,
        committees: r.committee_name
          ? [
              {
                committee_id: r.committee_id || '',
                committee_uid: r.committee_uid || '',
                committee_name: r.committee_name,
                project_id: r.project?.id || '',
                project_uid: r.project?.project_uid || '',
                project_name: r.project?.name || '',
                // Committee-scoped totals from this response record, not survey-wide aggregates.
                total_recipients: r.total_recipients ?? 0,
                total_responses: r.total_responses ?? 0,
                nps_value: 0,
                num_detractors: 0,
                num_passives: 0,
                num_promoters: 0,
              },
            ]
          : [],
        committee_category: r.committee_category || '',
        creator_name: r.creator_name || '',
        created_at: r.survey_created_at || '',
        last_modified_at: r.survey_last_modified_at || '',
        // Committee-scoped totals from this response record — not survey-wide aggregates; not surfaced in the Me lens.
        total_responses: r.total_responses ?? 0,
        total_recipients: r.total_recipients ?? 0,
        project_uid: r.project?.project_uid || '',
        ...(surveyLink && { survey_link: surveyLink }),
        ...(isResponded && { response_status: 'responded' }),
      };
      surveys.push(survey);
    }

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

    // Cast is safe: every row in sorted has project_uid set to a string in the loop above.
    // Survey.project_uid is typed as optional but enrichWithProjectData requires the field present.
    return this.projectService.enrichWithProjectData(req, sorted as (Survey & { project_uid: string })[]) as Promise<Survey[]>;
  }

  /**
   * Returns the current user's submitted response for a survey, or null if no response exists.
   * Used by the Me lens "View My Response" drawer. Queries type=survey_response filtered by
   * the user's email/username (via filters_or) and matches in-memory. When responseUid is
   * provided (Me lens one-row-per-committee), it is used to match the exact invitation record
   * so the correct survey_link is returned for the selected row. Falls back to matching by
   * survey_uid when responseUid is absent.
   * Only returns a record whose response_datetime is populated — invitation-only rows are
   * treated as "not yet responded" and return null.
   */
  public async getMyResponse(req: Request, surveyUid: string, responseUid?: string): Promise<MySurveyResponse | null> {
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

    // When responseUid is present (Me-lens one-row-per-committee), match only the
    // exact record — no fallback to survey_uid. A fallback would return a different
    // committee's response when the selected invitation hasn't been submitted yet,
    // causing the drawer to show the wrong state. The survey_uid cross-check
    // prevents a tampered query param from leaking another survey's response.
    const match = responseUid
      ? responses.find((r) => r?.uid === responseUid && r.survey_uid === surveyUid && r.response_datetime && r.response_datetime.trim() !== '')
      : responses.find((r) => r?.survey_uid === surveyUid && r.response_datetime && r.response_datetime.trim() !== '');
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
