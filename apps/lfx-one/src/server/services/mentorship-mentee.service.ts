// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE,
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY,
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
  MentorshipUpstreamListResponse,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MENTORSHIP_ME_PROFILES_PATH } from '../constants';
import { ResourceNotFoundError } from '../errors';
import { proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { mapMentorshipMenteeProfile } from '../helpers/mentorship-mentee-profile.helper';
import { findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * BFF for the mentee pages at `/mentorship/mentee/*`. The profile reads call the mentorship
 * service; the remaining endpoints still serve mock data and move to it under
 * linuxfoundation/lfx-mentorship#184.
 */
export class MentorshipMenteeService {
  private readonly microserviceProxy = new MicroserviceProxyService();

  /**
   * Whether the signed-in user has a mentee profile. A user has at most one, so the check
   * lists the caller's own mentee rows with `limit: 1` and reports whether one came back.
   * A failure propagates so it is logged and reported with its real status; the frontend
   * treats any failed check as "no profile" and shows the register page.
   */
  public async hasMenteeProfile(req: Request): Promise<MentorshipMenteeHasProfileResponse> {
    logger.debug(req, 'mentorship_has_mentee_profile', 'Checking mentee profile existence');
    const hasProfile = (await this.listMenteeProfiles(req)).length > 0;
    logger.debug(req, 'mentorship_has_mentee_profile', 'Mentee profile existence checked', { hasProfile });
    return { hasProfile };
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
   * The signed-in user's mentee profile. Upstream lists only the caller's own rows, off their
   * token, so no other user's profile is reachable from here. A user has at most one, so the
   * read asks for `limit: 1`, the same as the has-profile check.
   *
   * An empty list returns an empty profile rather than an error: the apply page is reachable
   * straight after registering, and registration does not save a profile yet
   * (linuxfoundation/lfx-mentorship#187). Any failure propagates.
   */
  public async getMenteeProfile(req: Request): Promise<MentorshipMenteeProfileResponse> {
    logger.debug(req, 'mentorship_get_mentee_profile', 'Loading mentee profile');
    const [profile] = await this.listMenteeProfiles(req);
    if (!profile) {
      logger.debug(req, 'mentorship_get_mentee_profile', 'No mentee profile for the signed-in user, returning an empty profile');
      return EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE;
    }

    const response = mapMentorshipMenteeProfile(profile);
    logger.debug(req, 'mentorship_get_mentee_profile', 'Mentee profile loaded', { has_demographics: response.demographics !== undefined });
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

  /** The caller's own mentee `user_profiles` rows; at most one, since a user has one mentee profile. */
  private async listMenteeProfiles(req: Request): Promise<MentorshipUpstreamUserProfile[]> {
    const { data } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<MentorshipUpstreamUserProfile>>(
      this.microserviceProxy,
      req,
      MENTORSHIP_ME_PROFILES_PATH,
      'GET',
      { profile_type: 'mentee', limit: 1 }
    );
    return data;
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return findByIdOrSlug(MOCK_MENTORSHIP_PROGRAMS, programId);
  }
}
