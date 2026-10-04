// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MENTORSHIP_PROGRAM_STATUSES,
  MOCK_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import { MentorshipProgram, MentorshipProgramDetail, MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { buildMentorshipProgramDetail } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { findByIdOrSlug, paginateOffsetLimit } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';

const DEFAULT_PROGRAM_LIMIT = 50;

/**
 * Read-only mock seed data — the admin list has data to show while the upstream
 * mentorship-service is not yet wired. No writes; enrollment shows a coming-soon
 * toast instead.
 */
const mockPrograms: readonly MentorshipProgram[] = MOCK_MENTORSHIP_PROGRAMS.map((program) => ({ ...program }));

/** The program admin screens behind `/api/mentorship/admin`. */
export class MentorshipAdminService {
  public async getPrograms(
    req: Request,
    options: { search?: string; status?: MentorshipProgramStatus; offset?: number; limit?: number } = {}
  ): Promise<MentorshipProgramsResponse> {
    logger.debug(req, 'mentorship_admin_get_programs', 'Filtering mentorship programs', options);

    let filtered: readonly MentorshipProgram[] = mockPrograms;
    if (options.status) {
      filtered = filtered.filter((p) => p.status === options.status);
    }
    if (options.search) {
      const needle = options.search.trim().toLowerCase();
      if (needle) {
        filtered = filtered.filter((p) => p.name.toLowerCase().includes(needle) || p.projectName.toLowerCase().includes(needle));
      }
    }

    const page = paginateOffsetLimit(filtered, options.offset ?? 0, options.limit ?? DEFAULT_PROGRAM_LIMIT);
    logger.debug(req, 'mentorship_admin_get_programs', 'Mentorship programs page built', { count: page.data.length, total: page.total });

    return page;
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
