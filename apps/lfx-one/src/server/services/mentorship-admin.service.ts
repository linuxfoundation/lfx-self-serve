// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_PROGRAM_STATUSES,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsQuery,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminProgramTabCounts,
  MentorshipAdminTermOption,
  MentorshipAdminTermsQuery,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipTermRowStatus,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamApplication,
  MentorshipUpstreamListResponse,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramManagementSummary,
  MentorshipUpstreamProgramTerm,
  MentorshipUpstreamTask,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  MENTORSHIP_ADMIN_APPLICATIONS_MAX_LIMIT,
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
import { isMentorshipNotProvisionedError, listAllMentorshipPages, proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { escapeMentorshipSearch } from '../helpers/mentorship-params.helper';
import { mapMentorshipAdminApplicantRow, mapMentorshipProgramTask } from '../helpers/mentorship-program-application.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** The program admin screens behind `/api/mentorship/admin`. */
export class MentorshipAdminService {
  private readonly microserviceProxy = new MicroserviceProxyService();

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
          status: query.status,
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
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
