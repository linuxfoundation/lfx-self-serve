// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipMenteeApplication,
  MentorshipMenteeApplicationHistoryEntry,
  MentorshipMenteeApplicationTask,
  MentorshipUpstreamApplication,
  MentorshipUpstreamProgramDetail,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, toMentorshipUtcInstant } from '@lfx-one/shared/utils';

/** An upstream task counts as submitted once the mentee has handed it in, whether or not it was reviewed. */
const isSubmittedTask = (task: MentorshipUpstreamTask): boolean => task.status === 'submitted' || task.status === 'complete';

/**
 * A task's own due date as its UTC midnight instant, else the term's application close for a
 * prerequisite task. Upstream stores `due_date` as a bare date, which `DatePipe` would read as
 * local midnight and show a day early east of UTC.
 */
const resolveTaskDueDate = (task: MentorshipUpstreamTask, applicationEndDate: string | undefined): string | undefined => {
  if (task.due_date) return toMentorshipUtcInstant(task.due_date);
  if (task.category === 'prerequisite') return applicationEndDate;
  return undefined;
};

/**
 * Maps one `tasks` row to the mentee task shape. The service stores `category` as nullable, and a
 * task without one counts as non-prerequisite. Upstream records no separate submission time, so a
 * submitted task's `updated_on` stands in for it.
 */
export const mapMentorshipMenteeApplicationTask = (task: MentorshipUpstreamTask, applicationEndDate: string | undefined): MentorshipMenteeApplicationTask => ({
  id: task.id,
  name: task.name ?? '',
  description: task.description ?? '',
  category: task.category ?? 'non_prerequisite',
  status: task.status,
  submitFile: task.submit_file || null,
  fileUrl: task.file || undefined,
  dueDate: resolveTaskDueDate(task, applicationEndDate),
  submittedOn: isSubmittedTask(task) ? task.updated_on : undefined,
  updatedOn: task.updated_on,
});

/**
 * Maps one of the caller's `applications` rows, its tasks, and its program's detail to the mentee
 * application shape. Applications embed the program but not its LF project, so the project comes
 * from the program detail and is absent when that lookup failed. `tasks` is left out when they
 * were not read, so the result never looks like an application with no tasks assigned.
 */
export const mapMentorshipMenteeApplication = (
  application: MentorshipUpstreamApplication,
  tasks: MentorshipUpstreamTask[] | undefined,
  program?: MentorshipUpstreamProgramDetail
): MentorshipMenteeApplication => ({
  id: application.id,
  programId: application.program?.id ?? '',
  programName: application.program?.name ?? '',
  programLogoUrl: application.program?.logo_url || undefined,
  projectName: program?.project_name || undefined,
  term: {
    id: application.term?.id ?? application.program_term_id,
    name: application.term?.name ?? '',
    application_end_date: application.term?.application_end_date || undefined,
  },
  upstreamStatus: application.status,
  createdOn: application.created_on,
  updatedOn: application.updated_on,
  decisionExpectedDate: application.term?.application_end_date || undefined,
  ...(tasks && { tasks: tasks.map((task) => mapMentorshipMenteeApplicationTask(task, application.term?.application_end_date ?? undefined)) }),
});

/**
 * Maps the caller's applications to Application History rows, newest first. `submittedOn` is the
 * UTC calendar date of `created_on`, formatted for display.
 */
export const mapMentorshipMenteeApplicationHistory = (applications: MentorshipUpstreamApplication[]): MentorshipMenteeApplicationHistoryEntry[] =>
  [...applications]
    .sort((a, b) => b.created_on.localeCompare(a.created_on))
    .map((application) => ({
      id: application.id,
      programName: application.program?.name ?? '',
      termName: application.term?.name ?? '',
      submittedOn: formatIsoDateLabel(application.created_on.slice(0, 10)),
      status: application.status,
    }));
