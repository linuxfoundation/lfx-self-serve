// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_MAX_OPEN_TERMS,
  MENTORSHIP_MAX_OPEN_TERMS_MESSAGE,
  MENTORSHIP_PROGRAM_NAME_TAKEN_ERROR_CODE,
  MENTORSHIP_PROGRAM_STATUSES,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsQuery,
  MentorshipAdminMentorCandidatesResponse,
  MentorshipAdminMentorInviteRequest,
  MentorshipAdminMentorsResponse,
  MentorshipAdminMentorStatusUpdate,
  MentorshipAdminProgramPage,
  MentorshipAdminProgramTabCounts,
  MentorshipAdminTermInput,
  MentorshipAdminTermOption,
  MentorshipAdminTermsQuery,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollImport,
  MentorshipEnrollProgramRef,
  MentorshipEnrollUpdateRequest,
  MentorshipProgramLogoUploadResult,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipProgramTermRow,
  MentorshipTermRowStatus,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamApplication,
  MentorshipUpstreamCreatedProgram,
  MentorshipUpstreamEnrollTemplate,
  MentorshipUpstreamListResponse,
  MentorshipUpstreamLogoUpload,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamMentorCandidate,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramManagementSummary,
  MentorshipUpstreamProgramTerm,
  MentorshipUpstreamTask,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';
import { lastDayOfMentorshipMonth } from '@lfx-one/shared/utils';
import { Request } from 'express';

import {
  MENTORSHIP_ADMIN_APPLICATIONS_MAX_LIMIT,
  MENTORSHIP_ADMIN_MENTEE_STATUS_FILTER_TO_UPSTREAM,
  MENTORSHIP_ADMIN_TASKS_MAX_LIMIT,
  MENTORSHIP_ADMIN_TERMS_MAX_LIMIT,
  MENTORSHIP_ADMIN_WITHDRAWABLE_STATUSES,
  MENTORSHIP_APPLICATIONS_PATH,
  MENTORSHIP_ME_PROGRAMS_PATH,
  MENTORSHIP_PROGRAMS_PATH,
} from '../constants';
import { ConflictError, MicroserviceError } from '../errors';
import {
  mapMentorshipAdminHeaderProgram,
  mapMentorshipAdminMentorRow,
  mapMentorshipAdminProgram,
  mapMentorshipAdminTermRow,
} from '../helpers/mentorship-admin-program.helper';
import { isMentorshipNotProvisionedError, listAllMentorshipPages, proxyMentorshipRequest, withoutQueryInErrorPath } from '../helpers/mentorship-api.helper';
import { saveMentorshipApplicationNote } from '../helpers/mentorship-application-note.helper';
import {
  toMentorshipEnrollImport,
  toMentorshipEnrollProgramRef,
  toMentorshipProgramLogoUploadResult,
  toMentorshipUpstreamProgramUpdate,
  toMentorshipUpstreamTermDates,
} from '../helpers/mentorship-enroll.helper';
import { escapeMentorshipSearch } from '../helpers/mentorship-params.helper';
import { mapMentorshipAdminApplicantRow, mapMentorshipProgramTask } from '../helpers/mentorship-program-application.helper';

import { logger } from './logger.service';
import { MentorshipService } from './mentorship.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** The program admin screens behind `/api/mentorship/admin`. */
export class MentorshipAdminService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly mentorshipService = new MentorshipService();

  /**
   * The programs the caller administers, from one upstream `GET /me/programs` read: upstream searches, filters by
   * the status shown, sorts by name and pages. On a first visit `proxyMentorshipRequest` provisions the caller
   * (`PUT /me`) and retries, as on the mentor and mentee pages. A caller still not provisioned after that, or one
   * not provisioned while impersonating (which never provisions), has no programs.
   */
  public async getPrograms(
    req: Request,
    options: { search?: string; status?: MentorshipProgramStatus; offset: number; limit: number }
  ): Promise<MentorshipProgramsResponse> {
    logger.debug(req, 'mentorship_admin_get_programs', 'Loading administered mentorship programs', { status: options.status });

    let upstream: MentorshipUpstreamListResponse<MentorshipUpstreamAdministeredProgram>;
    try {
      upstream = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamAdministeredProgram>>(
        this.microserviceProxy,
        req,
        MENTORSHIP_ME_PROGRAMS_PATH,
        'GET',
        {
          search: escapeMentorshipSearch(options.search),
          status: options.status?.replace('-', '_'),
          limit: options.limit,
          offset: options.offset,
        }
      );
    } catch (error) {
      if (isMentorshipNotProvisionedError(error)) {
        logger.warning(req, 'mentorship_admin_get_programs', 'Caller has no mentorship record; returning an empty program list', {});
        return { data: [], total: 0 };
      }
      throw error;
    }

    const data = (upstream.data ?? []).map((item) => {
      const { program, unknownStatus } = mapMentorshipAdminProgram(item);
      if (unknownStatus) {
        logger.warning(req, 'mentorship_admin_get_programs', 'Unknown upstream admin status; showing it as pending review', {
          programId: item.id,
          adminStatus: item.admin_status,
        });
      }
      return program;
    });
    const total = upstream.meta?.total ?? data.length;
    logger.debug(req, 'mentorship_admin_get_programs', 'Mentorship programs page built', { count: data.length, total });

    return { data, total };
  }

  /**
   * One program page: the header, the four tab counts and the term options, from five parallel reads. The header is
   * required, so its error (404 for an unknown program) passes on. Upstream lets any viewer read the header, so a 403 on
   * a manager-only read (the summary, the applications or the members) passes on too: the caller may not manage the
   * program. Any other failure of those reads leaves its count `null`, and a failed terms read leaves the terms `[]`.
   * The summary also settles whether a published program reads `open` or `completed`, so a program whose summary
   * failed reads `open`.
   */
  public async getProgramPage(req: Request, programId: string): Promise<MentorshipAdminProgramPage> {
    logger.debug(req, 'mentorship_admin_get_program', 'Loading mentorship program page', { programId });

    const base = `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}`;
    const read = <T>(path: string, query?: Record<string, unknown>) => proxyMentorshipRequest<T>(this.microserviceProxy, req, `${base}${path}`, 'GET', query);
    const [header, summary, applications, members, terms] = await Promise.allSettled([
      read<MentorshipUpstreamProgramHeader>('/header'),
      read<MentorshipUpstreamProgramManagementSummary>('/management-summary'),
      read<MentorshipUpstreamListResponse<unknown>>('/applications', { type: 'current', limit: 1 }),
      read<MentorshipUpstreamListResponse<unknown>>('/member-management', { limit: 1 }),
      listAllMentorshipPages<MentorshipUpstreamProgramTerm>(this.microserviceProxy, req, `${base}/terms`, {}, MENTORSHIP_ADMIN_TERMS_MAX_LIMIT),
    ]);

    if (header.status === 'rejected') {
      throw header.reason;
    }
    const forbidden = [summary, applications, members].find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof MicroserviceError && result.reason.statusCode === 403
    );
    if (forbidden) {
      throw forbidden.reason;
    }

    const failed = [summary, applications, members, terms].filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      logger.warning(req, 'mentorship_admin_get_program', 'Some program page reads failed; showing their counts as unavailable', { programId, failed });
    }

    const summaryData = summary.status === 'fulfilled' ? summary.value : undefined;
    const { program, unknownStatus } = mapMentorshipAdminHeaderProgram(header.value, summaryData);
    if (unknownStatus) {
      logger.warning(req, 'mentorship_admin_get_program', 'Unknown upstream program status; showing it as pending review', {
        programId,
        status: header.value.program.status,
      });
    }

    const tabCounts: MentorshipAdminProgramTabCounts = {
      currentMentees: applications.status === 'fulfilled' ? (applications.value.meta?.total ?? null) : null,
      pastMentees: summaryData?.past_mentees ?? null,
      mentors: members.status === 'fulfilled' ? (members.value.meta?.total ?? null) : null,
      terms: summaryData?.terms ?? null,
    };
    const termOptions: MentorshipAdminTermOption[] =
      terms.status === 'fulfilled'
        ? terms.value
            .filter((term): term is MentorshipUpstreamProgramTerm & { status: MentorshipTermRowStatus } => term.status === 'open' || term.status === 'closed')
            .map((term) => ({ id: term.id, name: term.name, status: term.status }))
        : [];

    logger.debug(req, 'mentorship_admin_get_program', 'Mentorship program page built', { programId, tabCounts, terms: termOptions.length });
    return { program, tabCounts, terms: termOptions };
  }

  /**
   * One page of a program's mentees, from one upstream applications read. It never reads the other pages, and it
   * never reads tasks: those load on the View Tasks click. A caller with no mentorship record has no mentees.
   */
  public async getProgramMentees(req: Request, programId: string, query: MentorshipAdminMenteesQuery): Promise<MentorshipAdminMenteesResponse> {
    logger.debug(req, 'mentorship_admin_get_program_mentees', 'Loading program mentees', {
      programId,
      type: query.type,
      status: query.status,
      offset: query.offset,
      limit: query.limit,
    });

    let upstream: MentorshipUpstreamListResponse<MentorshipUpstreamProgramApplicationRow>;
    try {
      upstream = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamProgramApplicationRow>>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/applications`,
        'GET',
        {
          type: query.type,
          status: query.status ? MENTORSHIP_ADMIN_MENTEE_STATUS_FILTER_TO_UPSTREAM[query.status] : undefined,
          term: query.termId,
          search: escapeMentorshipSearch(query.search),
          offset: query.offset ?? 0,
          limit: Math.min(query.limit ?? MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE, MENTORSHIP_ADMIN_APPLICATIONS_MAX_LIMIT),
        }
      );
    } catch (error) {
      if (isMentorshipNotProvisionedError(error)) {
        logger.warning(req, 'mentorship_admin_get_program_mentees', 'Caller has no mentorship record; returning an empty page', { programId });
        return { data: [], total: 0 };
      }
      throw error;
    }

    const data = (upstream.data ?? []).map(mapMentorshipAdminApplicantRow);
    const total = upstream.meta?.total ?? data.length;
    logger.debug(req, 'mentorship_admin_get_program_mentees', 'Program mentees page built', { programId, count: data.length, total });
    return { data, total };
  }

  /**
   * One page of a program's mentors, from one upstream member-management read. The BFF sends no `member_type`: the
   * handler ignores it. A status this does not know reads as pending and is logged without the mentor's name.
   * A caller with no mentorship record has no mentors.
   */
  public async getProgramMentors(req: Request, programId: string, query: MentorshipAdminMentorsQuery): Promise<MentorshipAdminMentorsResponse> {
    logger.debug(req, 'mentorship_admin_get_program_mentors', 'Loading program mentors', {
      programId,
      status: query.status,
      offset: query.offset,
      limit: query.limit,
    });

    let upstream: MentorshipUpstreamListResponse<MentorshipUpstreamMemberManagementRow>;
    try {
      upstream = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamMemberManagementRow>>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/member-management`,
        'GET',
        {
          status: query.status,
          search: escapeMentorshipSearch(query.search),
          offset: query.offset ?? 0,
          limit: Math.min(query.limit ?? MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE, MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT),
        }
      );
    } catch (error) {
      if (isMentorshipNotProvisionedError(error)) {
        logger.warning(req, 'mentorship_admin_get_program_mentors', 'Caller has no mentorship record; returning an empty page', { programId });
        return { data: [], total: 0 };
      }
      throw error;
    }

    const data = (upstream.data ?? []).map((row) => {
      const { mentor, unknownStatus } = mapMentorshipAdminMentorRow(row);
      if (unknownStatus) {
        logger.warning(req, 'mentorship_admin_get_program_mentors', 'Unknown upstream member status; showing it as pending', {
          programId,
          memberId: row.id,
          status: row.status,
        });
      }
      return mentor;
    });
    const total = upstream.meta?.total ?? data.length;
    logger.debug(req, 'mentorship_admin_get_program_mentors', 'Program mentors page built', { programId, count: data.length, total });
    return { data, total };
  }

  /**
   * The people matching `search` that an admin may invite as a mentor of the program: anyone in Mentorship by name, and
   * anyone with an LF account by exact LF username or full email. Upstream returns at most 10 and never an email; a
   * missing name falls back to the LFID. The search is sent as typed: upstream escapes it for its own name and LFID
   * match and looks an email up exactly, so escaping it here would break both. Upstream's 400 (an unpublished program),
   * 403 and 503 pass through with the query cut from the error's path, since the search can be an email; a caller with
   * no mentorship record finds no one.
   */
  public async getMentorCandidates(req: Request, programId: string, search: string): Promise<MentorshipAdminMentorCandidatesResponse> {
    logger.debug(req, 'mentorship_admin_get_mentor_candidates', 'Searching mentor candidates', { programId });

    let upstream: { data?: MentorshipUpstreamMentorCandidate[] };
    try {
      upstream = await proxyMentorshipRequest<{ data?: MentorshipUpstreamMentorCandidate[] }>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/mentor-candidates`,
        'GET',
        { search }
      );
    } catch (error) {
      if (isMentorshipNotProvisionedError(error)) {
        logger.warning(req, 'mentorship_admin_get_mentor_candidates', 'Caller has no mentorship record; returning no candidates', { programId });
        return { data: [] };
      }
      throw withoutQueryInErrorPath(error);
    }

    const data = (upstream.data ?? [])
      .filter((candidate) => !!candidate.lfid)
      .map((candidate) => ({
        lfid: candidate.lfid,
        name: candidate.name?.trim() || candidate.lfid,
        avatarUrl: candidate.avatar_url || undefined,
      }));
    logger.debug(req, 'mentorship_admin_get_mentor_candidates', 'Mentor candidates found', { programId, count: data.length });
    return { data };
  }

  /** One page of a program's terms with their application counts, from one upstream term-management read. A caller with no mentorship record has no terms. */
  public async getProgramTerms(req: Request, programId: string, query: MentorshipAdminTermsQuery): Promise<MentorshipAdminTermsResponse> {
    logger.debug(req, 'mentorship_admin_get_program_terms', 'Loading program terms', { programId, offset: query.offset, limit: query.limit });

    let upstream: MentorshipUpstreamListResponse<MentorshipUpstreamTermManagementRow>;
    try {
      upstream = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamTermManagementRow>>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/term-management`,
        'GET',
        {
          offset: query.offset ?? 0,
          limit: Math.min(query.limit ?? MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE, MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT),
        }
      );
    } catch (error) {
      if (isMentorshipNotProvisionedError(error)) {
        logger.warning(req, 'mentorship_admin_get_program_terms', 'Caller has no mentorship record; returning an empty page', { programId });
        return { data: [], total: 0 };
      }
      throw error;
    }

    const data = (upstream.data ?? []).map(mapMentorshipAdminTermRow).filter((row): row is NonNullable<typeof row> => row !== null);
    const total = upstream.meta?.total ?? data.length;
    logger.debug(req, 'mentorship_admin_get_program_terms', 'Program terms page built', { programId, count: data.length, total });
    return { data, total };
  }

  /** Every task of one application, read to the end at the largest page size. Called only from the View Tasks click. */
  public async getApplicationTasks(req: Request, applicationId: string): Promise<MentorshipApplicantTask[]> {
    logger.debug(req, 'mentorship_admin_get_application_tasks', 'Loading application tasks', { applicationId });

    const tasks = await listAllMentorshipPages<MentorshipUpstreamTask>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}/tasks`,
      {},
      MENTORSHIP_ADMIN_TASKS_MAX_LIMIT
    );

    logger.debug(req, 'mentorship_admin_get_application_tasks', 'Application tasks read', { applicationId, count: tasks.length });
    return tasks.map(mapMentorshipProgramTask);
  }

  /** Accepts, declines or graduates one application. `attendanceType` rides along only with an accept. Upstream's 409 and 422 pass through. */
  public async updateApplicationStatus(req: Request, applicationId: string, body: MentorshipAdminApplicationStatusUpdate): Promise<void> {
    logger.debug(req, 'mentorship_admin_update_application_status', 'Updating application status', { applicationId, status: body.status });

    await proxyMentorshipRequest<unknown>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}/status`,
      'PATCH',
      undefined,
      { status: body.status, ...(body.status === 'accepted' ? { attendance_type: body.attendanceType } : {}) }
    );
  }

  /**
   * Saves, edits or clears (an empty `note`) the one reviewer note of an application, through the save the mentor route
   * uses too. Upstream's 403, 404 and 409 pass through. The note is never logged.
   */
  public async updateApplicationNote(req: Request, applicationId: string, note: string): Promise<void> {
    logger.debug(req, 'mentorship_admin_update_application_note', 'Saving application reviewer note', { applicationId, noteLength: note.length });
    await saveMentorshipApplicationNote(this.microserviceProxy, req, applicationId, note);
  }

  /**
   * Withdraws a mentee's application on their behalf. Upstream's withdraw-for-mentee has no status guard, so the
   * application is read first and anything other than `pending`, `hold` or `accepted` is a 409 with no write.
   */
  public async withdrawApplication(req: Request, applicationId: string): Promise<void> {
    const path = `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}`;
    logger.debug(req, 'mentorship_admin_withdraw_application', 'Checking application status before withdrawing', { applicationId });

    const application = await proxyMentorshipRequest<MentorshipUpstreamApplication>(this.microserviceProxy, req, path);
    if (!MENTORSHIP_ADMIN_WITHDRAWABLE_STATUSES.includes(application.status)) {
      logger.warning(req, 'mentorship_admin_withdraw_application', 'Application is not withdrawable, skipping the write', {
        applicationId,
        status: application.status,
      });
      throw new ConflictError(MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE, 'MENTORSHIP_ADMIN_APPLICATION_CHANGED', {
        operation: 'mentorship_admin_withdraw_application',
      });
    }

    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, `${path}/withdraw-for-mentee`, 'POST');
  }

  /**
   * Invites the LF account behind `lfid` as a mentor of the program and returns the new member's id. Upstream creates
   * the Mentorship user when there is none and emails the invite to the account's primary email. Its 400, 403, 409
   * (already invited or a mentor), 422 (no LF account) and 503 (account lookup down) pass through.
   */
  public async inviteProgramMentor(req: Request, programId: string, body: MentorshipAdminMentorInviteRequest): Promise<string | undefined> {
    logger.debug(req, 'mentorship_admin_invite_program_mentor', 'Inviting program mentor', { programId });

    const member = await proxyMentorshipRequest<{ id?: string }>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/members`,
      'POST',
      undefined,
      { lfid: body.lfid, member_type: 'mentor' }
    );
    return member?.id;
  }

  /**
   * Moves one mentor member to `active`, `declined` or `withdrawn`. Upstream checks the caller administers the program
   * and that the move is allowed from the mentor's current status; its 403, 404 and 409 pass through.
   */
  public async updateProgramMentor(req: Request, programId: string, memberId: string, body: MentorshipAdminMentorStatusUpdate): Promise<void> {
    logger.debug(req, 'mentorship_admin_update_program_mentor', 'Updating program mentor status', { programId, memberId, status: body.status });

    await proxyMentorshipRequest<unknown>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/members/${encodeURIComponent(memberId)}`,
      'PATCH',
      undefined,
      { status: body.status }
    );
  }

  /** Declines every pending application of one term. */
  public async declinePendingForTerm(req: Request, programId: string, termId: string): Promise<MentorshipAdminDeclinePendingResponse> {
    logger.debug(req, 'mentorship_admin_decline_pending_for_term', 'Declining pending applications for the term', { programId, termId });

    const result = await proxyMentorshipRequest<{ declined_count?: number }>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/terms/${encodeURIComponent(termId)}/applications/bulk-decline`,
      'POST'
    );

    const declinedCount = typeof result?.declined_count === 'number' ? result.declined_count : 0;
    logger.debug(req, 'mentorship_admin_decline_pending_for_term', 'Pending applications declined', { programId, termId, declinedCount });
    return { declinedCount };
  }

  /**
   * Creates a program from the enroll wizard. Upstream leaves it `pending`, which is awaiting review, so there is no submit
   * call. The body is already rebuilt from known fields. Upstream's 400 and 409 (a taken name or slug) pass through. Nothing in
   * the body is logged.
   */
  public async createProgram(req: Request, body: MentorshipEnrollCreateRequest): Promise<MentorshipEnrollProgramRef> {
    logger.debug(req, 'mentorship_admin_create_program', 'Creating program', { termCount: body.terms.length });

    const created = await proxyMentorshipRequest<MentorshipUpstreamCreatedProgram>(
      this.microserviceProxy,
      req,
      MENTORSHIP_PROGRAMS_PATH,
      'POST',
      undefined,
      body
    );
    return toMentorshipEnrollProgramRef(created);
  }

  /**
   * Saves the edit wizard's program fields, and its open terms when sent, with upstream's partial update, which leaves the status
   * as it is and replaces the open terms in the same transaction. The logo has its own route. Upstream's update does not check that
   * the name is free, so the BFF asks first, leaving this program out, and answers 409 with no write when another program has the
   * name. The check and the write are two calls, so two updates at once can still both pass it. Upstream's 400, 403, 404 and 409
   * (an open term left out still has applications) pass through. Nothing in the body is logged.
   */
  public async updateProgram(req: Request, programId: string, body: MentorshipEnrollUpdateRequest): Promise<MentorshipEnrollProgramRef> {
    logger.debug(req, 'mentorship_admin_update_program', 'Updating program', { programId, termCount: body.terms?.length });

    const { available } = await this.mentorshipService.isProgramNameAvailable(req, body.name, programId);
    if (!available) {
      logger.warning(req, 'mentorship_admin_update_program', 'Another program has the name, skipping the write', { programId });
      throw new ConflictError(MENTORSHIP_ENROLL_NAME_TAKEN, MENTORSHIP_PROGRAM_NAME_TAKEN_ERROR_CODE, { operation: 'mentorship_admin_update_program' });
    }

    const updated = await proxyMentorshipRequest<MentorshipUpstreamCreatedProgram>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}`,
      'PATCH',
      undefined,
      toMentorshipUpstreamProgramUpdate(body)
    );
    return toMentorshipEnrollProgramRef(updated);
  }

  /**
   * Reads the details of an existing program for the enroll wizard's import. Upstream's 403, 404 and 5xx pass through. Nothing
   * in the template is logged.
   */
  public async getEnrollTemplate(req: Request, programId: string): Promise<MentorshipEnrollImport> {
    logger.debug(req, 'mentorship_admin_get_enroll_template', 'Reading enroll template', { programId });

    const template = await proxyMentorshipRequest<MentorshipUpstreamEnrollTemplate>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/enroll-template`,
      'GET'
    );
    return toMentorshipEnrollImport(template);
  }

  /**
   * Sends a program's logo bytes on to upstream with the caller's content type. Upstream's 400, 403, 404, 409, 413, 415 and 503
   * pass through. The bytes are not logged.
   */
  public async uploadProgramLogo(req: Request, programId: string, logo: Buffer, contentType: string): Promise<MentorshipProgramLogoUploadResult> {
    logger.debug(req, 'mentorship_admin_upload_program_logo', 'Uploading program logo', { programId, sizeBytes: logo.byteLength, contentType });

    const uploaded = await proxyMentorshipRequest<MentorshipUpstreamLogoUpload>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/logo-upload`,
      'POST',
      undefined,
      logo,
      undefined,
      { 'Content-Type': contentType }
    );
    return toMentorshipProgramLogoUploadResult(uploaded);
  }

  /**
   * Creates an open term. Upstream enforces the four-open-term limit too, but the open terms are counted first so a full
   * program is refused with the limit's message and no write call. Upstream's 400, 403 and 409 pass through. The name is never logged.
   */
  public async createTerm(req: Request, programId: string, input: MentorshipAdminTermInput): Promise<MentorshipProgramTermRow> {
    logger.debug(req, 'mentorship_admin_create_term', 'Creating program term', { programId });
    await this.assertOpenTermSlot(req, programId, 'mentorship_admin_create_term');

    const created = await proxyMentorshipRequest<MentorshipUpstreamProgramTerm>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/terms`,
      'POST',
      undefined,
      { ...this.toUpstreamTermBody(input), status: 'open' }
    );
    return this.toTermRow(created, input, 'open');
  }

  /** Edits a term's name and dates. Upstream's 400, 404 and 409 (a closed term that has ended) pass through. Counts come back as 0; the page reads them again. */
  public async updateTerm(req: Request, programId: string, termId: string, input: MentorshipAdminTermInput): Promise<MentorshipProgramTermRow> {
    logger.debug(req, 'mentorship_admin_update_term', 'Updating program term', { programId, termId });

    const updated = await proxyMentorshipRequest<MentorshipUpstreamProgramTerm>(
      this.microserviceProxy,
      req,
      this.termPath(programId, termId),
      'PATCH',
      undefined,
      this.toUpstreamTermBody(input)
    );
    return this.toTermRow(updated, input, updated.status === 'closed' ? 'closed' : 'open');
  }

  /** Closes a term; upstream declines its pending applications and answers 409 while accepted ones remain. */
  public async closeTerm(req: Request, programId: string, termId: string): Promise<void> {
    logger.debug(req, 'mentorship_admin_close_term', 'Closing program term', { programId, termId });
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, `${this.termPath(programId, termId)}/close`, 'POST');
  }

  /** Re-opens a closed term, refused first (no write call) when the program already has the most open terms. */
  public async reopenTerm(req: Request, programId: string, termId: string): Promise<void> {
    logger.debug(req, 'mentorship_admin_reopen_term', 'Re-opening program term', { programId, termId });
    await this.assertOpenTermSlot(req, programId, 'mentorship_admin_reopen_term');
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, `${this.termPath(programId, termId)}/reopen`, 'POST');
  }

  /** Deletes a term; upstream answers 409 when the term has any application. */
  public async deleteTerm(req: Request, programId: string, termId: string): Promise<void> {
    logger.debug(req, 'mentorship_admin_delete_term', 'Deleting program term', { programId, termId });
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, this.termPath(programId, termId), 'DELETE');
  }

  private termPath(programId: string, termId: string): string {
    return `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/terms/${encodeURIComponent(termId)}`;
  }

  /**
   * Throws a 409 with the limit's message when the program already has `MENTORSHIP_MAX_OPEN_TERMS` open terms. The count
   * and the write are two calls, so two writes at once can both pass it: upstream's own limit stays the source of truth.
   */
  private async assertOpenTermSlot(req: Request, programId: string, operation: string): Promise<void> {
    const open = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamProgramTerm>>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/terms`,
      'GET',
      { status: 'open', offset: 0, limit: MENTORSHIP_MAX_OPEN_TERMS }
    );
    const openCount = open.meta?.total ?? (open.data ?? []).length;
    if (openCount >= MENTORSHIP_MAX_OPEN_TERMS) {
      logger.warning(req, operation, 'Program already has the most open terms, skipping the write', { programId, openCount });
      throw new ConflictError(MENTORSHIP_MAX_OPEN_TERMS_MESSAGE, 'MENTORSHIP_MAX_OPEN_TERMS', { operation });
    }
  }

  /**
   * The term routes' body: the name and the dates as `toMentorshipUpstreamTermDates` sends them, the term end first moved to the last
   * day of its month: the dialog picks months, and the UI treats a term as running through its end month.
   */
  private toUpstreamTermBody(input: MentorshipAdminTermInput): Record<string, string> {
    return { name: input.name, ...toMentorshipUpstreamTermDates({ ...input, endDate: lastDayOfMentorshipMonth(input.endDate) }) };
  }

  /** Maps upstream's answer to a write; a status missing or one the table can't show falls back to `fallbackStatus`, the rest to the input. */
  private toTermRow(term: MentorshipUpstreamProgramTerm, input: MentorshipAdminTermInput, fallbackStatus: MentorshipTermRowStatus): MentorshipProgramTermRow {
    const row = mapMentorshipAdminTermRow({
      ...term,
      status: term.status ?? fallbackStatus,
      pending: 0,
      declined: 0,
      accepted: 0,
      graduated: 0,
    } as MentorshipUpstreamTermManagementRow);
    return (
      row ?? {
        id: term.id,
        name: input.name,
        status: fallbackStatus,
        pending: 0,
        declined: 0,
        accepted: 0,
        graduated: 0,
        startDate: input.startDate,
        endDate: input.endDate,
        applicationStartDate: input.applicationStartDate,
        applicationEndDate: input.applicationEndDate,
      }
    );
  }
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
