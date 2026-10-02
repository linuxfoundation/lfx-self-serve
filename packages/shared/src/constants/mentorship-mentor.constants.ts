// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipMenteeStatus, MentorshipMentorStatus, MentorshipRegisterFailureOptions } from '../interfaces/mentorship.interface';
import type {
  MentorshipMentorTaskReviewStatus,
  MentorshipMentoringHistoryStatus,
  MentorshipMentorProfileResponse,
  MentorshipMentorProgramsResponse,
  MentorshipMentorProgramTermStatus,
  MentorshipMentorRegisterFieldErrors,
  MentorshipMentorRegisterForm,
} from '../interfaces/mentorship-mentor.interface';
import { MENTORSHIP_MENTEE_STATUS_LABELS, MENTORSHIP_MENTOR_STATUS_LABELS } from './mentorship.constants';

/**
 * Tab metadata for the mentor shell (`MentorPageComponent`). The label doubles as the
 * shell's page H1 when a tab is active, so a change here reaches both surfaces.
 */
export const MENTORSHIP_MENTOR_PAGE_TABS = [
  { value: 'programs' as const, label: 'My Programs' },
  { value: 'profile' as const, label: 'Mentor Profile' },
];

export const MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS: Record<MentorshipMentorProgramTermStatus, string> = {
  'active-term': 'Active term',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

export const MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_BADGE_CLASSES: Record<MentorshipMentorProgramTermStatus, string> = {
  'active-term': 'bg-blue-50 text-blue-700',
  upcoming: 'bg-amber-50 text-amber-700',
  completed: 'bg-gray-100 text-gray-600',
};

export const EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE: MentorshipMentorProgramsResponse = {
  data: [],
  total: 0,
};

/** Mentor program-detail underline tabs, in the order the page renders them. */
export const MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'mentees', label: 'Mentees' },
  { value: 'applicants', label: 'Applicants' },
] as const;

/**
 * Mentor Applicants tab status filter pills. Deliberately simpler than the admin tab's
 * status dropdown: it filters on the raw `MentorshipMenteeStatus` rather than the admin's
 * split `applied` / `tasks-completed` display status, and drops Withdrawn/Graduated —
 * this page only needs Pending / Accepted / Declined / All. `value: undefined` clears the
 * filter. Labels for the three statuses reuse `MENTORSHIP_MENTEE_STATUS_LABELS` so pill
 * text can't drift from the rest of the module.
 */
export const MENTORSHIP_MENTOR_APPLICANT_STATUS_FILTER_PILLS: { value: MentorshipMenteeStatus | undefined; label: string }[] = [
  { value: 'pending', label: MENTORSHIP_MENTEE_STATUS_LABELS.pending },
  { value: 'accepted', label: MENTORSHIP_MENTEE_STATUS_LABELS.accepted },
  { value: 'declined', label: MENTORSHIP_MENTEE_STATUS_LABELS.declined },
  { value: undefined, label: 'All' },
];

/** Heading and group-create action on the mentor program-detail Mentees tab. */
export const MENTORSHIP_MENTOR_MENTEES_HEADING = 'Current Mentees';
export const MENTORSHIP_MENTOR_CREATE_GROUP_TASK_LABEL = 'Create Group Task';
/** Progress-cell copy when the mentee has no measurable (non-prerequisite) tasks. */
export const MENTORSHIP_MENTOR_NO_TASKS_ASSIGNED = 'No tasks assigned';

/** Mentor Tasks tab filter pills. `value: undefined` is All. */
export const MENTORSHIP_MENTOR_TASK_AWAITING_REVIEW_LABEL = 'Awaiting Review';
export const MENTORSHIP_MENTOR_TASK_APPROVED_LABEL = 'Approved';
export const MENTORSHIP_MENTOR_TASK_APPROVE_LABEL = 'Approve';
export const MENTORSHIP_MENTOR_TASK_REQUEST_CHANGES_LABEL = 'Request Changes';
export const MENTORSHIP_MENTOR_TASK_OPEN_SUBMISSION_LABEL = 'Open Submission';
export const MENTORSHIP_MENTOR_TASK_SUBMITTED_VERB = 'submitted';
export const MENTORSHIP_MENTOR_TASK_COMPLETED_VERB = 'completed';
export const MENTORSHIP_MENTOR_TASKS_EMPTY_AWAITING = 'No tasks awaiting review.';
export const MENTORSHIP_MENTOR_TASKS_EMPTY_APPROVED = 'No approved tasks.';
export const MENTORSHIP_MENTOR_TASKS_EMPTY_ALL = 'No tasks to review.';

export const MENTORSHIP_MENTOR_TASK_FILTER_PILLS: { value: MentorshipMentorTaskReviewStatus | undefined; label: string }[] = [
  { value: 'submitted', label: MENTORSHIP_MENTOR_TASK_AWAITING_REVIEW_LABEL },
  { value: 'completed', label: MENTORSHIP_MENTOR_TASK_APPROVED_LABEL },
  { value: undefined, label: 'All' },
];

export const MENTORSHIP_MENTOR_REGISTER_TITLE = 'Become a Mentor';
export const MENTORSHIP_MENTOR_REGISTER_SUBTITLE = 'Register as a mentor and request to join the programs you want to support. Fields marked * are required.';

export const MENTORSHIP_MENTOR_PROGRAMS_INTRO = 'Choose the LFX mentorships you would like to join as a mentor. Your requests are listed below.';
export const MENTORSHIP_MENTOR_PROGRAMS_HELPER =
  "You can choose more than one. Each request goes to that program's administrator, and you can withdraw it while it is pending.";

/** Success-toast copy shown once the mentor profile has been saved to the mentorship platform. */
export const MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY = 'Profile created';
export const MENTORSHIP_MENTOR_SUBMIT_SUCCESS_DETAIL = 'Your mentor profile has been saved.';

/** Error code the BFF puts on the 409 returned when a mentor profile already exists. */
export const MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE = 'MENTOR_PROFILE_EXISTS';

/**
 * Mentor-specific failure-banner copy for a rejected registration submit. The conflict, read-only and
 * fallback copy both register forms share is `MENTORSHIP_REGISTER_ERROR_*` in `mentorship.constants.ts`.
 */
export const MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS = 'You already have a mentor profile, so we did not overwrite it.';
export const MENTORSHIP_MENTOR_REGISTER_PROFILE_EXISTS_CONTINUE = 'Go to My Programs';

/** The form fields a server 400 can name; anything else in `errors[]` is ignored rather than shown against a field that does not exist. */
export const MENTORSHIP_MENTOR_REGISTER_FIELD_KEYS: readonly (keyof MentorshipMentorRegisterFieldErrors)[] = [
  'introduction',
  'skills',
  'complianceAccepted',
  'termsAccepted',
];

/**
 * How `mapMentorshipRegisterFailure` classifies a rejected Become a Mentor submit. There is no
 * `ineligibleMessage`: mentors have no eligibility statements, so a 422 gets the fallback copy.
 */
export const MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS: MentorshipRegisterFailureOptions<MentorshipMentorRegisterFieldErrors> = {
  profileExistsCode: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  profileExistsMessage: MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
  fieldKeys: MENTORSHIP_MENTOR_REGISTER_FIELD_KEYS,
};

export const MENTORSHIP_MENTOR_INTRODUCTION_INTRO =
  'This information is displayed on your mentor profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER = `What is your current contributor status (i.e., experience in contributing to or maintaining open source projects, open source contributions)?

Why are you interested in volunteering as a mentor?

Tell us something that makes you unique.`;

/** Matches `MENTORSHIP_ENROLL_DESCRIPTION_MAX`, since both feed the same kind of rich-text field. */
export const MENTORSHIP_MENTOR_INTRODUCTION_MAX = 3000;

export const MENTORSHIP_MENTOR_SKILLS_INTRO = 'What are the skills that you are respected and known for? This helps match you with the right candidates.';

export const MENTORSHIP_MENTOR_TERMS_INTRO =
  'Before you submit your mentor registration to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_MENTOR_EXPORT_DISCLAIMER =
  'At this moment we are not accepting applications from a person or entity restricted by U.S. export controls or sanction programs, or a resident of Cuba, Iran, North Korea, Syria, Sudan, Russian Federation or Crimea region of Ukraine.';

export const MENTORSHIP_MENTOR_COMPLIANCE_LEAD = 'I hereby certify that I am not, and/or the organization I am representing is not:';

export const MENTORSHIP_MENTOR_COMPLIANCE_ITEMS: readonly string[] = [
  'located in Cuba, Iran, North Korea, Syria, the Crimea Region of Ukraine, or the Russian-controlled areas of the Donetsk or Luhansk regions of Ukraine;',
  'owned or controlled by, acting for or on behalf of, or an individual or entity that has in the past acted for or on behalf of the Government of Cuba, Iran, North Korea, Syria, or Venezuela; or',
  "listed as a blocked person by the U.S. Department of the Treasury's Office of Foreign Assets Control (OFAC), or directly or indirectly owned 50 percent or more by such a listed person.",
];

/**
 * Request statuses as the mentor sees them. Spread from the admin labels so the two can
 * only differ where this file says so, and reuse
 * `MENTORSHIP_MENTOR_STATUS_BADGE_CLASSES` for the colors.
 */
export const MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS: Record<MentorshipMentorStatus, string> = {
  ...MENTORSHIP_MENTOR_STATUS_LABELS,
  // The admin tab reads "Invited" because the admin sent the invitation. The same status
  // also covers a request the mentor raised themselves, so from this side it stays neutral.
  pending: 'Pending',
};

/**
 * Request statuses that keep a program out of the mentor picker: one already waiting on the
 * administrator, one accepted, or one declined, which upstream will not take a new request for.
 * Only a withdrawn request leaves the program pickable, and asking again reopens it.
 */
export const MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES: readonly MentorshipMentorStatus[] = ['pending', 'accepted', 'declined'];

/** Programs per page in the mentor program picker. Upstream caps a page at 100. */
export const MENTORSHIP_MENTOR_OPEN_PROGRAMS_PAGE_SIZE = 20;

/** Longest picker search the BFF accepts. No program name needs more to be found. */
export const MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH = 100;

/** Longest mentor invite token accepted. Upstream's tokens are about 200 characters. */
export const MENTORSHIP_MENTOR_INVITE_TOKEN_MAX_LENGTH = 512;

/** How long the picker waits after the last keystroke before searching. */
export const MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS = 300;

/** Row height in the picker's virtual scroll, in px. */
export const MENTORSHIP_MENTOR_PICKER_ITEM_SIZE = 40;

/** Tallest the picker's list grows, in px; past this it scrolls. */
export const MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT = 240;

/**
 * The select list's top and bottom padding together (the theme's `select.list.padding`, 0.25rem
 * each). The scroller adds it to the scroll height, so the list's height must too, or a short list
 * scrolls by that much.
 */
export const MENTORSHIP_MENTOR_PICKER_LIST_PADDING = '0.5rem';

/**
 * Turns off the PrimeNG scroller's auto-size. It measures the list before redrawing it for a new
 * item count, so a search that matches after one that matched nothing kept the empty list's
 * few-px height. The picker sizes the list itself instead.
 */
export const MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS = { autoSize: false };

/** Note on a disabled picker option the mentor holds an invitation to. */
export const MENTORSHIP_MENTOR_PICKER_INVITED_NOTE = 'Invited';

/**
 * Note on a disabled picker option a request found gone (404). A page of programs already read still
 * lists it, so the picker disables it rather than let the mentor pick it again.
 */
export const MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE = 'No longer available';

/** Shown under the picker when a page of programs cannot be read. */
export const MENTORSHIP_MENTOR_PROGRAMS_LOAD_FAILED_MESSAGE = "We couldn't load programs.";

/** Shown in the picker's list while a search waits on its answer, so a slow read never says there are no programs. */
export const MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE = 'Searching programs…';

/** Shown in the picker's list once a read answers with no programs. */
export const MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE = 'No results found';

/** Shown in place of the request list when it cannot be read, so a failed read never looks like "no requests". */
export const MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE = "We couldn't load your program requests.";

export const MENTORSHIP_MENTOR_WITHDRAW_CONFIRM = 'Are you sure you want to withdraw this request?';
export const MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER = 'Withdraw Request';
export const MENTORSHIP_MENTOR_WITHDRAW_LABEL = 'Withdraw';
export const MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL = 'Cancel';
export const MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY = 'Request withdrawn';
export const MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_DETAIL = 'Your request to mentor this program has been withdrawn.';
export const MENTORSHIP_MENTOR_WITHDRAW_ERROR_SUMMARY = 'Could not withdraw the request';

/**
 * Withdraw failures that mean the mentor's view of the request is out of date, keyed by status: 409 is
 * upstream refusing to withdraw a request no longer waiting on the administrator, and 404 is a request
 * that is gone or not the mentor's. The page shows this copy and re-reads the requests; any other
 * status shows the fallback and keeps them.
 */
export const MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  404: 'This request no longer exists. Your requests have been refreshed.',
  409: 'This request is no longer pending, so it cannot be withdrawn. Your requests have been refreshed.',
};

export const MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY = 'Request sent';
export const MENTORSHIP_MENTOR_REQUEST_SUCCESS_DETAIL = 'Your request to mentor this program has been sent.';
/** Summary of the one success toast a batch of requests shows; its detail lists the programs sent. */
export const MENTORSHIP_MENTOR_REQUESTS_SUCCESS_SUMMARY = 'Requests sent';
export const MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY = 'Could not send the request';
export const MENTORSHIP_MENTOR_REQUEST_ERROR_FALLBACK = 'Something went wrong. Please try again.';
export const MENTORSHIP_MENTOR_REQUEST_TOAST_LIFE = 5000;

/**
 * Request failures with their own copy, keyed by status. A 404 is upstream no longer finding the
 * program, or no longer showing it. A 409 is upstream finding a request, invitation, membership or
 * declined request of the mentor's for that program already. Both mean the picker is out of date,
 * so the requests are re-read.
 */
export const MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  404: 'This program is no longer available.',
  409: 'You already have a request, invitation or membership for this program.',
};

export function createEmptyMentorshipMentorForm(): MentorshipMentorRegisterForm {
  return {
    introduction: '',
    skills: [],
    complianceAccepted: false,
    termsAccepted: false,
  };
}

/**
 * Copy for the standalone Mentor Profile page at `/mentorship/mentor/profile`.
 * Sections mirror the Become a Mentor registration form: about-me introduction and
 * skills tags, plus a read-only mentoring history.
 */
export const MENTORSHIP_MENTOR_PROFILE_DETAILS_TITLE = 'Mentor Profile';
export const MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL = 'Edit Mentor Profile';
export const MENTORSHIP_MENTOR_PROFILE_ABOUT_LABEL = 'About Me';
export const MENTORSHIP_MENTOR_PROFILE_SKILLS_LABEL = 'Skills';
export const MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY = 'No introduction added yet.';
export const MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY = 'No skills added yet.';

/**
 * Copy for the mentor profile edit drawer — the slide-in panel opened from the
 * "Edit Mentor Profile" button on the standalone mentor profile page.
 */
export const MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL = 'Save';
export const MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL = 'Cancel';

/** The fields `PATCH /api/mentorship/mentor/profile` accepts; any other key is a 400. */
export const MENTORSHIP_MENTOR_PROFILE_UPDATE_KEYS = ['introduction', 'skills'] as const;

/** Inline message for a failed profile save, keyed by the BFF's status. Any other status gets the fallback. */
export const MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Some of your changes could not be saved. Review them and try again.',
  404: 'We could not find your mentor profile. Refresh the page and try again.',
  409: 'Your mentor profile could not be updated because of a conflict. Refresh the page and try again.',
};
export const MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_FALLBACK = 'We could not save your changes. Please try again.';
export const MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY = 'Profile updated';
export const MENTORSHIP_MENTOR_PROFILE_SAVE_TOAST_LIFE = 5000;

export const MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY = 'Note saved';
export const MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY = 'Note cleared';
export const MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_SUMMARY = 'Could not save the note';
export const MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_FALLBACK = 'Something went wrong. Please try again.';
export const MENTORSHIP_MENTOR_NOTE_TOAST_LIFE = 5000;

/**
 * Note save failures with their own copy, keyed by the BFF's status. A 403 is upstream no longer finding the
 * caller an active mentor of the program, and a 404 an application that is gone; both mean the page is out of date.
 */
export const MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  403: 'You can no longer edit notes on this program. Refresh the page and try again.',
  404: 'This application no longer exists. Refresh the page and try again.',
};

export const MENTORSHIP_MENTORING_HISTORY_TITLE = 'Mentoring History';
export const MENTORSHIP_MENTORING_HISTORY_EMPTY_TITLE = 'No mentoring history yet';
export const MENTORSHIP_MENTORING_HISTORY_EMPTY_SUBTITLE = 'Programs you mentor on will appear here once your first term begins.';

/** Mentoring history badge copy. */
export const MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS: Record<MentorshipMentoringHistoryStatus, string> = {
  'in-progress': 'In Progress',
  completed: 'Completed',
};

/**
 * Runtime Tailwind class map for the Mentoring History status badge. The tokens live
 * outside the app's `content` glob, so this map's values are also spread into the
 * Tailwind safelist — a status/class change here cannot silently lose styling.
 */
export const MENTORSHIP_MENTORING_HISTORY_STATUS_BADGE_CLASSES: Record<MentorshipMentoringHistoryStatus, string> = {
  'in-progress': 'bg-blue-50 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
};

export const EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE: MentorshipMentorProfileResponse = {
  profile: { aboutMe: '', skills: [] },
  history: [],
};
