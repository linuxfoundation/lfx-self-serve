// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipApplicantDisplayStatus,
  MentorshipApplicantTaskStatus,
  MentorshipCurrentMenteeAction,
  MentorshipMenteeStatus,
  MentorshipMentorStatus,
  MentorshipProgramDecisionStatus,
  MentorshipProgramReviewDecision,
  MentorshipUpstreamProgramStatus,
} from '../interfaces/mentorship.interface';
import type {
  MentorshipAdminMentorAction,
  MentorshipAdminMentorStatus,
  MentorshipAdminProgramTabCounts,
  MentorshipProgram,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipTermRowStatus,
} from '../interfaces/mentorship-admin.interface';

/**
 * Allowed program statuses. Ordered by lifecycle so a `.sort` on this array
 * yields the same order the admin filter dropdown renders.
 */
export const MENTORSHIP_PROGRAM_STATUSES = ['open', 'pending-review', 'completed', 'rejected', 'hidden'] as const;

/** Human-readable labels for each program status (used by badge + filter). */
export const MENTORSHIP_PROGRAM_STATUS_LABELS: Record<MentorshipProgramStatus, string> = {
  open: 'Open',
  'pending-review': 'Pending Review',
  completed: 'Completed',
  rejected: 'Rejected',
  hidden: 'Hidden',
};

/**
 * Tailwind classes for the program-status badge on the admin card.
 * Keep the shape identical to `CROWDFUNDING`'s per-status badge classes so a
 * future shared status-pill component can consume both maps unchanged.
 */
export const MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES: Record<MentorshipProgramStatus, string> = {
  open: 'bg-emerald-100 text-emerald-700',
  'pending-review': 'bg-amber-100 text-amber-700',
  completed: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-100 text-red-700',
  hidden: 'bg-slate-100 text-slate-600',
};

/** Deterministic avatar-tile palette cycled by (title.charCodeAt(0) % length). */
export const MENTORSHIP_PROGRAM_AVATAR_PALETTE: string[] = [
  'rounded-xl bg-blue-100 !text-blue-700',
  'rounded-xl bg-violet-100 !text-violet-700',
  'rounded-xl bg-emerald-100 !text-emerald-700',
  'rounded-xl bg-amber-100 !text-amber-700',
  'rounded-xl bg-rose-100 !text-rose-700',
  'rounded-xl bg-indigo-100 !text-indigo-700',
];

export const EMPTY_MENTORSHIP_PROGRAMS_RESPONSE: MentorshipProgramsResponse = {
  data: [],
  total: 0,
};

/** Admin program-list page size. Passed as `limit` on `GET /api/mentorship/admin/programs`. */
export const MENTORSHIP_PROGRAM_PAGE_SIZE = 12;

/** Most programs one `GET /api/mentorship/admin/programs` page may return; the BFF rejects a larger `limit`. */
export const MENTORSHIP_PROGRAMS_MAX_LIMIT = 50;

/** The two mentee tabs of an admin program page; `type` on `GET /api/mentorship/admin/programs/:programId/mentees`. */
export const MENTORSHIP_ADMIN_MENTEE_TABS = ['current', 'past'] as const;

/** Admin mentee tab page size. Passed as `limit` on `GET /api/mentorship/admin/programs/:programId/mentees`. */
export const MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE = 10;

/** Most mentees one `GET /api/mentorship/admin/programs/:programId/mentees` page may return; the BFF rejects a larger `limit`. */
export const MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT = 50;

/** Pause after the last keystroke before the Current Mentees search is sent upstream. */
export const MENTORSHIP_ADMIN_MENTEES_SEARCH_DEBOUNCE_MS = 300;

/** Shown in a tab count badge whose read failed. */
export const MENTORSHIP_ADMIN_COUNT_UNAVAILABLE_LABEL = '–';

export const MENTORSHIP_ADMIN_MENTEES_LOAD_ERROR_MESSAGE = 'We could not load the mentees. Try again.';
export const MENTORSHIP_ADMIN_TASKS_LOAD_ERROR_MESSAGE = 'We could not load the tasks. Try again.';
export const MENTORSHIP_ADMIN_PROGRAM_LOAD_ERROR_MESSAGE = 'We could not load this program. Try again.';
export const MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_TITLE = 'No access to this program';
export const MENTORSHIP_ADMIN_PROGRAM_NO_ACCESS_MESSAGE = 'You do not have permission to manage this program.';

/** Attendance types an admin picks when accepting an application; `attendance_type` upstream. */
export const MENTORSHIP_ATTENDANCE_TYPES = ['full_time', 'part_time'] as const;

/** Statuses an admin may set through `PATCH …/applications/:applicationId/status`; Withdraw has its own route. */
export const MENTORSHIP_ADMIN_DECISION_STATUSES = ['accepted', 'declined', 'graduated'] as const;

export const MENTORSHIP_ATTENDANCE_TYPE_LABELS: Record<(typeof MENTORSHIP_ATTENDANCE_TYPES)[number], string> = {
  full_time: 'Full time',
  part_time: 'Part time',
};

/** Shown when a decision hits a 409: the application moved on, so the list reloads. */
export const MENTORSHIP_ADMIN_APPLICATION_CHANGED_MESSAGE = 'This application changed. The list has been refreshed.';
/** Shown when an accept hits a 422: the application's term is no longer open. */
export const MENTORSHIP_ADMIN_TERM_CLOSED_ACCEPT_MESSAGE = "This term is closed, so the application can't be accepted.";
/** Graduate confirmation warning; `{count}` is the number of tasks not yet Submitted or Completed. */
export const MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_TEMPLATE = "{count} tasks aren't Submitted or Completed.";
export const MENTORSHIP_ADMIN_GRADUATE_TASK_WARNING_SINGULAR_TEMPLATE = "{count} task isn't Submitted or Completed.";

/** Copy of the Current Mentees decision dialogs and toasts. */
export const MENTORSHIP_ADMIN_ACCEPT_DIALOG_HEADER = 'Accept Application';
export const MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_LABEL = 'Attendance type';
export const MENTORSHIP_ADMIN_ACCEPT_ATTENDANCE_REQUIRED_MESSAGE = 'Choose an attendance type to accept the application.';
export const MENTORSHIP_ADMIN_DECLINE_CONFIRM_MESSAGE = 'Decline this application? The mentee is told it was declined.';
export const MENTORSHIP_ADMIN_WITHDRAW_CONFIRM_MESSAGE = "Withdraw this application on the mentee's behalf? This can't be undone.";
export const MENTORSHIP_ADMIN_GRADUATE_CONFIRM_MESSAGE = 'Graduate this mentee?';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_HEADER = 'Decline by Term';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_MESSAGE = "Decline every pending application in the term you pick. Accepted mentees aren't affected.";
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_NO_TERMS_MESSAGE = 'There is no open term to decline applications in.';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_TERM_LABEL = 'Term';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_REQUIRED_MESSAGE = 'Choose a term to continue.';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_CONFIRM_TEMPLATE = 'Decline all pending applications in {term}? This cannot be undone.';
/** `{count}` is the number of applications the bulk decline reported. */
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_TEMPLATE = '{count} applications declined';
export const MENTORSHIP_ADMIN_DECLINE_BY_TERM_DONE_SINGULAR_TEMPLATE = '1 application declined';
export const MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES = {
  accepted: 'Application accepted',
  declined: 'Application declined',
  withdrawn: 'Application withdrawn',
  graduated: 'Mentee graduated',
} as const;
export const MENTORSHIP_ADMIN_DECISION_FAILED_MESSAGE = "The change couldn't be saved. Please try again.";
export const MENTORSHIP_ADMIN_DECISION_IN_FLIGHT_MESSAGE = 'Another change is still being saved. Try again in a moment.';

/** Copy of the reviewer-note save toasts on Current Mentees. */
export const MENTORSHIP_ADMIN_NOTE_SAVE_SUCCESS_SUMMARY = 'Note saved';
export const MENTORSHIP_ADMIN_NOTE_CLEAR_SUCCESS_SUMMARY = 'Note cleared';
export const MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_SUMMARY = 'Could not save the note';
export const MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_FALLBACK = 'Something went wrong. Please try again.';
export const MENTORSHIP_ADMIN_NOTE_TOAST_LIFE = 5000;

/** Note save failures with their own copy, keyed by the BFF's status: a 403 is a lost admin role, a 404 an application that is gone. */
export const MENTORSHIP_ADMIN_NOTE_SAVE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  403: 'You can no longer edit notes on this program. Refresh the page and try again.',
  404: 'This application no longer exists. Refresh the page and try again.',
};

/** Admin Create task toasts on Current Mentees: their copy and how long they stay up (ms). */
export const MENTORSHIP_ADMIN_TASK_CREATE_SUCCESS_SUMMARY = 'Task created';
export const MENTORSHIP_ADMIN_TASK_CREATE_ERROR_SUMMARY = 'Could not create the task';
export const MENTORSHIP_ADMIN_TASK_CREATE_ERROR_FALLBACK = "The task may not have been created. Check the mentee's row before trying again.";
export const MENTORSHIP_ADMIN_TASK_CREATE_TOAST_LIFE = 5000;

/** Task create failures with their own copy, keyed by the BFF's status: a 400 is a mentee no longer accepted, a 403 a lost admin role, a 404 an application that is gone. */
export const MENTORSHIP_ADMIN_TASK_CREATE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'This mentee can no longer be given tasks. Refresh the page and try again.',
  403: 'You can no longer create tasks on this program. Refresh the page and try again.',
  404: 'This application no longer exists. Refresh the page and try again.',
};

/**
 * Toast `summary` shown by every mentorship register form when submit is blocked by
 * client-side validation. Shared so a copy change lands on both mentor and mentee forms
 * without one drifting away from the other — the same reuse pattern `SkillsPickerComponent`
 * and `TermsAcknowledgementComponent` follow for their labels.
 */
export const MENTORSHIP_REGISTER_WARN_SUMMARY = 'Check your registration';

/**
 * Failure-banner copy both register forms share, keyed by `MentorshipRegisterSubmitFailureKind`. The
 * profile-exists and ineligible messages are role-specific and live with each role's constants.
 */
export const MENTORSHIP_REGISTER_ERROR_CONFLICT = 'Your profile is in conflict with an existing record. Refresh the page and try again.';
export const MENTORSHIP_REGISTER_ERROR_READ_ONLY = 'You are viewing as another user, so registration is read-only.';
export const MENTORSHIP_REGISTER_ERROR_FALLBACK = 'We could not save your registration. Please try again in a moment.';

/** Field error both register forms show when a picked skill is not in `MENTORSHIP_SKILL_OPTIONS`. */
export const MENTORSHIP_REGISTER_ERROR_UNKNOWN_SKILL = 'Choose skills from the suggested list.';

/**
 * Most rows one `GET .../mentors` or `GET .../terms` page may return. The BFF rejects a larger `limit` and caps
 * its upstream read here too, since upstream resets a larger `limit` to 50.
 */
export const MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT = 50;

/** Most `GET .../terms` pages the Terms tab follows to read every term, so a list that never ends cannot loop forever. */
export const MENTORSHIP_ADMIN_TERMS_MAX_PAGES = 20;

/** Admin Mentors and Terms tab page size. Passed as `limit` on `GET .../mentors` and `GET .../terms`. */
export const MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE = 10;

export const MENTORSHIP_ADMIN_MENTORS_LOAD_ERROR_MESSAGE = 'We could not load the mentors. Try again.';
export const MENTORSHIP_ADMIN_TERMS_LOAD_ERROR_MESSAGE = 'We could not load the terms. Try again.';

/**
 * Underline tabs on `/mentorship/admin/:programId`. Order matches the admin screenshot;
 * `countKey` names the `MentorshipAdminProgramTabCounts` field each tab's badge reads.
 */
export const MENTORSHIP_PROGRAM_DETAIL_TABS = [
  { value: 'current-mentees', label: 'Current Mentees', countKey: 'currentMentees' },
  { value: 'past-mentees', label: 'Past Mentees', countKey: 'pastMentees' },
  { value: 'mentors', label: 'Mentors', countKey: 'mentors' },
  { value: 'terms', label: 'Terms', countKey: 'terms' },
] as const satisfies readonly { value: string; label: string; countKey: keyof MentorshipAdminProgramTabCounts }[];

/**
 * Mentor request statuses as the mentor sees them on the Become a Mentor form. Source of the
 * `MentorshipMentorStatus` union; declaration order is the lifecycle order. The admin Mentors
 * tab reads the wider `MENTORSHIP_ADMIN_MENTOR_STATUSES` instead.
 */
export const MENTORSHIP_MENTOR_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn'] as const;

/**
 * Mentee lifecycle statuses on the admin Current Mentees / Past Mentees tabs.
 * Superset of mentor statuses; mentees additionally reach `graduated`.
 * Declaration order is the status filter's option order.
 */
export const MENTORSHIP_MENTEE_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'graduated'] as const;

export const MENTORSHIP_MENTOR_STATUS_LABELS: Record<MentorshipMentorStatus, string> = {
  pending: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/**
 * Mentor lifecycle on the admin Mentors tab, which reads every `program_members` status upstream keeps
 * (`active` is the accepted mentor). Declaration order is the status filter's option order.
 */
export const MENTORSHIP_ADMIN_MENTOR_STATUSES = ['requested', 'pending', 'invited', 'active', 'declined', 'withdrawn'] as const;

export const MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS: Record<MentorshipAdminMentorStatus, string> = {
  requested: 'Requested',
  pending: 'Pending',
  invited: 'Invited',
  active: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const MENTORSHIP_ADMIN_MENTOR_STATUS_BADGE_CLASSES: Record<MentorshipAdminMentorStatus, string> = {
  requested: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  invited: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-600',
};

/** Statuses an admin may set through `PATCH …/mentors/:memberId`. Upstream allows no move out of `declined` or `withdrawn`. */
export const MENTORSHIP_ADMIN_MENTOR_UPDATE_STATUSES = ['active', 'declined', 'withdrawn'] as const;

/** Shown when a mentor change hits a 409: the mentor's status moved on, so the list reloads. */
export const MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE = 'This mentor changed. The list has been refreshed.';

/** Mentors tab row actions by the mentor's status, in display order. Upstream's DELETE only withdraws an active mentor, so Remove covers it. */
export const MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS: Record<MentorshipAdminMentorStatus, readonly MentorshipAdminMentorAction[]> = {
  requested: [
    { key: 'accept', label: 'Accept', status: 'active' },
    { key: 'decline', label: 'Decline', status: 'declined' },
  ],
  pending: [
    { key: 'accept', label: 'Accept', status: 'active' },
    { key: 'decline', label: 'Decline', status: 'declined' },
  ],
  invited: [{ key: 'revoke', label: 'Revoke invite', status: 'declined' }],
  active: [{ key: 'remove', label: 'Remove', status: 'withdrawn' }],
  declined: [],
  withdrawn: [],
};

export const MENTORSHIP_ADMIN_MENTOR_ACTION_CONFIRM_MESSAGES: Record<MentorshipAdminMentorAction['key'], string> = {
  accept: 'Accept this mentor into the program?',
  decline: 'Decline this mentor for the program?',
  revoke: 'Revoke this invite? The mentor can no longer accept it.',
  remove: "Remove this mentor from the program? This can't be undone.",
};

export const MENTORSHIP_ADMIN_MENTOR_ACTION_SUCCESS_MESSAGES: Record<MentorshipAdminMentorAction['key'], string> = {
  accept: 'Mentor accepted.',
  decline: 'Mentor declined.',
  revoke: 'Invite revoked.',
  remove: 'Mentor removed.',
};

/** Icon and colour of each Mentors tab row action. */
export const MENTORSHIP_ADMIN_MENTOR_ACTION_APPEARANCE: Record<MentorshipAdminMentorAction['key'], { icon: string; styleClass: string }> = {
  accept: { icon: 'fa-light fa-circle-check', styleClass: 'text-emerald-600 hover:text-emerald-700' },
  decline: { icon: 'fa-light fa-circle-xmark', styleClass: 'text-amber-600 hover:text-amber-700' },
  revoke: { icon: 'fa-light fa-ban', styleClass: 'text-amber-600 hover:text-amber-700' },
  remove: { icon: 'fa-light fa-user-minus', styleClass: 'text-red-600 hover:text-red-700' },
};

export const MENTORSHIP_MENTEE_STATUS_LABELS: Record<MentorshipMenteeStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
};

export const MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES: Record<MentorshipMentorStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-600',
};

export const MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES: Record<MentorshipMenteeStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-600',
  graduated: 'bg-emerald-100 text-emerald-700',
};

/**
 * Statuses the mentor's Mentees tab covers: the mentees taking part, plus any who
 * graduated early. Doubles as that tab's status-filter options.
 */
export const MENTORSHIP_CURRENT_MENTEE_STATUSES: readonly MentorshipMenteeStatus[] = ['accepted', 'graduated'];

/**
 * Statuses the "Other Active Applications" column lists. Graduating counts: it says
 * the person saw a program through, which is worth showing an admin reviewing them.
 * Only the two rejections — declined and withdrawn — are left out.
 */
export const MENTORSHIP_ACTIVE_APPLICATION_STATUSES: readonly MentorshipMenteeStatus[] = ['pending', 'accepted', 'graduated'];

/**
 * Row actions on the admin Current Mentees tab. Source of the
 * `MentorshipCurrentMenteeAction` union; declaration order is the menu order.
 */
export const MENTORSHIP_CURRENT_MENTEE_ACTIONS = ['accept', 'create-task', 'graduate', 'decline', 'withdraw'] as const;

/** Menu labels for the Current Mentees row actions — imperative, unlike the status labels. */
export const MENTORSHIP_CURRENT_MENTEE_ACTION_LABELS: Record<MentorshipCurrentMenteeAction, string> = {
  accept: 'Accept',
  'create-task': 'Create task',
  graduate: 'Graduate',
  decline: 'Decline',
  withdraw: 'Withdraw',
};

export const MENTORSHIP_CURRENT_MENTEE_ACTION_ICONS: Record<MentorshipCurrentMenteeAction, string> = {
  accept: 'fa-light fa-circle-check',
  'create-task': 'fa-light fa-list-check',
  graduate: 'fa-light fa-graduation-cap',
  decline: 'fa-light fa-circle-xmark',
  withdraw: 'fa-light fa-circle-minus',
};

/**
 * Row actions each status offers on the Current Mentees tab. An application under
 * review can be decided; an accepted mentee can be given tasks and graduated. The
 * three terminal statuses offer nothing — the row keeps only its Note link.
 */
export const MENTORSHIP_CURRENT_MENTEE_ACTIONS_BY_STATUS: Record<MentorshipMenteeStatus, readonly MentorshipCurrentMenteeAction[]> = {
  pending: ['accept', 'decline', 'withdraw'],
  accepted: ['create-task', 'graduate', 'decline', 'withdraw'],
  declined: [],
  withdrawn: [],
  graduated: [],
};

/**
 * Statuses the admin Current Mentees and mentor Applicants tables display. These are not
 * wire statuses: an application stays `pending` throughout the prerequisite work, and those
 * tables split that one status into `applied` (tasks still outstanding) and `tasks-completed`
 * (all submitted). The rest are the mentee statuses unchanged. Past Mentees shows the wire
 * status, since a closed term's pending row is history rather than review work.
 */
export const MENTORSHIP_APPLICANT_DISPLAY_STATUSES = ['applied', 'tasks-completed', 'accepted', 'declined', 'withdrawn', 'graduated'] as const;

export const MENTORSHIP_APPLICANT_STATUS_LABELS: Record<MentorshipApplicantDisplayStatus, string> = {
  applied: 'Applied',
  'tasks-completed': 'Tasks Completed',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
};

/** The shared statuses reuse the mentee classes so the two palettes can't drift apart. */
export const MENTORSHIP_APPLICANT_STATUS_BADGE_CLASSES: Record<MentorshipApplicantDisplayStatus, string> = {
  applied: 'bg-amber-100 text-amber-700',
  'tasks-completed': 'bg-blue-100 text-blue-700',
  accepted: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES.accepted,
  declined: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES.declined,
  withdrawn: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES.withdrawn,
  graduated: MENTORSHIP_MENTEE_STATUS_BADGE_CLASSES.graduated,
};

/** Explains the Applied / Tasks Completed split; rendered above the Current Mentees table. */
export const MENTORSHIP_APPLICANT_STATUS_NOTE =
  'Application status stays “Applied” while a mentee works on prerequisite tasks. When all prerequisites are complete, “Tasks Completed” appears above the status and the program admin is notified by email to review the submission and make the admission decision.';

/** Status values for one row in the Applicants tab tasks sub-table. */
/**
 * Task-status progression. Ordered from `pending` → `completed`; the tuple order also
 * drives the dropdown's option order via `MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS`.
 * `completed` (terminal, reviewer-marked-done) is distinct from `submitted`
 * (mentee handed in the deliverable, awaiting review).
 */
export const MENTORSHIP_APPLICANT_TASK_STATUSES = ['pending', 'in-progress', 'submitted', 'completed'] as const;

export const MENTORSHIP_APPLICANT_TASK_STATUS_LABELS: Record<MentorshipApplicantTaskStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  submitted: 'Submitted',
  completed: 'Completed',
};

export const MENTORSHIP_APPLICANT_TASK_STATUS_BADGE_CLASSES: Record<MentorshipApplicantTaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  'in-progress': 'bg-blue-100 text-blue-700',
  submitted: 'bg-emerald-100 text-emerald-700',
  // Darker text than `submitted` (`text-emerald-800` vs `700`) for the terminal reviewed-and-closed state.
  completed: 'bg-emerald-100 text-emerald-800',
};

/**
 * Options list for the status dropdowns in the applicant-tasks-panel and the task-form
 * dialog. Derived from the tuple so the two dropdowns can't drift. Not typed as
 * `readonly` because `lfx-select.options` accepts a mutable `any[]` — TS4104 would
 * otherwise fire when this constant flows into the template binding.
 */
export const MENTORSHIP_APPLICANT_TASK_STATUS_OPTIONS: { label: string; value: MentorshipApplicantTaskStatus }[] = MENTORSHIP_APPLICANT_TASK_STATUSES.map(
  (value) => ({ label: MENTORSHIP_APPLICANT_TASK_STATUS_LABELS[value], value })
);

/** Due-date copy when a prerequisite task has no fixed calendar due date. */
export const MENTORSHIP_APPLICANT_TASK_DUE_PREREQUISITE_LABEL = 'Prerequisite Task';

export const MENTORSHIP_APPLICANT_TASKS_HIDE_PREREQUISITE_LABEL = 'Hide Prerequisite Tasks';
export const MENTORSHIP_APPLICANT_VIEW_TASKS_LABEL = 'View Tasks';
export const MENTORSHIP_APPLICANT_MINIMIZE_TASKS_LABEL = 'Minimize';

export const MENTORSHIP_TERM_ROW_STATUSES = ['open', 'closed'] as const;

export const MENTORSHIP_TERM_ROW_STATUS_LABELS: Record<MentorshipTermRowStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

export const MENTORSHIP_TERM_ROW_STATUS_BADGE_CLASSES: Record<MentorshipTermRowStatus, string> = {
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-600',
};

export const MENTORSHIP_COMING_SOON_DETAIL = 'This action is not available yet.';

export const MENTORSHIP_TERM_SHOULD_CLOSE_WARNING = 'This term should be closed because it has ended. Please close it to prevent new applications.';
export const MENTORSHIP_TERM_CANNOT_CLOSE_MESSAGE =
  'This term cannot be closed until all accepted applicants are either graduated or declined. Please ensure there are zero accepted applicants before closing the term.';
export const MENTORSHIP_TERM_CLOSE_CONFIRM = 'Closing this term will automatically decline all pending applications. Continue?';
export const MENTORSHIP_TERM_REOPEN_CONFIRM = 'Are you sure you want to re-open this term?';

/**
 * Builds a project icon URL from a Linux Foundation artwork repo (`cncf`, `lfai`,
 * `lf-energy`), which all publish icons at the same
 * `projects/<dir>/icon/color/<name>-icon-color.svg` path. `name` defaults to `dir`
 * because a few projects break the convention — `open-policy-agent` ships
 * `opa-icon-color.svg`.
 *
 * Only feeds the mocks below; removed with them once the upstream mentorship
 * service returns real logo URLs.
 */
export function mentorshipArtworkIconUrl(org: string, dir: string, name: string = dir): string {
  return `https://raw.githubusercontent.com/${org}/artwork/main/projects/${dir}/icon/color/${name}-icon-color.svg`;
}

/**
 * Deterministic mock programs backing the mentorship BFF while the upstream
 * mentorship service is unavailable. Server-only import path
 * (`@lfx-one/shared/constants`) so the shape stays in one place.
 *
 * Removed once the real upstream mentorship-service endpoint is wired up in
 * `mentorship.service.ts`.
 */
export const MOCK_MENTORSHIP_PROGRAMS: MentorshipProgram[] = [
  {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 4, mentees: 2, graduated: 6 },
    logoUrl: mentorshipArtworkIconUrl('lf-energy', 'grid-exchange-fabric'),
    createdOn: '2026-06-01T00:00:00.000Z',
    updatedOn: '2026-08-15T00:00:00.000Z',
  },
  {
    id: 'mp_apicurio_winter26',
    slug: 'apicurio-registry-prompt-template-playground',
    name: 'Apicurio Registry: Prompt Template Playground',
    projectName: 'CNCF',
    term: 'Winter 2026',
    status: 'pending-review',
    stats: { mentors: 2, mentees: 0, graduated: 0 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'apicurio-registry'),
    createdOn: '2026-07-10T00:00:00.000Z',
    updatedOn: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'mp_janusgraph_fall26',
    slug: 'janusgraph-adjacency-cache-instrumentation',
    name: 'JanusGraph: Adjacency Cache Instrumentation',
    projectName: 'LF AI & Data',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 1, mentees: 1, graduated: 2 },
    logoUrl: mentorshipArtworkIconUrl('lfai', 'janusgraph'),
    createdOn: '2026-05-15T00:00:00.000Z',
    updatedOn: '2026-08-25T00:00:00.000Z',
  },
  {
    id: 'mp_thanos_summer26',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    status: 'completed',
    stats: { mentors: 2, mentees: 0, graduated: 3 },
    logoUrl: mentorshipArtworkIconUrl('cncf', 'thanos'),
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  },
];

// -- Program review (approver approve/reject email link) ---------------------

/**
 * Program statuses as the mentorship service stores them (`status` on `/mentorship/v1/programs`).
 * A program is created `pending`; approving moves it to `published` and rejecting to `rejected`.
 * A published program can later be `hidden`.
 */
export const MENTORSHIP_UPSTREAM_PROGRAM_STATUSES = ['pending', 'published', 'rejected', 'hidden'] as const;

/** Program-review page copy for a program's current upstream status. */
export const MENTORSHIP_UPSTREAM_PROGRAM_STATUS_LABELS: Record<MentorshipUpstreamProgramStatus, string> = {
  pending: 'Awaiting review',
  published: 'Approved',
  rejected: 'Rejected',
  hidden: 'Hidden',
};

/**
 * Accepted `?decision=` values on the approve/reject email link:
 * `/mentorship/program-review/<program id>?decision=approve|reject`.
 */
export const MENTORSHIP_PROGRAM_REVIEW_DECISIONS = ['approve', 'reject'] as const;

/** The upstream status each review decision moves a `pending` program to. */
export const MENTORSHIP_PROGRAM_REVIEW_DECISION_STATUS: Record<MentorshipProgramReviewDecision, MentorshipProgramDecisionStatus> = {
  approve: 'published',
  reject: 'rejected',
};

/** Verb shown on the program-review confirm card and its button. */
export const MENTORSHIP_PROGRAM_REVIEW_DECISION_LABELS: Record<MentorshipProgramReviewDecision, string> = {
  approve: 'Approve',
  reject: 'Reject',
};

/** Past-tense verb shown once a review decision has been recorded. */
export const MENTORSHIP_PROGRAM_REVIEW_DECISION_DONE_LABELS: Record<MentorshipProgramReviewDecision, string> = {
  approve: 'approved',
  reject: 'rejected',
};
