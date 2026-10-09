// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
 * Trailing half of the dialog's subtitle; the leading half names the mentee. The note is the application's
 * own: the mentor and admin pages both save it upstream, and every admin and mentor of the program sees it.
 */
export const MENTORSHIP_MENTEE_NOTE_VISIBILITY = "Saved to the application and visible to the program's admins and mentors.";

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
