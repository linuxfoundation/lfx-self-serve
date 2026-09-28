// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY,
  MOCK_MENTORSHIP_MENTEE_PROFILE,
  MOCK_MENTORSHIP_MENTEE_TASKS,
  MOCK_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePhase,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeTasksResponse,
  MentorshipProgram,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';

/**
 * BFF for the mentee pages at `/mentorship/mentee/*`. Still serves mock data; each endpoint
 * moves to the mentorship service under linuxfoundation/lfx-mentorship#184.
 */
export class MentorshipMenteeService {
  /**
   * Mock — always returns `false` so the guard falls through to the register page.
   * When the real profiles endpoint lands, this calls it and returns `true` if
   * the signed-in user already has a mentee profile.
   */
  public async hasMenteeProfile(req: Request): Promise<MentorshipMenteeHasProfileResponse> {
    logger.debug(req, 'mentorship_has_mentee_profile', 'Checking mentee profile existence (mock: false)');
    return { hasProfile: false };
  }

  public async getMenteeOverview(req: Request, phase?: MentorshipMenteePhase): Promise<MentorshipMenteeOverviewResponse> {
    logger.debug(req, 'mentorship_get_mentee_overview', 'Loading mentee overview', { phase: phase ?? 'applicant (default)' });

    const mocks: Record<MentorshipMenteePhase, MentorshipMenteeOverviewResponse> = {
      empty: MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY,
      applicant: MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
      accepted: MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED,
    };

    const response = mocks[phase ?? 'applicant'];
    logger.debug(req, 'mentorship_get_mentee_overview', 'Mentee overview loaded', { phase: response.phase });
    return response;
  }

  public async getMenteeTasks(req: Request): Promise<MentorshipMenteeTasksResponse> {
    logger.debug(req, 'mentorship_get_mentee_tasks', 'Loading mentee tasks');
    const response: MentorshipMenteeTasksResponse = {
      data: MOCK_MENTORSHIP_MENTEE_TASKS.data.map((task) => ({ ...task })),
      total: MOCK_MENTORSHIP_MENTEE_TASKS.total,
    };
    logger.debug(req, 'mentorship_get_mentee_tasks', 'Mentee tasks loaded', { count: response.data.length });
    return response;
  }

  /**
   * Mock BFF until the Mentorship `user_profiles` read is wired. Authenticated, but not
   * scoped to `req`'s user — identity filtering is tracked with that real read
   * (linuxfoundation/lfx-self-serve#2764). Do not invent authorization here.
   */
  public async getMenteeProfile(req: Request): Promise<MentorshipMenteeProfileResponse> {
    logger.debug(req, 'mentorship_get_mentee_profile', 'Loading mentee profile');
    const response: MentorshipMenteeProfileResponse = {
      profile: {
        ...MOCK_MENTORSHIP_MENTEE_PROFILE.profile,
        skillsHave: [...MOCK_MENTORSHIP_MENTEE_PROFILE.profile.skillsHave],
        skillsWant: [...MOCK_MENTORSHIP_MENTEE_PROFILE.profile.skillsWant],
      },
      history: MOCK_MENTORSHIP_MENTEE_PROFILE.history.map((entry) => ({ ...entry })),
      demographics: MOCK_MENTORSHIP_MENTEE_PROFILE.demographics ? { ...MOCK_MENTORSHIP_MENTEE_PROFILE.demographics } : undefined,
    };
    logger.debug(req, 'mentorship_get_mentee_profile', 'Mentee profile loaded', { history_count: response.history.length });
    return response;
  }

  /**
   * Header fields for the mentee apply page. Resolves the program the same way the
   * admin detail does (id, then slug) and the term against that program's term rows.
   * Does not return the admin lists — those include other applicants.
   */
  public async getMenteeApplyTarget(req: Request, programId: string, programTermId: string): Promise<MentorshipMenteeApplyTarget> {
    logger.debug(req, 'mentorship_get_mentee_apply_target', 'Resolving mentee apply target', { programId, programTermId });
    const program = this.findProgram(programId);
    if (!program) {
      throw new ResourceNotFoundError('Mentorship program', programId, { operation: 'mentorship_get_mentee_apply_target' });
    }

    const lists = MOCK_MENTORSHIP_PROGRAM_LISTS[program.slug] ?? EMPTY_MENTORSHIP_PROGRAM_LISTS;
    const term = lists.terms.find((item) => item.id === programTermId);
    if (!term) {
      throw new ResourceNotFoundError('Mentorship program term', programTermId, { operation: 'mentorship_get_mentee_apply_target' });
    }

    const target: MentorshipMenteeApplyTarget = {
      programName: program.name,
      projectName: program.projectName,
      termName: term.name,
    };
    logger.debug(req, 'mentorship_get_mentee_apply_target', 'Mentee apply target resolved', {
      programName: target.programName,
      projectName: target.projectName,
      termName: target.termName,
    });
    return target;
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return findByIdOrSlug(MOCK_MENTORSHIP_PROGRAMS, programId);
  }
}
