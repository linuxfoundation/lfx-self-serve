// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipInvitableUser, MentorshipInvitableUsersResponse } from '../interfaces/mentorship.interface';

export const EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE: MentorshipInvitableUsersResponse = { data: [], total: 0 };

/** Default page size for the Mentors-tab invite picker. */
export const MENTORSHIP_INVITABLE_USER_PAGE_SIZE = 50;

/** Paginator defaults shared by the program-detail people tables. */
export const MENTORSHIP_PERSON_PAGE_SIZE = 10;
export const MENTORSHIP_PERSON_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

/** How long the stubbed-action toasts stay up, in milliseconds. */
export const MENTORSHIP_COMING_SOON_TOAST_LIFE = 4000;

/** Shared filter/table copy — inlining these let the three people tabs drift apart. */
export const MENTORSHIP_ALL_STATUSES_OPTION_LABEL = 'All statuses';
/** Term filter "all" options: Current Mentees lists open terms, Past Mentees closed ones. */
export const MENTORSHIP_ALL_OPEN_TERMS_OPTION_LABEL = 'All open terms';
export const MENTORSHIP_ALL_CLOSED_TERMS_OPTION_LABEL = 'All closed terms';
export const MENTORSHIP_ADD_NOTE_LABEL = 'Add note';
export const MENTORSHIP_NOTE_DIALOG_HEADER = 'Reviewer note';

/** Character cap on the reviewer note, mirrored by the dialog's counter. */
export const MENTORSHIP_MENTEE_NOTE_MAX = 2000;

export const MENTORSHIP_MENTEE_NOTE_PLACEHOLDER = 'Add context for the other reviewers — screening outcome, strengths, concerns.';

/**
 * Trailing half of the dialog's subtitle; the leading half names the mentee.
 * States the present truth rather than the intended one: the note lives only in
 * this browser session until the mentorship service can store it. Update this
 * the moment a write endpoint exists — not before.
 */
export const MENTORSHIP_MENTEE_NOTE_VISIBILITY = 'Kept on this page for now — saving and sharing with admins and mentors is coming soon.';

/**
 * Task-form dialog copy. Grouped here rather than at the call site so `Create Task`
 * and `Edit Task` can't drift apart, and so the dialog's placeholders match the
 * design without inlining strings.
 */
export const MENTORSHIP_TASK_CREATE_DIALOG_HEADER = 'Create Task';
export const MENTORSHIP_TASK_EDIT_DIALOG_HEADER = 'Edit Task';
export const MENTORSHIP_TASK_NAME_LABEL = 'Task Name';
export const MENTORSHIP_TASK_NAME_PLACEHOLDER = 'e.g. Submit ingestion benchmark report';
export const MENTORSHIP_TASK_DUE_DATE_LABEL = 'Due Date';
export const MENTORSHIP_TASK_DUE_DATE_PLACEHOLDER = 'yyyy-mm-dd';
export const MENTORSHIP_TASK_DESCRIPTION_LABEL = 'Task Description';
export const MENTORSHIP_TASK_DESCRIPTION_PLACEHOLDER = 'What should the mentee do, and how will you know it is done?';
export const MENTORSHIP_TASK_STATUS_LABEL = 'Task Status';
export const MENTORSHIP_TASK_REQUIRES_FILE_LABEL = 'Completion of this task requires that the mentee submits a file';
export const MENTORSHIP_TASK_ASSIGN_TO_LABEL = 'Assign to';
export const MENTORSHIP_TASK_ASSIGN_SELECT_ALL_LABEL = 'Select all';
export const MENTORSHIP_TASK_ASSIGN_CLEAR_LABEL = 'Clear';
export const MENTORSHIP_TASK_CREATE_SUBMIT_LABEL = 'Add Task';
export const MENTORSHIP_TASK_EDIT_SUBMIT_LABEL = 'Save Task';
export const MENTORSHIP_TASK_CANCEL_LABEL = 'Cancel';
export const MENTORSHIP_TASK_EDIT_ACTION_LABEL = 'Edit Task';
export const MENTORSHIP_TASK_EDIT_ACTION_ICON = 'fa-light fa-pen-to-square';
export const MENTORSHIP_TASK_NAME_MAX = 120;
export const MENTORSHIP_TASK_DESCRIPTION_MAX = 1000;

/**
 * Deterministic mock pool of LFX users the admin can invite as mentors on the
 * program-detail Mentors tab. Client-only import path (`@lfx-one/shared/constants`)
 * until the upstream user-search endpoint is wired.
 */
export const MOCK_MENTORSHIP_INVITABLE_USERS: MentorshipInvitableUser[] = [
  { id: 'usr_ada_lovelace', name: 'Ada Lovelace', email: 'ada.lovelace@example.com' },
  { id: 'usr_grace_hopper', name: 'Grace Hopper', email: 'grace.hopper@example.com' },
  { id: 'usr_linus_torvalds', name: 'Linus Torvalds', email: 'linus.torvalds@example.com' },
  { id: 'usr_margaret_hamilton', name: 'Margaret Hamilton', email: 'margaret.hamilton@example.com' },
  { id: 'usr_barbara_liskov', name: 'Barbara Liskov', email: 'barbara.liskov@example.com' },
  { id: 'usr_donald_knuth', name: 'Donald Knuth', email: 'donald.knuth@example.com' },
  { id: 'usr_katherine_johnson', name: 'Katherine Johnson', email: 'katherine.johnson@example.com' },
  { id: 'usr_alan_kay', name: 'Alan Kay', email: 'alan.kay@example.com' },
  { id: 'usr_radia_perlman', name: 'Radia Perlman', email: 'radia.perlman@example.com' },
  { id: 'usr_tim_berners_lee', name: 'Tim Berners-Lee', email: 'tim.berners-lee@example.com' },
  { id: 'usr_leslie_lamport', name: 'Leslie Lamport', email: 'leslie.lamport@example.com' },
  { id: 'usr_shafi_goldwasser', name: 'Shafi Goldwasser', email: 'shafi.goldwasser@example.com' },
];
