// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MENTORSHIP_PROGRAM_STATUSES,
  MOCK_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import {
  MentorshipProgram,
  MentorshipProgramDetail,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamListResponse,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipProgramDetail } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MENTORSHIP_ME_PROGRAMS_PATH } from '../constants';
import { ResourceNotFoundError } from '../errors';
import { mapMentorshipAdminProgram } from '../helpers/mentorship-admin-program.helper';
import { isMentorshipNotProvisionedError, proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { escapeMentorshipSearch, findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Read-only mock seed data for the program detail, which is not wired to the upstream
 * mentorship-service yet. The programs list reads upstream.
 */
const mockPrograms: readonly MentorshipProgram[] = MOCK_MENTORSHIP_PROGRAMS.map((program) => ({ ...program }));

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

  public async getProgram(req: Request, programId: string): Promise<MentorshipProgramDetail> {
    logger.debug(req, 'mentorship_admin_get_program', 'Resolving mentorship program', { programId });
    const program = this.findProgram(programId);
    if (!program) {
      throw new ResourceNotFoundError('Mentorship program', programId, { operation: 'mentorship_admin_get_program' });
    }

    const lists = MOCK_MENTORSHIP_PROGRAM_LISTS[program.slug] ?? EMPTY_MENTORSHIP_PROGRAM_LISTS;
    const detail = buildMentorshipProgramDetail(program, lists);
    logger.debug(req, 'mentorship_admin_get_program', 'Mentorship program detail built', { programId, slug: program.slug, tabCounts: detail.tabCounts });
    return detail;
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return findByIdOrSlug(mockPrograms, programId);
  }
}

export function isMentorshipProgramStatus(value: unknown): value is MentorshipProgramStatus {
  return typeof value === 'string' && (MENTORSHIP_PROGRAM_STATUSES as readonly string[]).includes(value);
}
