// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_TASK_DESCRIPTION_MAX, MENTORSHIP_TASK_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipMentorTaskCreateRequest, MentorshipUpstreamApplication, MentorshipUpstreamTaskCreate } from '@lfx-one/shared/interfaces';
import { isMentorshipIsoDate, isUuid } from '@lfx-one/shared/utils';

import { MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS } from '../constants/mentorship.constants';
import { ServiceValidationError } from '../errors';
import { parseTrimmedString } from './mentorship-params.helper';

const OPERATION = 'create_mentorship_mentor_tasks';

const parseRequiredText = (value: unknown, field: string, max: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw ServiceValidationError.forField(field, `${field} is required`, { operation: OPERATION });
  }
  if (text.length > max) {
    throw ServiceValidationError.forField(field, `${field} must be at most ${max} characters`, { operation: OPERATION });
  }
  return text;
};

/**
 * Reads the body of `POST /api/mentorship/mentor/tasks` with the rules the task dialog uses: one to
 * `MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS` application UUIDs (a repeat is dropped), a name and a
 * description that are required once trimmed and within the dialog's limits, an optional calendar `YYYY-MM-DD`
 * due date, and an optional boolean file requirement. Anything else is a 400.
 */
export const parseMentorshipMentorTaskCreateRequest = (body: unknown): MentorshipMentorTaskCreateRequest => {
  const input = (body ?? {}) as Record<string, unknown>;

  const rawIds = input['applicationIds'];
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw ServiceValidationError.forField('applicationIds', 'applicationIds must be a non-empty list of application UUIDs', { operation: OPERATION });
  }
  // Stop at the first id past the cap, so an oversized list is refused without reading the rest of it.
  const applicationIds = new Set<string>();
  for (const rawId of rawIds) {
    const applicationId = parseTrimmedString(rawId)?.toLowerCase();
    if (!applicationId || !isUuid(applicationId)) {
      throw ServiceValidationError.forField('applicationIds', 'applicationIds must be a non-empty list of application UUIDs', { operation: OPERATION });
    }
    applicationIds.add(applicationId);
    if (applicationIds.size > MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS) {
      throw ServiceValidationError.forField(
        'applicationIds',
        `applicationIds must hold at most ${MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS} applications`,
        {
          operation: OPERATION,
        }
      );
    }
  }

  const name = parseRequiredText(input['name'], 'name', MENTORSHIP_TASK_NAME_MAX);
  const description = parseRequiredText(input['description'], 'description', MENTORSHIP_TASK_DESCRIPTION_MAX);
  const request: MentorshipMentorTaskCreateRequest = { applicationIds: [...applicationIds], name, description };

  const rawDueDate = input['dueDate'];
  if (rawDueDate !== undefined && rawDueDate !== null && rawDueDate !== '') {
    const dueDate = typeof rawDueDate === 'string' ? rawDueDate.trim() : '';
    if (!isMentorshipIsoDate(dueDate)) {
      throw ServiceValidationError.forField('dueDate', 'dueDate must be a calendar date as YYYY-MM-DD', { operation: OPERATION });
    }
    request.dueDate = dueDate;
  }

  const requiresFileSubmission = input['requiresFileSubmission'];
  if (requiresFileSubmission !== undefined) {
    if (typeof requiresFileSubmission !== 'boolean') {
      throw ServiceValidationError.forField('requiresFileSubmission', 'requiresFileSubmission must be a boolean', { operation: OPERATION });
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
 * and the owner and author are the caller's local user id, so none of them is taken from the browser. A mentor's
 * task is a custom, non-prerequisite task.
 */
export const buildMentorshipUpstreamTaskCreate = (
  request: MentorshipMentorTaskCreateRequest,
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
