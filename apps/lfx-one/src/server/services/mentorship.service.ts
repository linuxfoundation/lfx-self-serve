// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_INVITABLE_USER_PAGE_SIZE,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_PROGRAM_REVIEW_DECISION_STATUS,
  MENTORSHIP_PROGRAM_REVIEW_DECISIONS,
  MOCK_MENTORSHIP_INVITABLE_USERS,
  ROOT_PROJECT_SLUG,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipInvitableUsersResponse,
  MentorshipLfProject,
  MentorshipLfProjectsResponse,
  MentorshipNameAvailability,
  MentorshipProgramReview,
  MentorshipProgramReviewDecision,
  MentorshipLfxProfileFields,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramDecisionRequest,
  MentorshipUpstreamUserProfile,
  Project,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { isMentorshipCiiProjectId } from '@lfx-one/shared/utils';
import { Request } from 'express';

import {
  MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH,
  MENTORSHIP_LF_PROJECT_MAX_LIMIT,
  MENTORSHIP_LF_PROJECT_MAX_READS,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_PROGRAMS_PATH,
} from '../constants';
import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { listAllMentorshipPages, proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import {
  buildMentorshipUpstreamLfxProfileFields,
  buildMentorshipUpstreamProfileLinks,
  resolveMentorshipGithubProfileLink,
  resolveMentorshipPrimaryEmail,
} from '../helpers/mentorship-lfx-profile.helper';
import { paginateOffsetLimit } from '../helpers/mentorship-params.helper';

import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

const CII_BADGE_TIMEOUT_MS = 10_000;

/**
 * Allowlisted CII badge URL. `Number()` is the sanitizer CodeQL models for path IDs
 * (`js/request-forgery`); keep the host as a string literal concatenated with that number.
 * Must stay aligned with `MENTORSHIP_CII_HOST` / `MENTORSHIP_CII_BADGE_JSON_BASE`.
 */
function buildCiiBadgeJsonUrl(projectId: string): string {
  const numericId = Number(projectId.trim());
  if (!Number.isInteger(numericId) || numericId < 1) {
    throw ServiceValidationError.forField('projectId', 'CII Project ID must be numeric', { operation: 'mentorship_get_cii_badge' });
  }
  return 'https://www.bestpractices.dev/projects/' + numericId + '/badge.json';
}

/**
 * An upstream failure's `path` is the full request URL, query included, and the error handler logs it. This rebuilds the error
 * with the query cut off, so a failed name check does not log the name it was asked about.
 */
function withoutQueryInErrorPath(error: unknown): unknown {
  if (!(error instanceof MicroserviceError) || !error.path?.includes('?')) return error;
  return new MicroserviceError(error.message, error.statusCode, error.code, {
    operation: error.operation,
    service: error.service,
    path: error.path.slice(0, error.path.indexOf('?')),
    errorBody: error.errorBody,
    originalMessage: error.originalMessage,
    originalError: error.originalError,
    transportFailure: error.transportFailure,
    clientMessage: error.clientMessage,
  });
}

export class MentorshipService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly emailVerificationService = new EmailVerificationService();

  public async isProgramNameAvailable(req: Request, name: string): Promise<MentorshipNameAvailability> {
    logger.debug(req, 'mentorship_name_available', 'Checking mentorship program name availability');
    const result = await proxyMentorshipRequest<MentorshipNameAvailability>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/name-availability`,
      'GET',
      { name: name.trim() }
    ).catch((error: unknown) => {
      throw withoutQueryInErrorPath(error);
    });
    logger.debug(req, 'mentorship_name_available', 'Mentorship program name availability resolved', { available: result.available });
    return { available: result.available };
  }

  /**
   * One lazy-load page of LF projects for the enroll picker (ROOT excluded): by name when `search` is blank, by relevance otherwise.
   * The query service can trim a page after cutting it (access filtering) and still return a `page_token`, so this follows the
   * token until `limit` projects are in hand or `MENTORSHIP_LF_PROJECT_MAX_READS` reads are spent, and hands back the token it
   * stopped at, so a short page can still carry a cursor. A cursor that comes back unchanged ends the list (null): following it
   * would only replay the page just read and duplicate its projects. The page may hold a little more than `limit`, since a project is never
   * dropped between two cursors. `limit` is held to 1–`MENTORSHIP_LF_PROJECT_MAX_LIMIT` and `search` is cut to
   * `MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH`.
   */
  public async getLfProjects(req: Request, options: { search?: string; pageToken?: string; limit?: number } = {}): Promise<MentorshipLfProjectsResponse> {
    const search = (options.search?.trim() ?? '').slice(0, MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH);
    const limit = Math.min(MENTORSHIP_LF_PROJECT_MAX_LIMIT, Math.max(1, options.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE));
    let pageToken = options.pageToken || undefined;
    logger.debug(req, 'mentorship_get_lf_projects', 'Listing LF projects', { has_search: search.length > 0, has_page_token: !!pageToken, limit });

    const projects: Project[] = [];
    let reads = 0;
    do {
      const requestedToken = pageToken;
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project',
        ...(search ? { name: search, sort: 'best_match' } : { sort: 'name_asc' }),
        page_size: limit,
        ...(pageToken && { page_token: pageToken }),
      });
      projects.push(...response.resources.map((resource) => resource.data).filter((project) => project.slug !== ROOT_PROJECT_SLUG));
      pageToken = response.page_token && response.page_token !== requestedToken ? response.page_token : undefined;
      reads++;
    } while (pageToken && projects.length < limit && reads < MENTORSHIP_LF_PROJECT_MAX_READS);

    const data: MentorshipLfProject[] = projects.map((project) => ({
      id: project.uid,
      name: project.name,
      slug: project.slug,
      ...(project.logo_url ? { logoUrl: project.logo_url } : {}),
    }));

    logger.debug(req, 'mentorship_get_lf_projects', 'LF projects page built', { count: data.length, reads, has_more: !!pageToken });
    return { data, nextPageToken: pageToken ?? null };
  }

  /**
   * LFX users that can be invited as mentors. Not program-scoped — this is the
   * general user pool; callers exclude anyone already on their own list.
   */
  public async getInvitableUsers(req: Request, options: { search?: string; offset?: number; limit?: number } = {}): Promise<MentorshipInvitableUsersResponse> {
    logger.debug(req, 'mentorship_get_invitable_users', 'Filtering invitable users', options);

    const needle = options.search?.trim().toLowerCase() ?? '';
    const filtered = needle
      ? MOCK_MENTORSHIP_INVITABLE_USERS.filter((user) => user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle))
      : [...MOCK_MENTORSHIP_INVITABLE_USERS];

    const page = paginateOffsetLimit(filtered, options.offset ?? 0, options.limit ?? MENTORSHIP_INVITABLE_USER_PAGE_SIZE);
    logger.debug(req, 'mentorship_get_invitable_users', 'Invitable users page built', { count: page.data.length, total: page.total });
    return page;
  }

  public async getCiiBadge(req: Request, projectId: string): Promise<MentorshipCiiBadge> {
    logger.debug(req, 'mentorship_get_cii_badge', 'Fetching CII badge', { projectId });

    if (!isMentorshipCiiProjectId(projectId)) {
      throw ServiceValidationError.forField('projectId', 'CII Project ID must be numeric', { operation: 'mentorship_get_cii_badge' });
    }

    const url = buildCiiBadgeJsonUrl(projectId);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(CII_BADGE_TIMEOUT_MS) });
    } catch (error) {
      throw new MicroserviceError('CII Best Practices is temporarily unavailable. Please try again later.', 502, 'UPSTREAM_UNREACHABLE', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
        originalError: error instanceof Error ? error : undefined,
        transportFailure: true,
      });
    }

    if (response.status === 404) {
      throw new ResourceNotFoundError('CII project', projectId, { operation: 'mentorship_get_cii_badge' });
    }
    if (!response.ok) {
      throw MicroserviceError.fromMicroserviceResponse(response.status, response.statusText, {}, 'cii_best_practices', url, 'mentorship_get_cii_badge');
    }

    // Only parse a body the upstream actually declared as JSON — an HTML error or interstitial
    // page served with a 200 must not reach the JSON parser.
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      throw new MicroserviceError('CII Best Practices returned an invalid response.', 502, 'BAD_GATEWAY', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new MicroserviceError('CII Best Practices returned an invalid response.', 502, 'BAD_GATEWAY', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
        originalError: error instanceof Error ? error : undefined,
      });
    }

    const badgeLevel = payload && typeof payload === 'object' ? (payload as { badge_level?: unknown }).badge_level : undefined;
    if (typeof badgeLevel !== 'string' || !badgeLevel) {
      throw new MicroserviceError('CII Best Practices returned an invalid response.', 502, 'BAD_GATEWAY', {
        operation: 'mentorship_get_cii_badge',
        service: 'cii_best_practices',
        path: url,
      });
    }

    const badge: MentorshipCiiBadge = { projectId, badgeLevel };
    logger.debug(req, 'mentorship_get_cii_badge', 'CII badge resolved', { projectId, badgeLevel: badge.badgeLevel });
    return badge;
  }

  /**
   * The program an approve/reject email link points at. Proxied to the mentorship service
   * with the caller's own token, so its `viewer` check decides who can see the program.
   */
  public async getProgramReview(req: Request, programId: string): Promise<MentorshipProgramReview> {
    logger.debug(req, 'mentorship_get_program_review', 'Fetching program for review', { programId });
    const program = await this.microserviceProxy.proxyRequest<MentorshipUpstreamProgram>(
      req,
      'LFX_V2_SERVICE',
      `/mentorship/v1/programs/${encodeURIComponent(programId)}`,
      'GET'
    );
    return toProgramReview(program);
  }

  /**
   * Publishes or rejects a pending program. Upstream allows this only for members of the
   * mentorship approver team (403 otherwise) and only from `pending` (409 otherwise); both
   * statuses pass through to the page unchanged.
   */
  public async submitProgramDecision(req: Request, programId: string, decision: MentorshipProgramReviewDecision): Promise<MentorshipProgramReview> {
    const body: MentorshipUpstreamProgramDecisionRequest = { status: MENTORSHIP_PROGRAM_REVIEW_DECISION_STATUS[decision] };
    logger.debug(req, 'mentorship_submit_program_decision', 'Submitting program review decision', { programId, status: body.status });
    const program = await this.microserviceProxy.proxyRequest<MentorshipUpstreamProgram>(
      req,
      'LFX_V2_SERVICE',
      `/mentorship/v1/programs/${encodeURIComponent(programId)}/decision`,
      'POST',
      undefined,
      body
    );
    return toProgramReview(program);
  }

  /**
   * Copies the LFX profile's name and logo, with the caller's verified primary email and connected
   * GitHub account, onto every mentor and mentee profile the caller holds, and returns how many were
   * updated. The email and the GitHub link are looked up here rather than taken from the browser,
   * and each is left out when its lookup fails. The GitHub link is laid over each row's stored
   * `profile_links`, since upstream replaces that column whole. Each row is patched by id, since
   * `PATCH /me/profiles/{type}` refuses a type with more than one row; upstream checks the row is
   * the caller's. Only the keys that have a value are sent, so with no rows, or nothing to send, no
   * row is patched. A failed row propagates and leaves the rows after it unpatched; the card asks
   * the user to save again, which rewrites them all.
   */
  public async syncLfxProfileFields(req: Request, fields: MentorshipLfxProfileFields): Promise<number> {
    const profiles = await listAllMentorshipPages<MentorshipUpstreamUserProfile>(this.microserviceProxy, req, MENTORSHIP_ME_PROFILES_PATH);
    const targets = profiles.filter((profile) => profile.profile_type === 'mentor' || profile.profile_type === 'mentee');
    if (targets.length === 0) return 0;

    const [email, githubProfileLink] = await Promise.all([
      resolveMentorshipPrimaryEmail(req, this.emailVerificationService),
      resolveMentorshipGithubProfileLink(req, this.emailVerificationService),
    ]);
    const body = buildMentorshipUpstreamLfxProfileFields(fields, email);
    if (Object.keys(body).length === 0 && githubProfileLink === undefined) return 0;
    logger.debug(req, 'mentorship_sync_lfx_profile', 'Copying LFX profile fields onto mentorship profiles', {
      profile_count: targets.length,
      field_count: Object.keys(body).length,
      has_email: body.email !== undefined,
      has_github: githubProfileLink !== undefined,
    });

    for (const profile of targets) {
      const profileLinks = buildMentorshipUpstreamProfileLinks(profile.profile_links, githubProfileLink);
      await proxyMentorshipRequest<unknown>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_ME_PROFILES_PATH}/by-id/${encodeURIComponent(profile.id)}`,
        'PATCH',
        undefined,
        profileLinks ? { ...body, profile_links: profileLinks } : body
      );
    }
    return targets.length;
  }
}

export function isMentorshipProgramReviewDecision(value: unknown): value is MentorshipProgramReviewDecision {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_REVIEW_DECISIONS as readonly string[]).includes(value);
}

/** Only what the review page shows; the full upstream program is not forwarded. */
function toProgramReview(program: MentorshipUpstreamProgram): MentorshipProgramReview {
  return { id: program.id, name: program.name, status: program.status };
}
