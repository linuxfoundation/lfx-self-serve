// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE,
  EMPTY_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAM_LISTS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeProfileResponse,
  MentorshipProgram,
  MentorshipUpstreamApplication,
  MentorshipUpstreamListResponse,
  MentorshipUpstreamProgramDetail,
  MentorshipUpstreamTask,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  MENTORSHIP_APPLICATIONS_PATH,
  MENTORSHIP_LIST_PAGE_SIZE,
  MENTORSHIP_ME_APPLICATIONS_PATH,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_PROGRAMS_PATH,
} from '../constants';
import { ResourceNotFoundError } from '../errors';
import { proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { mapMentorshipMenteeApplication, mapMentorshipMenteeApplicationHistory } from '../helpers/mentorship-mentee-application.helper';
import { mapMentorshipMenteeProfile } from '../helpers/mentorship-mentee-profile.helper';
import { findByIdOrSlug } from '../helpers/mentorship-params.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * BFF for the mentee pages at `/mentorship/mentee/*`. The profile and application reads call
 * the mentorship service; the apply target still serves mock data and moves to it under
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

  /**
   * The signed-in user's mentee applications. Upstream lists only the caller's own rows, off
   * their token. Every page is read: a mentee holds a handful of applications, so paging to the
   * end costs one request in practice and keeps the overview counts complete.
   *
   * With `withTasks`, each application's tasks are listed in parallel, and a task failure
   * propagates, since the task views would otherwise show wrong progress. Each distinct program
   * is read once for its LF project, which applications do not embed; a failed program read
   * logs a warning and leaves the project out, so the card falls back to the program name.
   */
  public async getMenteeApplications(req: Request, withTasks: boolean): Promise<MentorshipMenteeApplicationsResponse> {
    logger.debug(req, 'mentorship_get_mentee_applications', 'Loading mentee applications', { withTasks });
    const applications = await this.listMenteeApplications(req);

    const programIds = [...new Set(applications.map((application) => application.program?.id).filter((id): id is string => !!id))];
    const [tasksByApplication, programs] = await Promise.all([
      withTasks ? Promise.all(applications.map((application) => this.listApplicationTasks(req, application.id))) : Promise.resolve(applications.map(() => [])),
      Promise.all(programIds.map((programId) => this.findProgramDetail(req, programId))),
    ]);
    const programsById = new Map(programs.filter((program): program is MentorshipUpstreamProgramDetail => !!program).map((program) => [program.id, program]));

    const data = applications.map((application, index) =>
      mapMentorshipMenteeApplication(application, tasksByApplication[index], application.program ? programsById.get(application.program.id) : undefined)
    );
    logger.debug(req, 'mentorship_get_mentee_applications', 'Mentee applications loaded', {
      count: data.length,
      programs_resolved: programsById.size,
      programs_requested: programIds.length,
    });
    return { data, total: data.length };
  }

  /**
   * The signed-in user's mentee profile and application history. Upstream lists only the
   * caller's own rows, off their token, so no other user's profile is reachable from here. A
   * user has at most one profile, so the read asks for `limit: 1`, the same as the has-profile
   * check. The history comes from the caller's applications, which embed the program and term
   * names it shows, so it needs no task or program reads.
   *
   * An empty list returns an empty profile rather than an error: the apply page is reachable
   * straight after registering, and registration does not save a profile yet
   * (linuxfoundation/lfx-mentorship#187). Any failure propagates.
   */
  public async getMenteeProfile(req: Request): Promise<MentorshipMenteeProfileResponse> {
    logger.debug(req, 'mentorship_get_mentee_profile', 'Loading mentee profile');
    const [[profile], applications] = await Promise.all([this.listMenteeProfiles(req), this.listMenteeApplications(req)]);
    const history = mapMentorshipMenteeApplicationHistory(applications);
    if (!profile) {
      logger.debug(req, 'mentorship_get_mentee_profile', 'No mentee profile for the signed-in user, returning an empty profile', {
        history_count: history.length,
      });
      return { ...EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE, history };
    }

    const response: MentorshipMenteeProfileResponse = { ...mapMentorshipMenteeProfile(profile), history };
    logger.debug(req, 'mentorship_get_mentee_profile', 'Mentee profile loaded', {
      has_demographics: response.demographics !== undefined,
      history_count: history.length,
    });
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

  /** The caller's own mentee applications, every page. */
  private listMenteeApplications(req: Request): Promise<MentorshipUpstreamApplication[]> {
    return this.listAllPages<MentorshipUpstreamApplication>(req, MENTORSHIP_ME_APPLICATIONS_PATH, { role: 'mentee' });
  }

  /** Every task on one of the caller's applications; upstream lets an applicant list their own. */
  private listApplicationTasks(req: Request, applicationId: string): Promise<MentorshipUpstreamTask[]> {
    return this.listAllPages<MentorshipUpstreamTask>(req, `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}/tasks`);
  }

  /**
   * A program's detail, for the LF project applications do not embed. A failure, such as a
   * program hidden since the mentee applied, returns `undefined` so the card falls back to the
   * program name.
   */
  private async findProgramDetail(req: Request, programId: string): Promise<MentorshipUpstreamProgramDetail | undefined> {
    try {
      return await proxyMentorshipRequest<MentorshipUpstreamProgramDetail>(
        this.microserviceProxy,
        req,
        `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}`
      );
    } catch (error) {
      logger.warning(req, 'mentorship_get_mentee_applications', 'Failed to load program detail, leaving the project out', {
        program_id: programId,
        err: error,
      });
      return undefined;
    }
  }

  /**
   * Reads an upstream list to the end at the largest page size, stopping once the rows read reach
   * the reported total or a page comes back empty.
   */
  private async listAllPages<T>(req: Request, path: string, query: Record<string, unknown> = {}): Promise<T[]> {
    const items: T[] = [];
    for (;;) {
      const { data, meta } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<T>>(this.microserviceProxy, req, path, 'GET', {
        ...query,
        limit: MENTORSHIP_LIST_PAGE_SIZE,
        offset: items.length,
      });
      items.push(...data);
      if (data.length === 0 || items.length >= meta.total) {
        return items;
      }
    }
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return findByIdOrSlug(MOCK_MENTORSHIP_PROGRAMS, programId);
  }
}
