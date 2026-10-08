// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTOR_PROGRAM_STATUSES } from '@lfx-one/shared/constants';
import {
  MentorshipMentorProgram,
  MentorshipMentorProgramApplicant,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramStatus,
  MentorshipProgramMentee,
  MentorshipUpstreamMentoredProgram,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';

import { MENTORSHIP_MENTOR_PROGRAM_APPLICATION_STATUS_MAP, MENTORSHIP_MENTOR_PROGRAM_MENTEE_STATUSES } from '../constants';
import { toIsoDate } from './date-format.helper';
import { mapMentorshipProgramApplicationRow } from './mentorship-program-application.helper';

/**
 * One My Programs card, from a row of upstream `GET /me/mentor-programs`, which settles the status and the
 * program-wide counts. A status this does not know reads as `open` with `unknownStatus` set, so the caller can log it.
 * The slug falls back to the id.
 */
export const mapMentorshipMentorProgram = (item: MentorshipUpstreamMentoredProgram): { program: MentorshipMentorProgram; unknownStatus: boolean } => {
  const known = (MENTORSHIP_MENTOR_PROGRAM_STATUSES as readonly string[]).includes(item.status);
  const program: MentorshipMentorProgram = {
    id: item.id,
    slug: item.slug || item.id,
    name: item.name,
    projectName: item.project_name?.trim() ?? '',
    status: known ? (item.status as MentorshipMentorProgramStatus) : 'open',
    stats: { mentees: item.stats.mentees, tasksToReview: item.stats.tasks_to_review, applicants: item.stats.applicants },
  };
  if (item.logo_url) program.logoUrl = item.logo_url;
  return { program, unknownStatus: !known };
};

/** The ids of the terms a program's applications are on, each once, in the order first seen. */
export const mentorshipMentorProgramTermIds = (applications: readonly MentorshipUpstreamProgramApplicationRow[]): string[] => [
  ...new Set(applications.flatMap((application) => (application.term?.id ? [application.term.id] : []))),
];

/**
 * Each listed application's tasks, every listed application starting with none. A task on any other
 * application is dropped: the term listings also carry the prerequisite tasks of mentor-role
 * applications, which the mentor is not shown (H3).
 */
export const groupMentorshipMentorProgramTasks = (
  applicationIds: readonly string[],
  tasks: readonly MentorshipUpstreamTask[]
): Map<string, MentorshipUpstreamTask[]> => {
  const grouped = new Map<string, MentorshipUpstreamTask[]>(applicationIds.map((id) => [id, []]));
  for (const task of tasks) {
    if (task.application_id !== undefined) grouped.get(task.application_id)?.push(task);
  }
  return grouped;
};

/**
 * The program detail's Mentees and Applicants rows, from the applications on all the program's terms. Mentees
 * are accepted and graduated applications and applicants are every application, as upstream counts them for the
 * card. Each row's id is its application id and its term is the application's own. A row carries tasks when
 * `tasksByApplication` holds its application and none when they were not read. Other applications keep the
 * program id (only when it is a UUID, since it ends up in a link), name and status.
 */
export const mapMentorshipMentorProgramLists = (
  applications: readonly MentorshipUpstreamProgramApplicationRow[],
  tasksByApplication: ReadonlyMap<string, readonly MentorshipUpstreamTask[]>
): MentorshipMentorProgramLists => {
  const mentees: MentorshipProgramMentee[] = [];
  const applicants: MentorshipMentorProgramApplicant[] = [];
  for (const application of applications) {
    const mentee = mapMentorshipProgramApplicationRow(
      application,
      '',
      tasksByApplication.get(application.application_id),
      MENTORSHIP_MENTOR_PROGRAM_APPLICATION_STATUS_MAP
    );
    applicants.push({
      ...mentee,
      createdOn: toIsoDate(application.created_on) ?? '',
      updatedOn: toIsoDate(application.updated_on) ?? '',
      otherApplications: (application.other_applications ?? []).map((other) => ({
        ...(isUuid(other.program_id) ? { programId: other.program_id } : {}),
        programName: other.program_name,
        status: MENTORSHIP_MENTOR_PROGRAM_APPLICATION_STATUS_MAP[other.status],
      })),
    });
    if (MENTORSHIP_MENTOR_PROGRAM_MENTEE_STATUSES.includes(application.status)) mentees.push(mentee);
  }
  return { mentees, applicants };
};
