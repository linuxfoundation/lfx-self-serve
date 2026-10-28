// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACCESS_CHECK_BATCH_SIZE,
  SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS,
  SURVEY_LINK_ALLOWLIST,
  SURVEY_RESPONSES_MAX_PAGES,
  SURVEY_RESPONSES_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import { SurveyStatus } from '@lfx-one/shared/enums';
import {
  CreateSurveyRequest,
  MySurveyResponse,
  QueryServiceResponse,
  SendSurveyRemindersResult,
  Survey,
  SurveyResponseItem,
  SurveyResponseRecord,
  SurveyResponsesPage,
  SurveyResyncPreview,
} from '@lfx-one/shared/interfaces';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { fetchEntityProject, toEntityProjectFields } from '../helpers/entity-project-enrichment.helper';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { getEffectiveName, getEffectiveUsername, resolveUserIdentity } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
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
  private accessCheckService: AccessCheckService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
    this.projectService = new ProjectService();
    this.accessCheckService = new AccessCheckService();
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

    // Effective committee writer checks retain inherited grants. Keep one bounded batch
    // in flight, and use the caller's request identity with the lenient fail-closed API.
    const accessDeadlineAt = Date.now() + SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS;
    const accessRequestOptions = { deadlineAt: accessDeadlineAt };
    const committeeUids = [
      ...new Set(
        surveys
          .filter((survey) => getSurveyDisplayStatus(survey) === SurveyStatus.DRAFT)
          .flatMap((survey) => survey.committees?.map((committee) => committee.committee_uid) ?? [])
          .filter((uid) => uid?.trim())
      ),
    ];
    const writableCommitteeUids = new Set<string>();
    for (let start = 0; start < committeeUids.length; start += ACCESS_CHECK_BATCH_SIZE) {
      if (Date.now() >= accessDeadlineAt) break;
      const batch = committeeUids.slice(start, start + ACCESS_CHECK_BATCH_SIZE);
      const access = await this.accessCheckService.checkAccess(
        req,
        batch.map((id) => ({ resource: 'committee', id, access: 'writer' })),
        accessRequestOptions
      );
      for (const id of batch) {
        if (access.get(`${id}#writer`) === true) writableCommitteeUids.add(id);
      }
    }
    // Overwrite any indexed flag: grants are per caller, not survey metadata.
    const surveysWithAccess = surveys.map((survey) => ({
      ...survey,
      committee_writer:
        getSurveyDisplayStatus(survey) === SurveyStatus.DRAFT &&
        (survey.committees?.some((committee) => writableCommitteeUids.has(committee.committee_uid)) ?? false),
    }));

    // Count the responded UIDs that intersect with this result set so the log
    // metric is meaningful — respondedSurveyUids covers all of the user's
    // responses (across committees/projects) and would otherwise be > final_count.
    let respondedInResult = 0;
    const enriched =
      respondedSurveyUids.size > 0
        ? surveysWithAccess.map((s) => {
            if (s.uid && respondedSurveyUids.has(s.uid)) {
              respondedInResult++;
              return { ...s, response_status: 'responded' };
            }
            return s;
          })
        : surveysWithAccess;

    logger.debug(req, 'get_surveys', 'Completed survey fetch', {
      final_count: enriched.length,
      responded_in_result: respondedInResult,
    });

    // The survey index carries project identity only inside committees[] — flatten the primary
    // project uid and enrich so list rows expose project_slug/project_name/is_foundation for
    // per-row canonical edit links (GH-1569; mirrors the meetings list enrichment).
    const flattened = enriched.map((s) => ({
      ...s,
      project_uid: s.project_uid || s.committees?.[0]?.project_uid || '',
    }));
    return this.projectService.enrichWithProjectData(req, flattened) as Promise<Survey[]>;
  }

  /**
   * Fetches a single survey by UID.
   * Passes project_uid (V2 UUID) directly to upstream — no SFID translation needed.
   * `includeProject` opts into BFF project enrichment (project_slug/project_name/is_foundation)
   * for the edit page's context sync and the writerGuard entity probe (GH-1569); the shared
   * helper no-ops when the payload lacks project_uid and warn-and-continues on lookup failure.
   */
  public async getSurveyById(req: Request, surveyUid: string, projectId?: string, includeProject = false): Promise<Survey> {
    logger.debug(req, 'get_survey_by_id', 'Fetching survey by ID', {
      survey_uid: surveyUid,
      project_uid: projectId,
    });

    const params: Record<string, string> = {};

    if (projectId) {
      params['project_uid'] = projectId;
    }

    const survey = await this.microserviceProxy.proxyRequest<Survey>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, 'GET', params);

    if (!survey || !survey.uid) {
      throw new ResourceNotFoundError('Survey', surveyUid, {
        operation: 'get_survey_by_id',
        service: 'survey_service',
        path: `/surveys/${surveyUid}`,
      });
    }

    // The upstream detail payload (SurveyScheduleResult) carries project identity only inside
    // committees[] — flatten the primary project uid and stamp it top-level so the enrichment
    // below, the writerGuard probe, and the manage page's resolve-by-uid fallback all receive a
    // real uid (GH-1569; mirrors the list path's flatten in getSurveys).
    survey.project_uid = survey.project_uid || survey.committees?.[0]?.project_uid;

    if (includeProject) {
      const project = await fetchEntityProject(req, this.projectService, survey.project_uid, { operation: 'get_survey_by_id', survey_uid: survey.uid });
      if (project) {
        Object.assign(survey, toEntityProjectFields(project));
      }
    }

    logger.debug(req, 'get_survey_by_id', 'Completed survey fetch', {
      survey_uid: surveyUid,
    });

    return survey;
  }

  /**
   * Fetches a page of per-recipient responses from the upstream survey service,
   * forwarding only the supported query params (pagination + project scoping),
   * and gates each row's personal link on managing that row's committee.
   * The upstream maps V2 project UUIDs to V1 identifiers before forwarding to ITX.
   *
   * Upstream gates this list on `survey#viewer`, but each row's `survey_link` is the
   * recipient's personal link (anyone holding it can answer as them). A row keeps its
   * link only when the caller manages that row's committee (see getManagedCommitteeUids)
   * and the link passes SURVEY_LINK_ALLOWLIST; every other row, including on a failed
   * access check, is returned without one (#4340).
   */
  public async getSurveyResponses(req: Request, surveyUid: string, query: Record<string, any> = {}): Promise<SurveyResponsesPage> {
    logger.debug(req, 'get_survey_responses', 'Fetching survey responses', {
      survey_uid: surveyUid,
      query_params: Object.keys(query),
    });

    // Forward only the params the upstream endpoint supports; ignore anything else
    // the client may append so a stray param can't change upstream behavior.
    // per_page is capped at 200 to prevent accidental or abusive large-page requests.
    const params: Record<string, any> = {};
    if (query['page_token'] !== undefined) params['page_token'] = query['page_token'];
    if (query['per_page'] !== undefined) {
      const perPage = parseInt(query['per_page'], 10);
      if (!isNaN(perPage) && perPage > 0) params['per_page'] = Math.min(perPage, 200);
    }
    if (query['project_uid'] !== undefined) params['project_uid'] = query['project_uid'];
    if (query['project_uids'] !== undefined) params['project_uids'] = query['project_uids'];

    const [page, managedCommitteeUids] = await Promise.all([
      this.microserviceProxy.proxyRequest<SurveyResponsesPage>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}/responses`, 'GET', params),
      this.getManagedCommitteeUids(req, surveyUid).catch(() => new Set<string>()),
    ]);

    // Defensive normalization: upstream is contractually { data, meta }, but guard
    // against a malformed body so the frontend always receives a consumable shape.
    // Upstream signals the last page with an empty-string page_token — normalize it
    // to undefined here so consumers can treat "no more pages" as a falsy token.
    const pageToken = page?.meta?.page_token;
    const rows = Array.isArray(page?.data) ? page.data : [];
    return {
      data: rows.map(({ survey_link: surveyLink, ...row }) => {
        const canManage = !!row.committee_uid && managedCommitteeUids.has(row.committee_uid);
        const link = canManage && surveyLink ? validateAndSanitizeUrl(surveyLink.trim(), SURVEY_LINK_ALLOWLIST) : null;
        return link ? { ...row, survey_link: link } : row;
      }),
      meta: {
        ...(page?.meta ?? {}),
        page_token: pageToken && pageToken.trim() !== '' ? pageToken : undefined,
      },
    };
  }

  /**
   * The survey's committees whose project the caller can write (`project#writer_guard`, the
   * relation behind Manage access). Upstream grants `survey#writer` to a writer of ANY project
   * the survey was sent to, so on a multi-foundation board survey that grant alone would let
   * one foundation's ED reach every other foundation's recipients; this narrows it per committee.
   * Fails closed: a failed project check counts as not managed.
   */
  public async getManagedCommitteeUids(req: Request, surveyUid: string): Promise<Set<string>> {
    return (await this.getCommitteeAccess(req, surveyUid)).managed;
  }

  /**
   * Resends the survey email to the given response rows (`bulk_resend`). The gateway only checks
   * `survey#writer`, so every row must belong to a committee the caller manages (403 otherwise);
   * ITX rejects closed surveys.
   */
  public async sendSurveyReminders(req: Request, surveyUid: string, recipientIds: string[]): Promise<SendSurveyRemindersResult> {
    const [managed, rows] = await Promise.all([this.getManagedCommitteeUids(req, surveyUid), this.fetchAllResponseRows(req, surveyUid)]);
    const committeeByRow = new Map(rows.map((r) => [r.id, r.committee_uid]));
    const unmanaged = recipientIds.some((id) => {
      const committeeUid = committeeByRow.get(id);
      return !committeeUid || !managed.has(committeeUid);
    });
    if (unmanaged) {
      throw new AuthorizationError('You can only remind recipients of committees in projects you manage.', {
        operation: 'send_survey_reminders',
        service: 'survey_service',
        path: req.path,
        code: 'SURVEY_RECIPIENT_NOT_MANAGED',
      });
    }

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}/bulk_resend`, 'POST', undefined, {
      recipient_ids: recipientIds,
    });
    return { recipient_count: recipientIds.length };
  }

  /**
   * Lists the committee members a resync would send the survey to (`preview_send`).
   * Optional `committeeUid` limits it to one committee; see assertManagesResyncScope.
   */
  public async getResyncPreview(req: Request, surveyUid: string, committeeUid?: string): Promise<SurveyResyncPreview> {
    await this.assertManagesResyncScope(req, surveyUid, committeeUid, 'get_survey_resync_preview');
    const preview = await this.microserviceProxy.proxyRequest<Partial<SurveyResyncPreview> | null>(
      req,
      'LFX_V2_SERVICE',
      `/surveys/${surveyUid}/preview_send`,
      'GET',
      committeeUid ? { committee_uid: committeeUid } : undefined
    );
    return {
      affected_recipients: Array.isArray(preview?.affected_recipients) ? preview.affected_recipients : [],
      affected_committees: Array.isArray(preview?.affected_committees) ? preview.affected_committees : [],
    };
  }

  /**
   * Sends the survey to committee members who joined after it launched (`send_missing_recipients`).
   * Only adds recipients; never removes any. Optional `committeeUid` limits it to one committee;
   * see assertManagesResyncScope.
   */
  public async resyncRecipients(req: Request, surveyUid: string, committeeUid?: string): Promise<void> {
    await this.assertManagesResyncScope(req, surveyUid, committeeUid, 'resync_survey_recipients');
    await this.microserviceProxy.proxyRequest<void>(
      req,
      'LFX_V2_SERVICE',
      `/surveys/${surveyUid}/send_missing_recipients`,
      'POST',
      committeeUid ? { committee_uid: committeeUid } : undefined
    );
  }

  /**
   * Creates a new survey
   */
  public async createSurvey(req: Request, surveyData: CreateSurveyRequest): Promise<Survey> {
    // Enrich creator fields from the effective (impersonation-aware) identity, not the frontend.
    // Matches the bearer token sent upstream, and refuses to create a survey with no creator LFID.
    const creatorLfid = getEffectiveUsername(req);
    if (!creatorLfid) {
      throw new AuthenticationError('User authentication required', {
        operation: 'create_survey',
        service: 'survey_service',
        path: req.path,
      });
    }
    const enrichedData: CreateSurveyRequest = {
      ...surveyData,
      creator_id: creatorLfid,
      creator_username: creatorLfid,
      creator_name: getEffectiveName(req) || '',
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
    const { email, username } = await resolveUserIdentity(req);

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
        survey_send_date: r.survey_send_date || null,
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
    const { email, username } = await resolveUserIdentity(req);

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
    const { email, username } = await resolveUserIdentity(req);

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

  /** The survey's committee UIDs and the subset whose project the caller writes. Fails closed. */
  private async getCommitteeAccess(req: Request, surveyUid: string): Promise<{ committeeUids: string[]; managed: Set<string> }> {
    const survey = await this.microserviceProxy.proxyRequest<Pick<Survey, 'committees'>>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}`, 'GET');
    // Keep the full inventory: a committee with no resolvable UID or project can never be managed,
    // so it blocks a whole-survey resync instead of silently dropping out of the check.
    const allCommittees = survey?.committees ?? [];
    const committees = allCommittees.filter((c) => c.committee_uid && c.project_uid);
    const projectUids = [...new Set(committees.map((c) => c.project_uid))];
    if (projectUids.length === 0) {
      return { committeeUids: allCommittees.map((c) => c.committee_uid ?? ''), managed: new Set() };
    }

    const grants = await this.accessCheckService.checkAccess(
      req,
      projectUids.map((id) => ({ resource: 'project', id, access: 'writer_guard' }))
    );
    return {
      committeeUids: allCommittees.map((c) => c.committee_uid ?? ''),
      managed: new Set(committees.filter((c) => grants.get(`${c.project_uid}#writer_guard`) === true).map((c) => c.committee_uid)),
    };
  }

  /**
   * A resync emails committee members, and the gateway only checks `survey#writer`. Allow it for
   * one committee the caller manages, or for the whole survey only when the caller manages every
   * committee on it; anything else is a 403.
   */
  private async assertManagesResyncScope(req: Request, surveyUid: string, committeeUid: string | undefined, operation: string): Promise<void> {
    const { committeeUids, managed } = await this.getCommitteeAccess(req, surveyUid);
    const allowed = committeeUid ? managed.has(committeeUid) : committeeUids.length > 0 && committeeUids.every((uid) => managed.has(uid));
    if (!allowed) {
      throw new AuthorizationError('You can only resync committees in projects you manage.', {
        operation,
        service: 'survey_service',
        path: req.path,
        code: 'SURVEY_COMMITTEE_NOT_MANAGED',
      });
    }
  }

  /** Every response row of a survey, following upstream page tokens (bounded by SURVEY_RESPONSES_MAX_PAGES). */
  private async fetchAllResponseRows(req: Request, surveyUid: string): Promise<SurveyResponseItem[]> {
    const rows: SurveyResponseItem[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < SURVEY_RESPONSES_MAX_PAGES; page++) {
      const result = await this.microserviceProxy.proxyRequest<SurveyResponsesPage>(req, 'LFX_V2_SERVICE', `/surveys/${surveyUid}/responses`, 'GET', {
        per_page: SURVEY_RESPONSES_PAGE_SIZE,
        ...(pageToken && { page_token: pageToken }),
      });
      rows.push(...(Array.isArray(result?.data) ? result.data : []));
      pageToken = result?.meta?.page_token?.trim() || undefined;
      if (!pageToken) return rows;
    }
    // Past the cap a recipient can't be verified; say so rather than reporting a permission error.
    throw new MicroserviceError('This survey has too many responses to verify reminder recipients.', 422, 'SURVEY_TOO_MANY_RESPONSES', {
      operation: 'send_survey_reminders',
      service: 'survey_service',
      path: req.path,
    });
  }
}
