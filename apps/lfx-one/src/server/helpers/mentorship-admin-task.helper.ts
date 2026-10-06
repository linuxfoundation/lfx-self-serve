// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_APPLICANT_TASK_STATUSES, MENTORSHIP_TASK_DESCRIPTION_MAX, MENTORSHIP_TASK_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipAdminTaskUpdate, MentorshipApplicantTaskStatus, MentorshipUpstreamTaskUpdate } from '@lfx-one/shared/interfaces';
import { isMentorshipIsoDate } from '@lfx-one/shared/utils/mentorship.utils';

import { MENTORSHIP_ADMIN_TASK_STATUS_TO_UPSTREAM } from '../constants';
import { ServiceValidationError } from '../errors';

const parseText = (value: unknown, field: 'name' | 'description', max: number, operation: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) {
    throw ServiceValidationError.forField(field, `${field} is required and must be at most ${max} characters.`, { operation });
  }
  return text;
};

/**
 * Validates the body of an admin task edit. Every field is optional and an absent one is left unchanged, but a body with
 * none of them is a 400. `name` and `description` are 1 to their dialog maximum once trimmed, `dueDate` is a real calendar
 * `YYYY-MM-DD` or an empty string that clears it, `requiresFileSubmission` is a boolean and `status` is one of
 * `MENTORSHIP_APPLICANT_TASK_STATUSES`. The task's text is never logged.
 */
export const parseMentorshipAdminTaskUpdate = (body: unknown, operation: string): MentorshipAdminTaskUpdate => {
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const update: MentorshipAdminTaskUpdate = {};

  if (raw['name'] !== undefined) update.name = parseText(raw['name'], 'name', MENTORSHIP_TASK_NAME_MAX, operation);
  if (raw['description'] !== undefined) update.description = parseText(raw['description'], 'description', MENTORSHIP_TASK_DESCRIPTION_MAX, operation);

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
export const buildMentorshipUpstreamTaskUpdate = (update: MentorshipAdminTaskUpdate): MentorshipUpstreamTaskUpdate => {
  const body: MentorshipUpstreamTaskUpdate = {};
  if (update.name !== undefined) body.name = update.name;
  if (update.description !== undefined) body.description = update.description;
  if (update.status !== undefined) body.status = MENTORSHIP_ADMIN_TASK_STATUS_TO_UPSTREAM[update.status];
  if (update.dueDate !== undefined) body.due_date = update.dueDate;
  if (update.requiresFileSubmission !== undefined) body.submit_file = update.requiresFileSubmission ? 'required' : '';
  return body;
};
