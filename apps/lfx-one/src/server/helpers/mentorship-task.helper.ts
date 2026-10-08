// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_APPLICANT_TASK_STATUSES,
  MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS,
  MENTORSHIP_TASK_DESCRIPTION_MAX,
  MENTORSHIP_TASK_NAME_MAX,
} from '@lfx-one/shared/constants';
import {
  MentorshipApplicantTaskStatus,
  MentorshipTaskCreateRequest,
  MentorshipTaskCreateResponse,
  MentorshipTaskUpdate,
  MentorshipUpstreamApplication,
  MentorshipUpstreamTask,
  MentorshipUpstreamTaskCreate,
  MentorshipUpstreamTaskUpdate,
} from '@lfx-one/shared/interfaces';
import { isMentorshipIsoDate, isUuid } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MENTORSHIP_APPLICATIONS_PATH, MENTORSHIP_TASK_CREATE_CONCURRENCY, MENTORSHIP_TASK_STATUS_TO_UPSTREAM } from '../constants';
import { BaseApiError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { proxyMentorshipRequest, readMentorshipLocalUserId } from './mentorship-api.helper';
import { parseTrimmedString } from './mentorship-params.helper';

const parseRequiredText = (value: unknown, field: string, max: number, operation: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw ServiceValidationError.forField(field, `${field} is required`, { operation });
  }
  if (text.length > max) {
    throw ServiceValidationError.forField(field, `${field} must be at most ${max} characters`, { operation });
  }
  return text;
};

/**
 * Reads the body of the task create (`POST /api/mentorship/tasks`, from the admin and mentor pages) with the rules
 * the task dialog uses: one to
 * `MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS` application UUIDs (a repeat is dropped), a name and a
 * description that are required once trimmed and within the dialog's limits, an optional calendar `YYYY-MM-DD`
 * due date, and an optional boolean file requirement. Anything else is a 400, logged under the route's `operation`.
 */
export const parseMentorshipTaskCreateRequest = (body: unknown, operation: string): MentorshipTaskCreateRequest => {
  const input = (body ?? {}) as Record<string, unknown>;

  const rawIds = input['applicationIds'];
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw ServiceValidationError.forField('applicationIds', 'applicationIds must be a non-empty list of application UUIDs', { operation });
  }
  // Stop at the first id past the cap, so an oversized list is refused without reading the rest of it.
  const applicationIds = new Set<string>();
  for (const rawId of rawIds) {
    const applicationId = parseTrimmedString(rawId)?.toLowerCase();
    if (!applicationId || !isUuid(applicationId)) {
      throw ServiceValidationError.forField('applicationIds', 'applicationIds must be a non-empty list of application UUIDs', { operation });
    }
    applicationIds.add(applicationId);
    if (applicationIds.size > MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS) {
      throw ServiceValidationError.forField('applicationIds', `applicationIds must hold at most ${MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS} applications`, {
        operation,
      });
    }
  }

  const name = parseRequiredText(input['name'], 'name', MENTORSHIP_TASK_NAME_MAX, operation);
  const description = parseRequiredText(input['description'], 'description', MENTORSHIP_TASK_DESCRIPTION_MAX, operation);
  const request: MentorshipTaskCreateRequest = { applicationIds: [...applicationIds], name, description };

  const rawDueDate = input['dueDate'];
  if (rawDueDate !== undefined && rawDueDate !== null && rawDueDate !== '') {
    const dueDate = typeof rawDueDate === 'string' ? rawDueDate.trim() : '';
    if (!isMentorshipIsoDate(dueDate)) {
      throw ServiceValidationError.forField('dueDate', 'dueDate must be a calendar date as YYYY-MM-DD', { operation });
    }
    request.dueDate = dueDate;
  }

  const requiresFileSubmission = input['requiresFileSubmission'];
  if (requiresFileSubmission !== undefined) {
    if (typeof requiresFileSubmission !== 'boolean') {
      throw ServiceValidationError.forField('requiresFileSubmission', 'requiresFileSubmission must be a boolean', { operation });
    }
    request.requiresFileSubmission = requiresFileSubmission;
  }

  return request;
};

/**
 * Whether upstream will take a task on this application: an accepted mentee's, with the user and term ids the
 * create sends. A graduated, withdrawn or mentor application is refused here rather than sent.
 */
export const isMentorshipTaskAssignableApplication = (
  application: MentorshipUpstreamApplication | null | undefined
): application is MentorshipUpstreamApplication =>
  !!application && application.role === 'mentee' && application.status === 'accepted' && isUuid(application.user_id) && isUuid(application.program_term_id);

/**
 * The upstream create for one application. The assignee and term come from the application upstream returned,
 * and the owner and author are the caller's local user id, so none of them is taken from the browser. A task made
 * here is a custom, non-prerequisite task.
 */
export const buildMentorshipUpstreamTaskCreate = (
  request: MentorshipTaskCreateRequest,
  application: MentorshipUpstreamApplication,
  callerUserId: string
): MentorshipUpstreamTaskCreate => {
  const body: MentorshipUpstreamTaskCreate = {
    assignee_id: application.user_id,
    program_term_id: application.program_term_id,
    owner_id: callerUserId,
    created_by: callerUserId,
    name: request.name,
    description: request.description,
    category: 'non_prerequisite',
    custom: true,
  };
  if (request.dueDate) body.due_date = request.dueDate;
  if (request.requiresFileSubmission) body.submit_file = 'required';
  return body;
};

/**
 * Creates one task for each application, at most `MENTORSHIP_TASK_CREATE_CONCURRENCY` at once, since upstream
 * has no batch create. The caller's local user id, read once, is each task's owner and author. With one application its failure propagates,
 * so upstream's status reaches the browser; with several, each failure is logged and listed in `failed`, and the
 * rest are still created. Upstream checks the caller mentors or manages the program. The task's text is never logged.
 */
export async function createMentorshipMenteeTasks(
  proxy: MicroserviceProxyService,
  req: Request,
  request: MentorshipTaskCreateRequest,
  operation: string
): Promise<MentorshipTaskCreateResponse> {
  logger.debug(req, operation, 'Creating mentee tasks', { application_count: request.applicationIds.length });
  const callerUserId = await readMentorshipLocalUserId(proxy, req, operation);
  if (request.applicationIds.length === 1) {
    await createMentorshipMenteeTask(proxy, req, request, request.applicationIds[0], callerUserId, operation);
    return { created: [...request.applicationIds], failed: [] };
  }

  const created: string[] = [];
  const failed: string[] = [];
  for (let start = 0; start < request.applicationIds.length; start += MENTORSHIP_TASK_CREATE_CONCURRENCY) {
    const batch = request.applicationIds.slice(start, start + MENTORSHIP_TASK_CREATE_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map((applicationId) => createMentorshipMenteeTask(proxy, req, request, applicationId, callerUserId, operation))
    );
    outcomes.forEach((outcome, index) => {
      const applicationId = batch[index];
      if (outcome.status === 'fulfilled') {
        created.push(applicationId);
        return;
      }
      failed.push(applicationId);
      const reason: unknown = outcome.reason;
      logger.warning(req, operation, 'Task not created for one application', {
        applicationId,
        status: reason instanceof BaseApiError ? reason.statusCode : undefined,
        code: reason instanceof BaseApiError ? reason.code : undefined,
      });
    });
  }
  return { created, failed };
}

/**
 * Creates the task on one application. The application is read first for its mentee and term, so the browser
 * supplies neither; one that is not an accepted mentee's is a 400, as upstream would answer.
 */
async function createMentorshipMenteeTask(
  proxy: MicroserviceProxyService,
  req: Request,
  request: MentorshipTaskCreateRequest,
  applicationId: string,
  callerUserId: string,
  operation: string
): Promise<void> {
  const applicationPath = `${MENTORSHIP_APPLICATIONS_PATH}/${encodeURIComponent(applicationId)}`;
  const application = await proxyMentorshipRequest<MentorshipUpstreamApplication>(proxy, req, applicationPath);
  if (!isMentorshipTaskAssignableApplication(application)) {
    throw ServiceValidationError.forField('applicationIds', 'Tasks can be created only for accepted mentees', { operation });
  }
  await proxyMentorshipRequest<MentorshipUpstreamTask>(
    proxy,
    req,
    `${applicationPath}/tasks`,
    'POST',
    undefined,
    buildMentorshipUpstreamTaskCreate(request, application, callerUserId)
  );
}

/**
 * Validates the body of a task edit (`PATCH /api/mentorship/tasks/:taskId`, from the admin and mentor pages). Every field
 * is optional and an absent one is left unchanged, but a body with none of them is a 400. `name` and `description` are 1
 * to their dialog maximum once trimmed, `dueDate` is a real calendar `YYYY-MM-DD` or an empty string that clears it,
 * `requiresFileSubmission` is a boolean and `status` is one of `MENTORSHIP_APPLICANT_TASK_STATUSES`. The task's text is
 * never logged.
 */
export const parseMentorshipTaskUpdate = (body: unknown, operation: string): MentorshipTaskUpdate => {
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const update: MentorshipTaskUpdate = {};

  if (raw['name'] !== undefined) update.name = parseRequiredText(raw['name'], 'name', MENTORSHIP_TASK_NAME_MAX, operation);
  if (raw['description'] !== undefined) update.description = parseRequiredText(raw['description'], 'description', MENTORSHIP_TASK_DESCRIPTION_MAX, operation);

  if (raw['dueDate'] !== undefined) {
    const dueDate = typeof raw['dueDate'] === 'string' ? raw['dueDate'].trim() : undefined;
    if (dueDate === undefined || (dueDate !== '' && !isMentorshipIsoDate(dueDate))) {
      throw ServiceValidationError.forField('dueDate', 'dueDate must be a calendar date as YYYY-MM-DD, or empty to clear it.', { operation });
    }
    update.dueDate = dueDate;
  }

  if (raw['requiresFileSubmission'] !== undefined) {
    if (typeof raw['requiresFileSubmission'] !== 'boolean') {
      throw ServiceValidationError.forField('requiresFileSubmission', 'requiresFileSubmission must be a boolean.', { operation });
    }
    update.requiresFileSubmission = raw['requiresFileSubmission'];
  }

  if (raw['status'] !== undefined) {
    const status = raw['status'];
    if (typeof status !== 'string' || !MENTORSHIP_APPLICANT_TASK_STATUSES.includes(status as MentorshipApplicantTaskStatus)) {
      throw ServiceValidationError.forField('status', `status must be one of ${MENTORSHIP_APPLICANT_TASK_STATUSES.join(', ')}.`, { operation });
    }
    update.status = status as MentorshipApplicantTaskStatus;
  }

  if (Object.keys(update).length === 0) {
    throw ServiceValidationError.forField('body', 'Send at least one field to change.', { operation });
  }
  return update;
};

/**
 * The upstream `PATCH /mentorship/v1/tasks/{id}` body for an edit. A field the browser left out is left out here, so it is
 * unchanged. Turning the file requirement on sends `submit_file: 'required'` and turning it off sends `''`, which clears it,
 * and an empty `dueDate` is sent as `''` for the same reason.
 */
export const buildMentorshipUpstreamTaskUpdate = (update: MentorshipTaskUpdate): MentorshipUpstreamTaskUpdate => {
  const body: MentorshipUpstreamTaskUpdate = {};
  if (update.name !== undefined) body.name = update.name;
  if (update.description !== undefined) body.description = update.description;
  if (update.status !== undefined) body.status = MENTORSHIP_TASK_STATUS_TO_UPSTREAM[update.status];
  if (update.dueDate !== undefined) body.due_date = update.dueDate;
  if (update.requiresFileSubmission !== undefined) body.submit_file = update.requiresFileSubmission ? 'required' : '';
  return body;
};
