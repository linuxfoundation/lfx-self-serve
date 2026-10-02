// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipApplicantTask,
  MentorshipMentorProgram,
  MentorshipMentorProgramApplicant,
  MentorshipMentorProgramLists,
  MentorshipMentorProgramRows,
  MentorshipMentorProgramTermChoice,
  MentorshipProgramMentee,
  MentorshipUpstreamMentorProgram,
  MentorshipUpstreamMentorProgramTerm,
  MentorshipUpstreamProgram,
  MentorshipUpstreamProgramApplicationRow,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils/string.utils';

import {
  MENTORSHIP_MENTOR_PROGRAM_APPLICATION_STATUS_MAP,
  MENTORSHIP_MENTOR_PROGRAM_MENTEE_STATUSES,
  MENTORSHIP_MENTOR_PROGRAM_TASK_STATUS_MAP,
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_ORDER,
} from '../constants';
import { toIsoDate } from './date-format.helper';
import { isMentorshipMentorTermUnderway, latestStartingMentorshipMentorTerm, mentorshipMentorTermStartMs } from './mentorship-mentor-term.helper';

/** The open term that starts first; a term with no start loses to any term with one. Ties keep the first. */
const earliestStart = (terms: readonly MentorshipUpstreamMentorProgramTerm[]): MentorshipUpstreamMentorProgramTerm =>
  terms.reduce((best, term) => ((mentorshipMentorTermStartMs(term) ?? Infinity) < (mentorshipMentorTermStartMs(best) ?? Infinity) ? term : best));

/**
 * The term a mentor's program is shown by on My Programs, and the group its card goes in:
 *
 * - an open term that has started: the one that started most recently, `active-term`;
 * - otherwise an open term that starts later, or has no start yet: the one that starts first, `upcoming`;
 * - otherwise a closed term: the one that started most recently, `completed`;
 * - otherwise no term, `upcoming`, and the card's counts are zero.
 *
 * Deleted terms are never chosen. `now` is passed in so the choice can be tested.
 */
export const chooseMentorshipMentorProgramTerm = (terms: readonly MentorshipUpstreamMentorProgramTerm[], now: Date): MentorshipMentorProgramTermChoice => {
  const started = terms.filter((term) => isMentorshipMentorTermUnderway(term, now));
  if (started.length > 0) return { term: latestStartingMentorshipMentorTerm(started), termStatus: 'active-term' };

  const open = terms.filter((term) => term.status === 'open');
  if (open.length > 0) return { term: earliestStart(open), termStatus: 'upcoming' };

  const closed = terms.filter((term) => term.status === 'closed');
  if (closed.length > 0) return { term: latestStartingMentorshipMentorTerm(closed), termStatus: 'completed' };

  return { termStatus: 'upcoming' };
};

/**
 * Sorts one term's applications and tasks the way the My Programs card and the program detail tabs count
 * them. Mentees are accepted and graduated applications and applicants are every application. Tasks to
 * review are submitted tasks on an accepted mentee's application, so a graduated mentee's leftover
 * submission is not waiting on the mentor.
 */
export const sortMentorshipMentorProgramRows = (
  applications: readonly MentorshipUpstreamProgramApplicationRow[],
  tasks: readonly MentorshipUpstreamTask[]
): MentorshipMentorProgramRows => {
  const mentees = applications.filter((application) => MENTORSHIP_MENTOR_PROGRAM_MENTEE_STATUSES.includes(application.status));
  const acceptedApplicationIds = new Set(mentees.filter((mentee) => mentee.status === 'accepted').map((mentee) => mentee.application_id));
  const tasksToReview = tasks.filter(
    (task) => task.status === 'submitted' && task.application_id !== undefined && acceptedApplicationIds.has(task.application_id)
  );
  return { mentees, applicants: [...applications], tasksToReview };
};

/** One My Programs card, from the mentor's program, the program's own record, the chosen term and its rows. */
export const mapMentorshipMentorProgramCard = (
  program: MentorshipUpstreamMentorProgram,
  record: Pick<MentorshipUpstreamProgram, 'project_name'>,
  choice: MentorshipMentorProgramTermChoice,
  rows: MentorshipMentorProgramRows
): MentorshipMentorProgram => {
  const card: MentorshipMentorProgram = {
    id: program.id,
    slug: program.slug,
    name: program.name,
    projectName: record.project_name?.trim() ?? '',
    term: choice.term?.name ?? '',
    termStatus: choice.termStatus,
    stats: { mentees: rows.mentees.length, tasksToReview: rows.tasksToReview.length, applicants: rows.applicants.length },
  };
  if (program.logo_url) card.logoUrl = program.logo_url;
  const termStartDate = toIsoDate(choice.term?.start_date_time);
  const termEndDate = toIsoDate(choice.term?.end_date_time);
  if (termStartDate) card.termStartDate = termStartDate;
  if (termEndDate) card.termEndDate = termEndDate;
  return card;
};

/** My Programs order: active terms, then upcoming, then completed, each by program name. */
export const compareMentorshipMentorProgramCards = (a: MentorshipMentorProgram, b: MentorshipMentorProgram): number =>
  MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_ORDER.indexOf(a.termStatus) - MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_ORDER.indexOf(b.termStatus) ||
  a.name.localeCompare(b.name, 'en-US');

/** One task on a program detail row. */
export const mapMentorshipMentorProgramTask = (task: MentorshipUpstreamTask): MentorshipApplicantTask => {
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
 * Each listed application's tasks, every listed application starting with none. A task on any other
 * application is dropped: the term listing also carries the prerequisite tasks of mentor-role
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
 * The program detail's Mentees and Applicants rows, from the chosen term's applications, split the way
 * `sortMentorshipMentorProgramRows` splits them for the card. Each row's id is its application id. A row
 * carries tasks when `tasksByApplication` holds its application and none when they were not read. Other
 * applications keep the program id (only when it is a UUID, since it ends up in a link), name and status.
 */
export const mapMentorshipMentorProgramLists = (
  applications: readonly MentorshipUpstreamProgramApplicationRow[],
  termName: string,
  tasksByApplication: ReadonlyMap<string, readonly MentorshipUpstreamTask[]>
): MentorshipMentorProgramLists => {
  const mentees: MentorshipProgramMentee[] = [];
  const applicants: MentorshipMentorProgramApplicant[] = [];
  for (const application of applications) {
    const mentee = mapMentee(application, termName, tasksByApplication.get(application.application_id));
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

const mapMentee = (
  application: MentorshipUpstreamProgramApplicationRow,
  termName: string,
  tasks: readonly MentorshipUpstreamTask[] | undefined
): MentorshipProgramMentee => {
  const mentee: MentorshipProgramMentee = {
    id: application.application_id,
    name: application.name ?? '',
    email: application.email ?? '',
    status: MENTORSHIP_MENTOR_PROGRAM_APPLICATION_STATUS_MAP[application.status],
    tasksSubmitted: application.tasks_submitted,
    tasksTotal: application.tasks_total,
    termName: application.term?.name ?? termName,
  };
  if (application.avatar_url) mentee.avatarUrl = application.avatar_url;
  if (application.note) mentee.note = application.note;
  if (tasks) mentee.tasks = tasks.map(mapMentorshipMentorProgramTask);
  return mentee;
};
