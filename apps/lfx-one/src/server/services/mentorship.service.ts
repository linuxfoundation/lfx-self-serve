// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_PROGRAM_REVIEW_DECISION_STATUS,
  MENTORSHIP_PROGRAM_REVIEW_DECISIONS,
  ROOT_PROJECT_SLUG,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipLfProject,
  MentorshipLfProjectsQuery,
  MentorshipLfProjectsResponse,
  MentorshipNameAvailability,
  MentorshipProgramDecisionResult,
  MentorshipProgramReview,
  MentorshipProgramReviewDecision,
  MentorshipLfxProfileFields,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramCatalog,
  MentorshipUpstreamProgramDecisionRequest,
  MentorshipUpstreamUserProfile,
  Project,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { isMentorshipCiiProjectId, normalizeToUrl, truncateToUtf16Units } from '@lfx-one/shared/utils';
import { Request } from 'express';

import {
  MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH,
  MENTORSHIP_LF_PROJECT_MAX_LIMIT,
  MENTORSHIP_LF_PROJECT_MAX_READS,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_PROGRAMS_PATH,
} from '../constants';
import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { listAllMentorshipPages, proxyMentorshipRequest, withoutQueryInErrorPath } from '../helpers/mentorship-api.helper';
import {
  buildMentorshipUpstreamLfxProfileFields,
  buildMentorshipUpstreamProfileLinks,
  resolveMentorshipGithubProfileLink,
  resolveMentorshipPrimaryEmail,
} from '../helpers/mentorship-lfx-profile.helper';

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

export class MentorshipService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly emailVerificationService = new EmailVerificationService();

  /** `excludeProgramId` leaves that program out, so an edited program's own name reads as available. */
  public async isProgramNameAvailable(req: Request, name: string, excludeProgramId?: string): Promise<MentorshipNameAvailability> {
    logger.debug(req, 'mentorship_name_available', 'Checking mentorship program name availability', { excludeProgramId });
    const result = await proxyMentorshipRequest<MentorshipNameAvailability>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/name-availability`,
      'GET',
      excludeProgramId ? { name: name.trim(), exclude_program_id: excludeProgramId } : { name: name.trim() }
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
   * stopped at, so a short page can still carry a cursor. A cursor that comes back unchanged ends the list (no `page_token`): following it
   * would only replay the page just read and duplicate its projects. Each read asks only for the slots still open, so the page never holds more
   * than `limit` (the cursor carries the sort position, not the page size). `limit` is held to 1–`MENTORSHIP_LF_PROJECT_MAX_LIMIT` and `search` is cut to
   * `MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH`. With `parentUid`, only that project's direct sub-projects: the Foundation lens
   * wizard (lfx-mentorship#398) offers its foundation, which it already has, and these sub-projects.
   */
  public async getLfProjects(req: Request, options: MentorshipLfProjectsQuery = {}): Promise<MentorshipLfProjectsResponse> {
    const search = truncateToUtf16Units(options.search?.trim() ?? '', MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH);
    const limit = Math.min(MENTORSHIP_LF_PROJECT_MAX_LIMIT, Math.max(1, options.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE));
    let pageToken = options.pageToken || undefined;
    const parentUid = options.parentUid;
    logger.debug(req, 'mentorship_get_lf_projects', 'Listing LF projects', {
      has_search: search.length > 0,
      has_page_token: !!pageToken,
      limit,
      parentUid,
    });

    const projects: Project[] = [];
    let reads = 0;
    do {
      const requestedToken = pageToken;
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project',
        ...(parentUid && { parent: `project:${parentUid}` }),
        ...(search ? { name: search, sort: 'best_match' } : { sort: 'name_asc' }),
        page_size: limit - projects.length,
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
    return { data, ...(pageToken && { page_token: pageToken }) };
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
   * The program a review email link points at, as its public page shows it. Read with the caller's
   * own token, so upstream's `viewer` check decides who sees it: approvers pass it through `auditor`.
   *
   * The catalog serves only pending and published programs and answers 404 for the rest, so on a 404
   * the plain program read (same `viewer` guard) tells a decided program from a missing one. A
   * rejected or hidden program comes back with its status and no details, which is all the page
   * shows once a program is no longer pending; a missing one still ends in 404.
   */
  public async getProgramReview(req: Request, programId: string): Promise<MentorshipProgramReview> {
    const path = `/mentorship/v1/programs/${encodeURIComponent(programId)}`;
    logger.debug(req, 'mentorship_get_program_review', 'Fetching program for review', { programId });
    try {
      const program = await this.microserviceProxy.proxyRequest<MentorshipUpstreamProgramCatalog>(req, 'LFX_V2_SERVICE', `${path}/catalog`, 'GET');
      return toProgramReview(program);
    } catch (error) {
      if (!(error instanceof MicroserviceError && error.statusCode === 404)) throw error;
      logger.debug(req, 'mentorship_get_program_review', 'Program not in the catalog, reading its status', { programId });
      const program = await this.microserviceProxy.proxyRequest<MentorshipUpstreamProgram>(req, 'LFX_V2_SERVICE', path, 'GET');
      return toDecidedProgramReview(program);
    }
  }

  /**
   * Publishes or rejects a pending program. Upstream allows this only for members of the
   * mentorship approver team (403 otherwise) and only from `pending` (409 otherwise); both
   * statuses pass through to the page unchanged.
   */
  public async submitProgramDecision(req: Request, programId: string, decision: MentorshipProgramReviewDecision): Promise<MentorshipProgramDecisionResult> {
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
    return { id: program.id, name: program.name, status: program.status };
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

/**
 * Only what the review page shows; terms, mentors and the rest of the catalog item are not
 * forwarded. Links that are not http(s) URLs and a non-numeric CII id become `null`, so the page
 * never binds an unsafe or broken value.
 */
function toProgramReview(program: MentorshipUpstreamProgramCatalog): MentorshipProgramReview {
  const ciiProjectId = program.cii_project_id?.trim() ?? '';
  return {
    id: program.id,
    name: program.name,
    status: program.status,
    projectName: program.project_name?.trim() || null,
    description: program.description?.trim() || null,
    logoUrl: toHttpUrl(program.logo_url),
    repoUrl: toHttpUrl(program.repo_link),
    codeOfConductUrl: toHttpUrl(program.code_of_conduct),
    ciiProjectId: isMentorshipCiiProjectId(ciiProjectId) ? ciiProjectId : null,
    skills: (program.skills ?? []).map((skill) => skill.trim()).filter((skill) => skill.length > 0),
    hasDetails: true,
  };
}

/** A program the catalog does not serve (rejected or hidden): its status, without details. */
function toDecidedProgramReview(program: MentorshipUpstreamProgram): MentorshipProgramReview {
  return {
    id: program.id,
    name: program.name,
    status: program.status,
    projectName: program.project_name?.trim() || null,
    description: null,
    logoUrl: null,
    repoUrl: null,
    codeOfConductUrl: null,
    ciiProjectId: null,
    skills: [],
    hasDetails: false,
  };
}

function toHttpUrl(value: string | undefined): string | null {
  return value ? normalizeToUrl(value) : null;
}
