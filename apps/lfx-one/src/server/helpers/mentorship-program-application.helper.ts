// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipApplicantTask,
  MentorshipMenteeStatus,
  MentorshipProgramApplicant,
  MentorshipProgramMentee,
  MentorshipUpstreamApplicationStatus,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';

import { MENTORSHIP_ADMIN_APPLICATION_STATUS_MAP, MENTORSHIP_MENTOR_PROGRAM_TASK_STATUS_MAP } from '../constants';
import { toIsoDate } from './date-format.helper';

/** One task on a program detail row, the same for a mentor and for an administrator. */
export const mapMentorshipProgramTask = (task: MentorshipUpstreamTask): MentorshipApplicantTask => {
  const mapped: MentorshipApplicantTask = {
    id: task.id,
    name: task.name ?? '',
    description: task.description ?? '',
    status: MENTORSHIP_MENTOR_PROGRAM_TASK_STATUS_MAP[task.status],
    prerequisite: task.category === 'prerequisite',
    createdOn: task.created_on,
    updatedOn: task.updated_on,
    hasSubmission: !!task.file,
    requiresFileSubmission: !!task.submit_file,
  };
  const dueOn = toIsoDate(task.due_date);
  if (dueOn) mapped.dueOn = dueOn;
  return mapped;
};

/**
 * One program detail row, from an application of the program. `statusMap` says how each upstream status
 * reads for the caller, since a mentor sees `hold` as pending. A row carries tasks when `tasks` is given
 * and none when they were not read.
 */
export const mapMentorshipProgramApplicationRow = (
  application: MentorshipUpstreamProgramApplicationRow,
  termName: string,
  tasks: readonly MentorshipUpstreamTask[] | undefined,
  statusMap: Readonly<Record<MentorshipUpstreamApplicationStatus, MentorshipMenteeStatus>>
): MentorshipProgramMentee => {
  const mentee: MentorshipProgramMentee = {
    id: application.application_id,
    name: application.name ?? '',
    email: application.email ?? '',
    status: statusMap[application.status],
    tasksSubmitted: application.tasks_submitted,
    tasksTotal: application.tasks_total,
    termName: application.term?.name ?? termName,
  };
  if (application.avatar_url) mentee.avatarUrl = application.avatar_url;
  if (application.note) mentee.note = application.note;
  if (tasks) mentee.tasks = tasks.map(mapMentorshipProgramTask);
  return mentee;
};

/**
 * One row of an admin mentee tab. A mentor's row reads `hold` as pending, and so does this one. Tasks are never set:
 * the list route does not read them, the View Tasks click does. `otherApplications` keeps only the entries whose
 * program id is a UUID, since the row links to `/mentorship/admin/:programId`.
 */
export const mapMentorshipAdminApplicantRow = (row: MentorshipUpstreamProgramApplicationRow): MentorshipProgramApplicant => {
  const base = mapMentorshipProgramApplicationRow(row, '', undefined, MENTORSHIP_ADMIN_APPLICATION_STATUS_MAP);
  const applicant: MentorshipProgramApplicant = {
    ...base,
    termId: row.term?.id ?? '',
    createdOn: toIsoDate(row.created_on) ?? '',
    updatedOn: toIsoDate(row.updated_on) ?? '',
  };

  const otherApplications = (row.other_applications ?? [])
    .filter((other) => isUuid(other.program_id))
    .map((other) => ({
      programId: other.program_id,
      programName: other.program_name,
      status: MENTORSHIP_ADMIN_APPLICATION_STATUS_MAP[other.status],
    }));
  if (otherApplications.length > 0) applicant.otherApplications = otherApplications;
  return applicant;
};
