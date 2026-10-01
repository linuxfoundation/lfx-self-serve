// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE,
  EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS,
  getMockMentorshipMentorProgramLists,
  getMockMentorshipMentorPrograms,
  MENTORSHIP_MENTOR_OPEN_PROGRAMS_PAGE_SIZE,
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorHasProfileResponse,
  MentorshipMentorInviteDecision,
  MentorshipMentorOpenProgramsQuery,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentoringHistoryEntry,
  MentorshipMentorProfileResponse,
  MentorshipMentorProfileUpdateRequest,
  MentorshipMentorProfileUpdateResponse,
  MentorshipMentorProgram,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramRequestsResponse,
  MentorshipMentorProgramsResponse,
  MentorshipMentorRegisterRequest,
  MentorshipUpstreamListResponse,
  MentorshipUpstreamMentorDetail,
  MentorshipUpstreamMentorProgram,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamProgramMembership,
  MentorshipUpstreamProgramMembershipRequest,
  MentorshipUpstreamTask,
  MentorshipUpstreamUser,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipMentorProgramDetail, isUuid } from '@lfx-one/shared/utils';
import { Request } from 'express';

import {
  MENTORSHIP_BOOTSTRAP_PATH,
  MENTORSHIP_ME_MENTOR_PROFILE_PATH,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_ME_PROGRAM_MEMBERSHIPS_PATH,
  MENTORSHIP_MENTORS_PATH,
  MENTORSHIP_MENTOR_INVITES_PATH,
  MENTORSHIP_MENTOR_PROGRAM_READ_CONCURRENCY,
  MENTORSHIP_PROGRAM_APPLICATIONS_PAGE_SIZE,
  MENTORSHIP_PROGRAMS_PATH,
} from '../constants';
import { ConflictError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { listAllMentorshipPages, proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { resolveMentorshipGithubProfileLink, resolveMentorshipPrimaryEmail } from '../helpers/mentorship-lfx-profile.helper';
import { mapMentorshipMentoringHistory, mapMentorshipMentorProfileDetails } from '../helpers/mentorship-mentor-profile.helper';
import {
  chooseMentorshipMentorProgramTerm,
  compareMentorshipMentorProgramCards,
  mapMentorshipMentorProgramCard,
  sortMentorshipMentorProgramRows,
} from '../helpers/mentorship-mentor-program.helper';
import { buildMentorshipUpstreamMentorProfileUpdate } from '../helpers/mentorship-mentor-profile-update.helper';
import {
  escapeMentorshipIlikeSearch,
  mapMentorshipMentorInvitedProgramIds,
  mapMentorshipMentorOpenProgram,
  mapMentorshipMentorProgramRequests,
} from '../helpers/mentorship-mentor-request.helper';
import { buildMentorshipUpstreamMentorProfile } from '../helpers/mentorship-mentor-register.helper';
import { findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * BFF for the mentor pages at `/mentorship/mentor/*`. The has-profile check, the register write, the
 * program requests, the profile read and edit, and My Programs call the mentorship service with the
 * caller's token; the program detail read still serves the shared mock seed data.
 */
export class MentorshipMentorService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly emailVerificationService = new EmailVerificationService();

  /**
   * Whether the signed-in user has a mentor profile. A user has at most one, so the check
   * lists the caller's own mentor rows with `limit: 1` and reports whether one came back.
   * A failure propagates so it is logged and reported with its real status; the frontend
   * treats any failed check as "no profile" and shows the register page.
   */
  public async hasMentorProfile(req: Request): Promise<MentorshipMentorHasProfileResponse> {
    logger.debug(req, 'mentorship_has_mentor_profile', 'Checking mentor profile existence');
    const hasProfile = (await this.listMentorProfiles(req)).length > 0;
    logger.debug(req, 'mentorship_has_mentor_profile', 'Mentor profile existence checked', { hasProfile });
    return { hasProfile };
  }

  /**
   * Creates the signed-in user's mentor profile. Upstream's `PUT` is an upsert that replaces every
   * column, so a second registration would wipe the first one's answers; the caller's own mentor
   * rows are listed first and an existing profile is refused with a 409 the register page reads.
   * A failed check propagates rather than falling through to the write. Upstream's own 400 and 403
   * also pass through. The check and the write are two requests, so two simultaneous
   * registrations by the same user can both pass the check; the later write wins. The email and the
   * GitHub link are the caller's verified primary email and connected GitHub account, looked up
   * here, and each is left out when its lookup fails.
   */
  public async registerMentorProfile(req: Request, request: MentorshipMentorRegisterRequest): Promise<void> {
    logger.debug(req, 'mentorship_register_mentor_profile', 'Checking for an existing mentor profile');
    if ((await this.listMentorProfiles(req)).length > 0) {
      throw new ConflictError(MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS, MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE, {
        operation: 'mentorship_register_mentor_profile',
      });
    }

    const [email, githubProfileLink] = await Promise.all([
      resolveMentorshipPrimaryEmail(req, this.emailVerificationService),
      resolveMentorshipGithubProfileLink(req, this.emailVerificationService),
    ]);
    const body = buildMentorshipUpstreamMentorProfile(request, email, githubProfileLink);
    logger.debug(req, 'mentorship_register_mentor_profile', 'Creating mentor profile', {
      skills_count: body.skill_set.skills.length,
      has_email: body.email !== undefined,
      has_github: body.profile_links !== undefined,
    });
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, MENTORSHIP_ME_MENTOR_PROFILE_PATH, 'PUT', undefined, body);
    logger.debug(req, 'mentorship_register_mentor_profile', 'Mentor profile created');
  }

  /**
   * One page of the programs a mentor can ask to join: published programs, optionally narrowed by
   * name, read from the plain program list rather than the public catalog, since the picker needs
   * only each program's id and name. A page with no usable total is treated as the last one, so the
   * picker never asks for more than exists.
   */
  public async getOpenPrograms(req: Request, query: MentorshipMentorOpenProgramsQuery = {}): Promise<MentorshipMentorOpenProgramsResponse> {
    const offset = query.offset ?? 0;
    logger.debug(req, 'mentorship_get_mentor_open_programs', 'Loading programs taking mentor requests', { offset, has_search: !!query.search });
    const { data, meta } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamProgram>>(
      this.microserviceProxy,
      req,
      MENTORSHIP_PROGRAMS_PATH,
      'GET',
      {
        status: 'published',
        limit: MENTORSHIP_MENTOR_OPEN_PROGRAMS_PAGE_SIZE,
        offset,
        ...(query.search ? { search: escapeMentorshipIlikeSearch(query.search) } : {}),
      }
    );
    const programs = (data ?? []).map(mapMentorshipMentorOpenProgram);
    const total = typeof meta?.total === 'number' && Number.isFinite(meta.total) ? meta.total : offset + programs.length;
    logger.debug(req, 'mentorship_get_mentor_open_programs', 'Programs taking mentor requests loaded', { count: programs.length, total, offset });
    return { data: programs, total };
  }

  /**
   * The caller's own mentor `program_members` rows, as request rows with their status folded for the mentor.
   * Invited rows are not requests, so they are left out of `data`; their programs go in `invitedProgramIds`.
   */
  public async getMentorRequests(req: Request): Promise<MentorshipMentorProgramRequestsResponse> {
    logger.debug(req, 'mentorship_get_mentor_requests', 'Loading mentor program requests');
    const memberships = await listAllMentorshipPages<MentorshipUpstreamProgramMembership>(this.microserviceProxy, req, MENTORSHIP_ME_PROGRAM_MEMBERSHIPS_PATH, {
      member_type: 'mentor',
    });
    const data = mapMentorshipMentorProgramRequests(memberships);
    const invitedProgramIds = mapMentorshipMentorInvitedProgramIds(memberships);
    logger.debug(req, 'mentorship_get_mentor_requests', 'Mentor program requests loaded', {
      count: data.length,
      invited: invitedProgramIds.length,
      dropped: memberships.length - data.length,
    });
    return { data, invitedProgramIds };
  }

  /**
   * Asks to mentor a program: upstream creates the caller's `mentor` row as `requested`, or reopens a
   * withdrawn one. Upstream's 404 passes through when the program is gone or hidden, and its 409 when the
   * caller already has a request, invitation, membership or declined request for that program.
   */
  public async requestToMentor(req: Request, programId: string): Promise<void> {
    const body: MentorshipUpstreamProgramMembershipRequest = { program_id: programId };
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, MENTORSHIP_ME_PROGRAM_MEMBERSHIPS_PATH, 'POST', undefined, body);
  }

  /**
   * Withdraws one of the caller's mentor requests. Upstream's 404 passes through when the row is not the
   * caller's, and its 409 when the request is no longer pending.
   */
  public async withdrawMentorRequest(req: Request, requestId: string): Promise<void> {
    await proxyMentorshipRequest<unknown>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_ME_PROGRAM_MEMBERSHIPS_PATH}/${encodeURIComponent(requestId)}/withdraw`,
      'POST'
    );
  }

  /**
   * Accepts or declines a mentor invitation with the token from the invite email. Upstream checks the
   * token belongs to the caller (403 otherwise) and answers 400 when it is expired, malformed, or the
   * invitation was already answered; both pass through. Upstream takes the token in the path, so a
   * failure is rethrown with it redacted from the path and operation the error log records.
   */
  public async respondToMentorInvite(req: Request, token: string, decision: MentorshipMentorInviteDecision): Promise<void> {
    try {
      await proxyMentorshipRequest<unknown>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_MENTOR_INVITES_PATH}/${encodeURIComponent(token)}/${decision}`,
        'POST',
        undefined,
        undefined,
        `${MENTORSHIP_MENTOR_INVITES_PATH}/redacted/${decision}`
      );
    } catch (error) {
      if (!(error instanceof MicroserviceError)) {
        throw error;
      }
      const redact = (value?: string) => value?.split(token).join('redacted');
      throw new MicroserviceError(error.message, error.statusCode, error.code, {
        operation: redact(error.operation),
        service: error.service,
        path: redact(error.path),
        errorBody: error.errorBody,
        originalMessage: error.originalMessage,
        originalError: error.originalError,
        transportFailure: error.transportFailure,
        clientMessage: error.clientMessage,
      });
    }
  }

  /**
   * My Programs: one card for each published program the caller is an active mentor of, read from their
   * public mentor detail. Upstream's 404 for no such membership is an empty list. Each card is built from its
   * chosen term's rows, at most `MENTORSHIP_MENTOR_PROGRAM_READ_CONCURRENCY` programs at once. Any other
   * failed read propagates, so a card is never shown with counts that were not read.
   */
  public async getMentorPrograms(req: Request): Promise<MentorshipMentorProgramsResponse> {
    logger.debug(req, 'mentorship_get_mentor_programs', 'Loading mentor programs');
    const detail = await this.findMentorDetail(req, 'mentorship_get_mentor_programs');
    const programs = detail?.programs ?? [];
    const now = new Date();
    const data: MentorshipMentorProgram[] = [];
    for (let start = 0; start < programs.length; start += MENTORSHIP_MENTOR_PROGRAM_READ_CONCURRENCY) {
      const batch = programs.slice(start, start + MENTORSHIP_MENTOR_PROGRAM_READ_CONCURRENCY);
      data.push(...(await Promise.all(batch.map((program) => this.buildMentorProgramCard(req, program, now)))));
    }
    data.sort(compareMentorshipMentorProgramCards);
    logger.debug(req, 'mentorship_get_mentor_programs', 'Mentor programs loaded', { count: data.length });
    return { data, total: data.length };
  }

  /**
   * The signed-in user's mentor profile and Mentoring History. The profile is their own mentor row; with
   * none, the profile is empty, as the mentee page does, and upstream's 409 for more than one propagates.
   * The history comes from their public mentor detail, which is keyed by their local user id, so the user is
   * read first; the two branches run in parallel. A failed read propagates, except upstream's 404 for a
   * mentor with no active membership of a published program, which is an empty history.
   */
  public async getMentorProfile(req: Request): Promise<MentorshipMentorProfileResponse> {
    logger.debug(req, 'mentorship_get_mentor_profile', 'Loading mentor profile');
    const [profile, history] = await Promise.all([this.findStoredMentorProfile(req), this.getMentoringHistory(req)]);
    if (!profile) {
      logger.debug(req, 'mentorship_get_mentor_profile', 'No mentor profile for the signed-in user, returning an empty profile', {
        history_count: history.length,
      });
      return { profile: { ...EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE.profile, skills: [] }, history };
    }

    const response: MentorshipMentorProfileResponse = { profile: mapMentorshipMentorProfileDetails(profile), history };
    logger.debug(req, 'mentorship_get_mentor_profile', 'Mentor profile loaded', {
      skills_count: response.profile.skills.length,
      history_count: history.length,
    });
    return response;
  }

  /**
   * Saves the changed fields of the signed-in user's mentor profile. Upstream keeps every column the body omits
   * and replaces `skill_set` whole, so when the skills change the stored row is read first and the skills are
   * layered over its `skill_set`, keeping keys this BFF does not model; a failed read propagates rather than
   * risk dropping them. The two calls are not atomic, so an edit made elsewhere in between can be overwritten.
   * The response is the re-mapped row without the history, which the caller already has. Upstream's 404 (no
   * mentor profile) and 409 (more than one) propagate.
   */
  public async updateMentorProfile(req: Request, request: MentorshipMentorProfileUpdateRequest): Promise<MentorshipMentorProfileUpdateResponse> {
    // Field names only: the values are personal data.
    logger.debug(req, 'mentorship_update_mentor_profile', 'Updating mentor profile', { changed_fields: Object.keys(request) });
    const stored = request.skills !== undefined ? await this.getStoredMentorProfile(req) : undefined;
    const upstream = await proxyMentorshipRequest<MentorshipUpstreamUserProfile>(
      this.microserviceProxy,
      req,
      MENTORSHIP_ME_MENTOR_PROFILE_PATH,
      'PATCH',
      undefined,
      buildMentorshipUpstreamMentorProfileUpdate(request, stored)
    );
    const profile = mapMentorshipMentorProfileDetails(upstream);
    logger.debug(req, 'mentorship_update_mentor_profile', 'Mentor profile updated', { skills_count: profile.skills.length });
    return { profile };
  }

  public async getMentorProgram(req: Request, programId: string): Promise<MentorshipMentorProgramDetail> {
    logger.debug(req, 'mentorship_get_mentor_program', 'Resolving mentor program', { programId });
    const program = this.findMentorProgram(programId);
    if (!program) {
      throw new ResourceNotFoundError('Mentor program', programId, { operation: 'mentorship_get_mentor_program' });
    }

    // Lists are keyed by mentor program id so a Fall card cannot pick up a Winter
    // slug-twin, and cards without people fixtures stay empty instead of inheriting
    // another program's rows.
    const lists: MentorshipMentorProgramLists = getMockMentorshipMentorProgramLists()[program.id] ?? EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS;
    const detail = buildMentorshipMentorProgramDetail(program, lists);
    logger.debug(req, 'mentorship_get_mentor_program', 'Mentor program detail built', { programId, slug: program.slug, tabCounts: detail.tabCounts });
    return detail;
  }

  /** The Mentoring History from the caller's public mentor detail; with none, the history is empty. */
  private async getMentoringHistory(req: Request): Promise<MentorshipMentoringHistoryEntry[]> {
    const detail = await this.findMentorDetail(req, 'mentorship_get_mentor_profile');
    return detail ? mapMentorshipMentoringHistory(detail, new Date()) : [];
  }

  /**
   * The caller's public mentor detail. It is keyed by their local user id, so the user is read first; no id
   * comes from the request, so a mentor reads only their own programs. Upstream answers 404 when the caller
   * has no active membership of a published program, which is `undefined` rather than a failure.
   */
  private async findMentorDetail(req: Request, operation: string): Promise<MentorshipUpstreamMentorDetail | undefined> {
    const user = await proxyMentorshipRequest<MentorshipUpstreamUser>(this.microserviceProxy, req, MENTORSHIP_BOOTSTRAP_PATH);
    const userId = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!isUuid(userId)) {
      throw new MicroserviceError('The mentorship service returned a user without a valid id', 502, 'MENTORSHIP_INVALID_USER', {
        operation,
        service: 'mentorship',
      });
    }

    try {
      return await proxyMentorshipRequest<MentorshipUpstreamMentorDetail>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_MENTORS_PATH}/${encodeURIComponent(userId)}`
      );
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.debug(req, operation, 'No mentor detail for the signed-in user');
        return undefined;
      }
      throw error;
    }
  }

  /**
   * One My Programs card. The program's own record carries its project name. The chosen term's applications
   * and submitted tasks are read in full alongside it; with no term there is nothing to count.
   */
  private async buildMentorProgramCard(req: Request, program: MentorshipUpstreamMentorProgram, now: Date): Promise<MentorshipMentorProgram> {
    const programPath = `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(program.id)}`;
    const choice = chooseMentorshipMentorProgramTerm(program.terms ?? [], now);
    const termId = choice.term?.id;
    const [record, applications, tasks] = await Promise.all([
      proxyMentorshipRequest<MentorshipUpstreamProgram>(this.microserviceProxy, req, programPath),
      termId
        ? listAllMentorshipPages<MentorshipUpstreamProgramApplicationRow>(
            this.microserviceProxy,
            req,
            `${programPath}/applications`,
            { term: termId },
            MENTORSHIP_PROGRAM_APPLICATIONS_PAGE_SIZE
          )
        : [],
      termId
        ? listAllMentorshipPages<MentorshipUpstreamTask>(this.microserviceProxy, req, `${programPath}/terms/${encodeURIComponent(termId)}/tasks`, {
            status: 'submitted',
          })
        : [],
    ]);
    const card = mapMentorshipMentorProgramCard(program, record ?? {}, choice, sortMentorshipMentorProgramRows(applications, tasks));
    logger.debug(req, 'mentorship_get_mentor_programs', 'Mentor program card built', {
      program_id: program.id,
      term_id: termId,
      term_status: card.termStatus,
      ...card.stats,
    });
    return card;
  }

  /**
   * The caller's own mentor profile rows, for checking whether one exists; `limit: 1` is enough for that.
   * Upstream can send `data` as null for none.
   */
  private async listMentorProfiles(req: Request): Promise<MentorshipUpstreamUserProfile[]> {
    const { data } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamUserProfile>>(
      this.microserviceProxy,
      req,
      MENTORSHIP_ME_PROFILES_PATH,
      'GET',
      { profile_type: 'mentor', limit: 1 }
    );
    return data ?? [];
  }

  /**
   * The caller's mentor profile through upstream's typed read, which answers 409 when there is more than one
   * rather than pick one, and 404 when there is none.
   */
  private async getStoredMentorProfile(req: Request): Promise<MentorshipUpstreamUserProfile> {
    return proxyMentorshipRequest<MentorshipUpstreamUserProfile>(this.microserviceProxy, req, MENTORSHIP_ME_MENTOR_PROFILE_PATH);
  }

  /** As `getStoredMentorProfile`, with upstream's 404 (no mentor profile) read as none. */
  private async findStoredMentorProfile(req: Request): Promise<MentorshipUpstreamUserProfile | undefined> {
    try {
      return await this.getStoredMentorProfile(req);
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return undefined;
      throw error;
    }
  }

  /** Mentor programs resolve by id (default) or slug, matching `/mentorship/mentor/programs/:programId`. */
  private findMentorProgram(programId: string): MentorshipMentorProgram | undefined {
    return findByIdOrSlug(getMockMentorshipMentorPrograms(), programId);
  }
}
