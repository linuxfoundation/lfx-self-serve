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
  MentorshipUpstreamTask,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  MENTORSHIP_APPLICATIONS_PATH,
  MENTORSHIP_LIST_MAX_PAGES,
  MENTORSHIP_LIST_PAGE_SIZE,
  MENTORSHIP_ME_APPLICATIONS_PATH,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY,
  MENTORSHIP_MENTEE_TASK_TRACKED_STATUSES,
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
   * With `withTasks`, the tasks of each pending, accepted or graduated application are listed a
   * few applications at a time, and a task failure propagates, since the task views would otherwise show wrong progress. Past
   * applications only show their outcome, so their tasks are not read. The program and its LF
   * project come embedded on each application, so no program is read.
   */
  public async getMenteeApplications(req: Request, withTasks: boolean): Promise<MentorshipMenteeApplicationsResponse> {
    logger.debug(req, 'mentorship_get_mentee_applications', 'Loading mentee applications', { withTasks });
    const applications = await this.listMenteeApplications(req);
    const tasksByApplication: (MentorshipUpstreamTask[] | undefined)[] = [];
    for (let start = 0; start < applications.length; start += MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY) {
      const batch = applications.slice(start, start + MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY);
      tasksByApplication.push(
        ...(await Promise.all(
          batch.map((application) =>
            withTasks && MENTORSHIP_MENTEE_TASK_TRACKED_STATUSES.includes(application.status) ? this.listApplicationTasks(req, application.id) : undefined
          )
        ))
      );
    }

    const data = applications.map((application, index) => mapMentorshipMenteeApplication(application, tasksByApplication[index]));
    logger.debug(req, 'mentorship_get_mentee_applications', 'Mentee applications loaded', {
      count: data.length,
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
   * (linuxfoundation/lfx-mentorship#187). A failed profile read propagates; a failed applications
   * read logs a warning and leaves the history empty, since the apply page reads this profile too
   * and never shows the history.
   */
  public async getMenteeProfile(req: Request): Promise<MentorshipMenteeProfileResponse> {
    logger.debug(req, 'mentorship_get_mentee_profile', 'Loading mentee profile');
    const [[profile], applications] = await Promise.all([this.listMenteeProfiles(req), this.listMenteeApplicationsForHistory(req)]);
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

  /** The caller's applications for the profile's history, or none when the read fails. */
  private async listMenteeApplicationsForHistory(req: Request): Promise<MentorshipUpstreamApplication[]> {
    try {
      return await this.listMenteeApplications(req);
    } catch (error) {
      logger.warning(req, 'mentorship_get_mentee_profile', 'Failed to load mentee applications, leaving the history empty', { err: error });
      return [];
    }
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
   * Reads an upstream list to the end at the largest page size, stopping once the rows read reach
   * the reported total, a page comes back empty, or the page carries no usable total. A list still
   * going after `MENTORSHIP_LIST_MAX_PAGES` pages logs a warning and returns the rows read so far.
   */
  private async listAllPages<T>(req: Request, path: string, query: Record<string, unknown> = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 0; page < MENTORSHIP_LIST_MAX_PAGES; page++) {
      const { data, meta } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<T>>(this.microserviceProxy, req, path, 'GET', {
        ...query,
        limit: MENTORSHIP_LIST_PAGE_SIZE,
        offset: items.length,
      });
      const rows = data ?? [];
      items.push(...rows);
      const total = meta?.total;
      if (rows.length === 0 || typeof total !== 'number' || !Number.isFinite(total) || items.length >= total) {
        return items;
      }
    }
    logger.warning(req, 'mentorship_list_all_pages', 'Upstream list exceeded the page cap, returning the rows read so far', {
      path,
      max_pages: MENTORSHIP_LIST_MAX_PAGES,
      count: items.length,
    });
    return items;
  }

  /** Programs resolve by id (default) or slug, matching `/mentorship/admin/:programId`. */
  private findProgram(programId: string): MentorshipProgram | undefined {
    return findByIdOrSlug(MOCK_MENTORSHIP_PROGRAMS, programId);
  }
}
