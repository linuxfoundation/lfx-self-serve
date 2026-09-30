// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_MENTOR_PROGRAM_LISTS,
  getMockMentorshipMentorProgramLists,
  getMockMentorshipMentorPrograms,
  MOCK_MENTORSHIP_MENTOR_PROFILE,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorProfileResponse,
  MentorshipMentorProgram,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramsResponse,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipMentorProgramDetail } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';

/** BFF for the mentor pages at `/mentorship/mentor/*`. Every read still serves the shared mock seed data. */
export class MentorshipMentorService {
  public async getMentorPrograms(req: Request): Promise<MentorshipMentorProgramsResponse> {
    logger.debug(req, 'mentorship_get_mentor_programs', 'Loading mentor programs');
    const data = getMockMentorshipMentorPrograms().map((program) => ({ ...program }));
    logger.debug(req, 'mentorship_get_mentor_programs', 'Mentor programs loaded', { count: data.length });
    return { data, total: data.length };
  }

  public async getMentorProfile(req: Request): Promise<MentorshipMentorProfileResponse> {
    logger.debug(req, 'mentorship_get_mentor_profile', 'Loading mentor profile');
    const response: MentorshipMentorProfileResponse = {
      profile: { ...MOCK_MENTORSHIP_MENTOR_PROFILE.profile, skills: [...MOCK_MENTORSHIP_MENTOR_PROFILE.profile.skills] },
      history: MOCK_MENTORSHIP_MENTOR_PROFILE.history.map((entry) => ({ ...entry })),
    };
    logger.debug(req, 'mentorship_get_mentor_profile', 'Mentor profile loaded', { history_count: response.history.length });
    return response;
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

  /** Mentor programs resolve by id (default) or slug, matching `/mentorship/mentor/programs/:programId`. */
  private findMentorProgram(programId: string): MentorshipMentorProgram | undefined {
    return findByIdOrSlug(getMockMentorshipMentorPrograms(), programId);
  }
}
