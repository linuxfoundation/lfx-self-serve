// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE,
  MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeRegisterRequest,
  MentorshipMenteeProfileUpdateRequest,
  MentorshipMenteeProfileUpdateResponse,
  MentorshipMenteeUpdatableTaskStatus,
  MentorshipUpstreamApplication,
  MentorshipUpstreamListResponse,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramTerm,
  MentorshipUpstreamTask,
  MentorshipUpstreamTaskSubmissionUpdate,
  MentorshipUpstreamUserProfile,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  MENTORSHIP_APPLICATIONS_PATH,
  MENTORSHIP_LIST_MAX_PAGES,
  MENTORSHIP_LIST_PAGE_SIZE,
  MENTORSHIP_ME_APPLICATIONS_PATH,
  MENTORSHIP_ME_MENTEE_PROFILE_PATH,
  MENTORSHIP_ME_PROFILES_PATH,
  MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY,
  MENTORSHIP_MENTEE_TASK_TRACKED_STATUSES,
  MENTORSHIP_PROGRAMS_PATH,
  MENTORSHIP_TASKS_PATH,
} from '../constants';
import { ConflictError } from '../errors';
import { proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import {
  mapMentorshipMenteeApplication,
  mapMentorshipMenteeApplicationHistory,
  mapMentorshipMenteeApplyTarget,
} from '../helpers/mentorship-mentee-application.helper';
import { mapMentorshipMenteeProfile } from '../helpers/mentorship-mentee-profile.helper';
import { buildMentorshipUpstreamMenteeProfile } from '../helpers/mentorship-mentee-register.helper';
import { buildMentorshipUpstreamMenteeProfileUpdate } from '../helpers/mentorship-mentee-profile-update.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** BFF for the mentee pages at `/mentorship/mentee/*`. Every read and write calls the mentorship service with the caller's token. */
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
   * Creates the signed-in user's mentee profile. Upstream's `PUT` is an upsert that replaces every
   * column, so a second registration would wipe the first one's answers; the caller's own mentee
   * rows are listed first and an existing profile is refused with a 409 the register page reads.
   * A failed check propagates rather than falling through to the write. Upstream's own 400, 403
   * and 422 also pass through. The check and the write are two requests, so two simultaneous
   * registrations by the same user can both pass the check; the later write wins.
   */
  public async registerMenteeProfile(req: Request, request: MentorshipMenteeRegisterRequest): Promise<void> {
    logger.debug(req, 'mentorship_register_mentee_profile', 'Checking for an existing mentee profile');
    if ((await this.listMenteeProfiles(req)).length > 0) {
      throw new ConflictError(MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS, MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE, {
        operation: 'mentorship_register_mentee_profile',
      });
    }

    const body = buildMentorshipUpstreamMenteeProfile(request);
    logger.debug(req, 'mentorship_register_mentee_profile', 'Creating mentee profile', { has_demographics: body.demographics !== undefined });
    await proxyMentorshipRequest<unknown>(this.microserviceProxy, req, MENTORSHIP_ME_MENTEE_PROFILE_PATH, 'PUT', undefined, body);
    logger.debug(req, 'mentorship_register_mentee_profile', 'Mentee profile created');
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
   * Withdraws one of the signed-in user's applications. The request has no body; upstream moves
   * only a pending application to `withdrawn` and returns the updated application. Its 403 (not
   * the applicant), 404 and 409 (no longer pending) propagate so the page can say why and re-read.
   * The returned application carries no program or term, so it is dropped and the page re-reads
   * its applications instead.
   */
  public async withdrawMenteeApplication(req: Request, applicationId: string): Promise<void> {
    logger.debug(req, 'mentorship_withdraw_mentee_application', 'Withdrawing mentee application', { applicationId });
    await proxyMentorshipRequest<MentorshipUpstreamApplication>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}/withdraw`,
      'POST'
    );
    logger.debug(req, 'mentorship_withdraw_mentee_application', 'Mentee application withdrawn', { applicationId });
  }

  /**
   * Changes the status of one of the signed-in user's tasks through the assignee route,
   * `PATCH /tasks/{id}/submission`. The body is only the status: upload is not wired, so `file` is never
   * sent, and upstream checks a required file against the one already stored on the task. Its 400 (a
   * required file is missing), 403 (the gateway or the service refuses a non-assignee; the assignee grant
   * is written asynchronously, so a fresh task can briefly answer 403), 404 and 409 (not a legal move
   * from the task's status) propagate so the row can say why. The returned task is dropped and the pages
   * re-read their applications instead.
   */
  public async updateMenteeTaskStatus(req: Request, taskId: string, status: MentorshipMenteeUpdatableTaskStatus): Promise<void> {
    logger.debug(req, 'mentorship_update_mentee_task_status', 'Updating mentee task status', { taskId, status });
    const body: MentorshipUpstreamTaskSubmissionUpdate = { status };
    await proxyMentorshipRequest<MentorshipUpstreamTask>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_TASKS_PATH}/${encodeURIComponent(taskId)}/submission`,
      'PATCH',
      undefined,
      body
    );
    logger.debug(req, 'mentorship_update_mentee_task_status', 'Mentee task status updated', { taskId, status });
  }

  /**
   * The signed-in user's mentee profile and application history. Upstream lists only the
   * caller's own rows, off their token, so no other user's profile is reachable from here. A
   * user has at most one profile, so the read asks for `limit: 1`, the same as the has-profile
   * check. The history comes from the caller's applications, which embed the program and term
   * names it shows, so it needs no task or program reads.
   *
   * An empty list returns an empty profile rather than an error: the apply page is reachable
   * before a profile exists, and it reads the profile that `POST /api/mentorship/mentee/profile`
   * writes. A failed profile read propagates; a failed applications
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
   * Saves the changed groups of the signed-in user's mentee profile. Upstream keeps every column the body
   * omits and replaces a JSON column whole, so only the groups the caller changed are forwarded, and never
   * `profile_links` (the resume is not editable yet). When a JSON column is among them, the stored row is
   * read first and each column is layered over its stored value, so keys this BFF does not model survive;
   * a failed read propagates rather than risk dropping them. The two calls are not atomic, so an edit made
   * elsewhere in between can be overwritten. The response is the re-mapped row: no history, since the caller
   * layers it over the profile it already has. Upstream's 404 (no mentee profile) and 409 (more than one)
   * propagate.
   */
  public async updateMenteeProfile(req: Request, request: MentorshipMenteeProfileUpdateRequest): Promise<MentorshipMenteeProfileUpdateResponse> {
    // Group names only: the values are personal data.
    logger.debug(req, 'mentorship_update_mentee_profile', 'Updating mentee profile', { changed_groups: Object.keys(request) });
    const writesJsonColumn = request.skillSet !== undefined || request.demographics !== undefined || request.socioeconomics !== undefined;
    const [stored] = writesJsonColumn ? await this.listMenteeProfiles(req) : [];
    const upstream = await proxyMentorshipRequest<MentorshipUpstreamUserProfile>(
      this.microserviceProxy,
      req,
      MENTORSHIP_ME_MENTEE_PROFILE_PATH,
      'PATCH',
      undefined,
      buildMentorshipUpstreamMenteeProfileUpdate(request, stored)
    );
    const { profile, demographics } = mapMentorshipMenteeProfile(upstream);
    logger.debug(req, 'mentorship_update_mentee_profile', 'Mentee profile updated', { has_demographics: demographics !== undefined });
    return { profile, demographics };
  }

  /**
   * Header fields for the mentee apply page, from the program and the term read in parallel. The
   * term read 404s when the term is not in that program, is deleted, or the program is not visible
   * to the caller; that and any other failure propagate so the page can say why. Only the program
   * and term names are read, never the program's applicants.
   */
  public async getMenteeApplyTarget(req: Request, programId: string, programTermId: string): Promise<MentorshipMenteeApplyTarget> {
    logger.debug(req, 'mentorship_get_mentee_apply_target', 'Resolving mentee apply target', { programId, programTermId });
    const programPath = `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}`;
    const [program, term] = await Promise.all([
      proxyMentorshipRequest<MentorshipUpstreamProgram>(this.microserviceProxy, req, programPath),
      proxyMentorshipRequest<MentorshipUpstreamProgramTerm>(this.microserviceProxy, req, `${programPath}/terms/${encodeURIComponent(programTermId)}`),
    ]);

    const target = mapMentorshipMenteeApplyTarget(program, term, new Date());
    logger.debug(req, 'mentorship_get_mentee_apply_target', 'Mentee apply target resolved', {
      programId,
      programTermId,
      termStatus: term.status,
      acceptingApplications: target.acceptingApplications,
    });
    return target;
  }

  /**
   * Applies the signed-in user to a program term as a mentee. Upstream takes the applicant from the
   * token, so the body carries only the role. Its 422 (the term is not taking applications), 409
   * (the user already has an application for the term) and 404 (the term is not in the program)
   * propagate so the page can say why. The created application carries no program or term, so it is
   * dropped and the pages re-read the applications instead.
   */
  public async applyToMenteeTerm(req: Request, programId: string, programTermId: string): Promise<void> {
    logger.debug(req, 'mentorship_apply_to_mentee_term', 'Applying to mentee term', { programId, programTermId });
    await proxyMentorshipRequest<MentorshipUpstreamApplication>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_PROGRAMS_PATH}/${encodeURIComponent(programId)}/terms/${encodeURIComponent(programTermId)}/applications`,
      'POST',
      undefined,
      { role: 'mentee' }
    );
    logger.debug(req, 'mentorship_apply_to_mentee_term', 'Applied to mentee term', { programId, programTermId });
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
}
