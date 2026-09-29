// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MentorshipMenteeApplyBlockedReason,
  MentorshipMenteeApplyBlockedState,
  MentorshipMenteeDemographicRow,
} from '../interfaces/mentorship-mentee.interface';

export const MENTORSHIP_MENTEE_REGISTER_TITLE = 'Become a Mentee';

/**
 * Split around the `*` so the template can render it in red, matching how every
 * required-field marker elsewhere on this form is styled.
 */
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX = 'Register as a mentee to apply for LFX mentorship programs. Fields marked ';
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX = ' are required.';

export const MENTORSHIP_MENTEE_INTRODUCTION_INTRO =
  'This information is displayed on your mentee profile page. Your name, email and avatar come from your LFX account.';
/** Canonical About Me prompts — register placeholder and profile-edit list both derive from this. */
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS = [
  'What is your current status, are you a student/transitioning into a new career?',
  'What are your goals and aspirations?',
  'Why are you interested in this mentorship opportunity?',
  'Tell us something that makes you unique as an applicant.',
] as const;
export const MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER = MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS.join('\n');

/** Matches `MENTORSHIP_MENTOR_INTRODUCTION_MAX`, since both feed the same kind of rich-text field. */
export const MENTORSHIP_MENTEE_INTRODUCTION_MAX = 3000;

export const MENTORSHIP_MENTEE_SKILLS_INTRO = 'Tell us about your current skills and the skills you want to grow, so we can match you with the right mentor.';
export const MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL = 'What skills do you currently have?';
export const MENTORSHIP_MENTEE_SKILLS_WANT_LABEL = 'What skills would you like to improve?';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL = 'Anything else you want mentors to know?';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER = 'Share any other context that would help a mentor get to know you.';
export const MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX = 1000;

export const MENTORSHIP_MENTEE_RESUME_INTRO = 'Optional, but mentors often look you up before accepting a mentee.';

export const MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE = 'Demographics';
export const MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO =
  'Optional and purely voluntary. Answers are confidential, are not shared with mentors, and are used only for aggregate diversity reporting.';

/** Identical consent text every demographic row's checkbox shows, per LFXV2 privacy copy. */
export const MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL = 'I consent to use of this information for the purpose listed above.';

export const MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX = 'You may request removal of this information from Mentorship at any time by writing to ';
export const MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL = 'privacy@linuxfoundation.org';

/** The persisted opt-out token shared by every demographic row's answer dropdown (#1509). */
export const MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY = 'preferNotToSay';

/**
 * The five demographic questions, each pairing a consent checkbox with its answer
 * dropdown so the section can `@for` over one data-driven list instead of five
 * hand-written blocks. Question text is reproduced verbatim from the program's
 * demographic survey; `value`s are the persisted contract (#1509) — normalised as
 * compact tokens rather than the display copy, so a future rewording of a label does
 * not silently invalidate stored answers. `MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY`
 * repeats on every row so callers can filter opt-outs uniformly.
 */
export const MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS: MentorshipMenteeDemographicRow[] = [
  {
    consentControl: 'ageConsent',
    answerControl: 'age',
    question: 'How old are you?',
    options: [
      { text: '19 or younger', value: '-19' },
      { text: '20-39', value: '20-39' },
      { text: '40-60', value: '40-60' },
      { text: '61 or older', value: '61+' },
      { text: `I don't want to provide`, value: MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY },
    ],
  },
  {
    consentControl: 'raceEthnicityConsent',
    answerControl: 'raceEthnicity',
    question: 'What is your racial or ethnic identity?',
    options: [
      { text: 'American Indian or Alaska Native', value: 'americanIndianOrAlaskaNative' },
      { text: 'Asian', value: 'asian' },
      { text: 'Black or African American', value: 'blackOrAfricanAmerican' },
      { text: 'Hispanic or Latino', value: 'hispanicOrLatino' },
      { text: 'Native Hawaiian or Other Pacific Islander', value: 'nativeHawaiianOrPacificIslander' },
      { text: 'White', value: 'white' },
      { text: 'Two or more races', value: 'twoOrMoreRaces' },
      { text: `I don't want to provide`, value: MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY },
    ],
  },
  {
    consentControl: 'genderConsent',
    answerControl: 'gender',
    question: 'Which gender do you identify with?',
    options: [
      { text: 'Male', value: 'male' },
      { text: 'Female', value: 'female' },
      { text: 'Non-binary', value: 'nonBinary' },
      { text: `I don't want to provide`, value: MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY },
    ],
  },
  {
    consentControl: 'incomeConsent',
    answerControl: 'income',
    question: 'Which socioeconomic class do you identify with?',
    options: [
      { text: 'Working class', value: 'workingClass' },
      { text: 'Lower middle class', value: 'lowerMiddleClass' },
      { text: 'Upper middle class', value: 'upperMiddleClass' },
      { text: 'Upper class', value: 'upperClass' },
      { text: `I don't want to provide`, value: MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY },
    ],
  },
  {
    consentControl: 'educationConsent',
    answerControl: 'education',
    question: 'What is your education level?',
    options: [
      { text: 'Some high school', value: 'someHighSchool' },
      { text: 'Some college/technical training', value: 'someCollege' },
      { text: 'Completed college', value: 'college' },
      { text: `Completed master's degree`, value: 'masters' },
      { text: 'Completed Ph.D.', value: 'phd' },
      { text: `I don't want to provide`, value: MENTORSHIP_MENTEE_DEMOGRAPHIC_PREFER_NOT_TO_SAY },
    ],
  },
];

export const MENTORSHIP_MENTEE_ELIGIBILITY_TITLE = 'Eligibility Requirements';
export const MENTORSHIP_MENTEE_ELIGIBILITY_INTRO = 'Confirm each of the following before submitting your mentee registration.';

export const MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL = 'I am at least 18 years of age, or will be by the time the mentorship program starts.';
export const MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL = 'I am eligible to work in the country I reside in for the duration of the mentorship.';
export const MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL =
  'I do not have another mentee profile on the LFX Mentorship platform and am not participating in another Linux Foundation mentorship program. Doing so will disqualify me from the program.';

export const MENTORSHIP_MENTEE_TERMS_INTRO =
  'Before you submit your mentee registration to the LFX Platform, review and accept the terms and conditions below.';

export const MENTORSHIP_MENTEE_EXPORT_DISCLAIMER =
  'At this moment we are not accepting applications from a person or entity restricted by U.S. export controls or sanction programs, or a resident of Cuba, Iran, North Korea, Syria, Sudan, Russian Federation or Crimea region of Ukraine.';

/**
 * Success-toast copy for a client-validated mentee submit. Kept honest because the
 * backend endpoint is not live yet (#1509): the toast reports what actually happened
 * (validation passed) rather than claiming the registration was sent to the platform.
 */
export const MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY = 'Registration validated';
export const MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL =
  'Your mentee registration passed all checks. Submission to the mentorship platform will complete once the backend goes live.';

// ---------------------------------------------------------------------------
// Mentee shell page — tab metadata, overview, and tasks
// ---------------------------------------------------------------------------

import type {
  MentorshipMenteeApplicationHistoryStatus,
  MentorshipMenteeApplicationStatus,
  MentorshipMenteePastOutcome,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeTaskStatus,
  MentorshipUpstreamApplicationStatus,
} from '../interfaces/mentorship-mentee.interface';

// ---------------------------------------------------------------------------
// Tab config — My Tasks is always shown and renders its own empty state
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_TABS = [
  { value: 'overview' as const, label: 'Overview' },
  { value: 'tasks' as const, label: 'My Tasks' },
  { value: 'profile' as const, label: 'Mentee Profile' },
] as const;

// ---------------------------------------------------------------------------
// Shell labels
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_SHELL_TITLE = 'My Mentorship';
export const MENTORSHIP_MENTEE_FIND_PROGRAM_LABEL = 'Find a Program';
export const MENTORSHIP_MENTEE_FIND_PROGRAM_URL = 'https://mentorship.dev.lfx.dev/programs';
export const MENTORSHIP_MENTEE_TASKS_URL = '/mentorship/mentee/tasks';

// ---------------------------------------------------------------------------
// Overview — empty phase
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_EMPTY_TITLE = "You haven't applied to a program yet";
export const MENTORSHIP_MENTEE_EMPTY_SUBTITLE =
  'Browse open programs and apply to up to three in a term. Your applications, prerequisite tasks and decisions will show up here.';
export const MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR = 'We could not load your mentee overview. Please retry.';

// ---------------------------------------------------------------------------
// Overview — applicant phase
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_SINGULAR = 'application under review';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_PLURAL = 'applications under review';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY =
  'Program admins review submissions after the application window closes. Finish the prerequisite tasks to be considered.';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX =
  ' You can hold three applications at a time and you are at the limit — withdraw one before you apply to another program.';
export const MENTORSHIP_MENTEE_APPLICATION_LIMIT = 3;

export const MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS: Record<MentorshipMenteeApplicationStatus, string> = {
  active: 'Active',
  graduated: 'Graduated',
  'awaiting-review': 'Awaiting Review',
  'in-progress': 'In Progress',
};

/**
 * Runtime Tailwind class map for the application status badge. Spread into the
 * Tailwind safelist, since these tokens live outside the app's `content` glob.
 */
export const MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES: Record<MentorshipMenteeApplicationStatus, string> = {
  active: 'bg-blue-50 text-blue-700',
  graduated: 'bg-violet-50 text-violet-700',
  'awaiting-review': 'bg-amber-50 text-amber-700',
  'in-progress': 'bg-emerald-50 text-emerald-700',
};

/** Display order of the application cards on the Overview and My Tasks tabs. */
export const MENTORSHIP_MENTEE_APPLICATION_STATUS_ORDER: readonly MentorshipMenteeApplicationStatus[] = [
  'active',
  'graduated',
  'awaiting-review',
  'in-progress',
];

/**
 * Progress label per card status. An accepted (active) or graduated card counts its
 * non-prerequisite tasks; a pending card counts its prerequisite tasks.
 */
export const MENTORSHIP_MENTEE_APPLICATION_PROGRESS_LABELS: Record<MentorshipMenteeApplicationStatus, string> = {
  active: 'Tasks',
  graduated: 'Tasks',
  'awaiting-review': 'Prerequisite Tasks',
  'in-progress': 'Prerequisite Tasks',
};

/**
 * Upstream application statuses that land in Past Applications, and the outcome each
 * one shows. `pending`, `accepted` and `graduated` are absent because they render as cards.
 */
export const MENTORSHIP_MENTEE_PAST_OUTCOME_BY_STATUS: Partial<Record<MentorshipUpstreamApplicationStatus, MentorshipMenteePastOutcome>> = {
  declined: 'not-selected',
  withdrawn: 'withdrawn',
  hold: 'on-hold',
};

export const MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS: Record<MentorshipMenteePastOutcome, string> = {
  'not-selected': 'Not selected',
  withdrawn: 'Withdrawn',
  'on-hold': 'On Hold',
};

/** Runtime Tailwind class map for the past-outcome badge. Spread into the Tailwind safelist. */
export const MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES: Record<MentorshipMenteePastOutcome, string> = {
  'not-selected': 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-600',
  'on-hold': 'bg-blue-100 text-blue-700',
};

export const MENTORSHIP_MENTEE_WITHDRAW_LABEL = 'Withdraw';
export const MENTORSHIP_MENTEE_WITHDRAW_CANCEL_LABEL = 'Cancel';
export const MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER = 'Withdraw Application';
export const MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_MESSAGE = 'Are you sure you want to withdraw this application? Its mentors will no longer review it.';
export const MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY = 'Application withdrawn';
export const MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_DETAIL = 'Your application has been withdrawn.';
export const MENTORSHIP_MENTEE_WITHDRAW_ERROR_SUMMARY = 'Could not withdraw the application';
export const MENTORSHIP_MENTEE_WITHDRAW_ERROR_FALLBACK = 'Something went wrong. Please try again.';
export const MENTORSHIP_MENTEE_WITHDRAW_TOAST_LIFE = 5000;

/**
 * The code the BFF's impersonation guard (`blockDuringImpersonation`) puts on its 403. That 403
 * says nothing about the application, so the mentee pages that write (withdraw, apply) show the
 * server's message and leave what is on screen as it is.
 */
export const MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE = 'IMPERSONATION_READ_ONLY';

/**
 * Withdraw failures that mean the mentee's view of the application is out of date, keyed by
 * status: 409 is upstream refusing a transition out of anything but `pending`, 403 is the
 * applicant check failing, and 404 is an application that no longer exists. The page shows
 * this copy and re-reads the applications; any other status shows the fallback and keeps them.
 */
export const MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  403: 'You can no longer withdraw this application. Your applications have been refreshed.',
  404: 'This application no longer exists. Your applications have been refreshed.',
  409: 'This application is no longer pending, so it cannot be withdrawn. Your applications have been refreshed.',
};
export const MENTORSHIP_MENTEE_VIEW_TASKS_LABEL = 'View Tasks';
export const MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE = 'Past Applications';

// ---------------------------------------------------------------------------
// Tasks tab — unified task status labels, classes, and dropdown options
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_TASK_STATUS_LABELS: Record<MentorshipMenteeTaskStatus, string> = {
  pending: 'To Do',
  incomplete: 'To Do',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  complete: 'Submitted',
};

export const MENTORSHIP_MENTEE_TASK_STATUS_CLASSES: Record<MentorshipMenteeTaskStatus, string> = {
  pending: 'bg-gray-100 !text-gray-600',
  incomplete: 'bg-gray-100 !text-gray-600',
  in_progress: 'bg-blue-100 !text-blue-700',
  submitted: 'bg-emerald-100 !text-emerald-700',
  complete: 'bg-emerald-100 !text-emerald-700',
};

/**
 * Selectable task statuses in the dropdown (every card) — the single source of
 * truth for which statuses a mentee can pick. `incomplete` / `complete` are
 * backend aliases that collapse onto these three.
 */
export const MENTORSHIP_MENTEE_TASK_SELECTABLE_STATUSES: readonly MentorshipMenteeTaskStatus[] = ['pending', 'in_progress', 'submitted'];

/** Dropdown options for the task status selector (every card). Labels derived from the label map so edits propagate. */
export const MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS: { value: MentorshipMenteeTaskStatus; label: string }[] = MENTORSHIP_MENTEE_TASK_SELECTABLE_STATUSES.map(
  (value) => ({ value, label: MENTORSHIP_MENTEE_TASK_STATUS_LABELS[value] })
);

/**
 * Filter chip options on an accepted application's My Tasks card. `null` value = show all.
 * Derived from `MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS` (the single source of truth
 * for selectable statuses) plus a leading "All" chip, so new status options
 * propagate here automatically.
 */
export const MENTORSHIP_MENTEE_TASK_FILTER_OPTIONS: { value: MentorshipMenteeTaskStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  ...MENTORSHIP_MENTEE_TASK_STATUS_OPTIONS,
];

/** Natural case — the template applies the `uppercase` Tailwind class for display. */
export const MENTORSHIP_MENTEE_TASKS_TAB_PREREQUISITE_LABEL = 'Prerequisite Tasks';

export const MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE = 'No tasks yet';
export const MENTORSHIP_MENTEE_TASKS_EMPTY_SUBTITLE = 'Tasks from the programs you apply to will appear here. Browse open programs to get started.';
export const MENTORSHIP_MENTEE_TASKS_LOAD_ERROR = 'Could not load your tasks. Please retry.';
export const MENTORSHIP_MENTEE_TASKS_APPLICATION_EMPTY = 'No tasks for this application yet.';

// ---------------------------------------------------------------------------
// Profile tab constants and mock data
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_PROFILE_DETAILS_TITLE = 'Mentee Profile';
export const MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL = 'Edit Mentee Profile';
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_LABEL = 'About Me';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_LABEL = 'Skills';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_LABEL = 'Areas to Improve';
export const MENTORSHIP_MENTEE_PROFILE_NOTES_LABEL = 'Additional Notes';
export const MENTORSHIP_MENTEE_PROFILE_RESUME_LABEL = 'Resume';
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY = 'No introduction added yet.';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY = 'No skills added yet.';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EMPTY = 'No areas to improve added yet.';
export const MENTORSHIP_MENTEE_PROFILE_NOTES_EMPTY = 'No additional notes added yet.';
export const MENTORSHIP_MENTEE_PROFILE_RESUME_EMPTY = 'No resume uploaded yet.';
/**
 * Fallback anchor label when the profile carries a `resumeUrl` but no `resumeFileName` —
 * the two fields are independently optional in `MentorshipMenteeProfileDetails`.
 */
export const MENTORSHIP_MENTEE_PROFILE_RESUME_VIEW_LABEL = 'View resume';

// ---------------------------------------------------------------------------
// Mentee apply page — `/mentorship/mentee/apply?programId=&programTermId=`
// ---------------------------------------------------------------------------

/** Router `state` key set after a validated registration so the apply guard allows that one return trip. */
export const MENTORSHIP_MENTEE_PROFILE_CREATED_STATE = 'menteeProfileCreated';

export const MENTORSHIP_MENTEE_APPLY_TITLE_PREFIX = 'Apply to ';
export const MENTORSHIP_MENTEE_APPLY_PROFILE_TITLE = 'Your Mentee Profile';
export const MENTORSHIP_MENTEE_APPLY_PROFILE_SUBTITLE =
  'Your about me, skills and links are used from your mentee profile and shared with the mentors reviewing this application.';

export const MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_OPTIONAL = '(optional)';
export const MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_INTRO =
  'Collected only for aggregate diversity reporting. Kept confidential, never shared with mentors reviewing this application.';
export const MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL = 'Edit Demographics';
export const MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EMPTY = 'Not provided';

/** `aria-labelledby` target for the demographics edit drawer header — shared between the `[pt]` override and the header title element. */
export const MENTORSHIP_MENTEE_DEMOGRAPHICS_EDIT_DRAWER_TITLE_ID = 'mentorship-mentee-demographics-edit-drawer-title';

/** Short column labels for the apply-page demographics summary. Order matches the design grid. */
export const MENTORSHIP_MENTEE_APPLY_DEMOGRAPHIC_FIELDS = [
  { answerControl: 'age', label: 'Age' },
  { answerControl: 'raceEthnicity', label: 'Racial or Ethnic Identity' },
  { answerControl: 'gender', label: 'Gender' },
  { answerControl: 'income', label: 'Socioeconomic Class' },
  { answerControl: 'education', label: 'Education Level' },
] as const;

export const MENTORSHIP_MENTEE_APPLY_BEFORE_TITLE = 'Before You Apply';
export const MENTORSHIP_MENTEE_APPLY_BEFORE_INTRO = 'Confirm each of the following. All five are required to submit your application.';
export const MENTORSHIP_MENTEE_APPLY_PUBLICITY_NOTE =
  'If you are accepted, the program may display and share portions of your profile information to publicize your participation.';
export const MENTORSHIP_MENTEE_APPLY_REMAINING_LABEL = 'remaining';
export const MENTORSHIP_MENTEE_APPLY_SUBMIT_LABEL = 'Submit Application';
export const MENTORSHIP_MENTEE_APPLY_CANCEL_LABEL = 'Cancel';
export const MENTORSHIP_MENTEE_APPLY_CONFIRMATION_COUNT = 5;

export const MENTORSHIP_MENTEE_APPLY_MISSING_TITLE = 'This application link is incomplete';
export const MENTORSHIP_MENTEE_APPLY_MISSING_SUBTITLE = 'Open the apply link from the mentorship program so the program and term are included.';
export const MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_TITLE = 'Could not load this application';
export const MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_FALLBACK = 'We could not load this application. Please retry.';

export const MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY = 'Application submitted';
export const MENTORSHIP_MENTEE_APPLY_SUCCESS_DETAIL = 'Your application has been submitted. You can follow it from your overview.';
export const MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY = 'Could not submit the application';
export const MENTORSHIP_MENTEE_APPLY_ERROR_FALLBACK = 'Something went wrong. Please try again.';
export const MENTORSHIP_MENTEE_APPLY_TOAST_LIFE = 5000;

/** Copy for each state the apply page shows in place of the form. */
export const MENTORSHIP_MENTEE_APPLY_BLOCKED_STATES: Readonly<Record<MentorshipMenteeApplyBlockedReason, MentorshipMenteeApplyBlockedState>> = {
  'not-found': {
    icon: 'fa-light fa-magnifying-glass',
    title: 'This program term could not be found',
    subtitle: 'The link may be out of date, or the program is no longer available.',
  },
  closed: {
    icon: 'fa-light fa-calendar-xmark',
    title: 'This term is not accepting applications',
    subtitle: 'Applications for this term are closed or have not opened yet.',
  },
  'already-applied': {
    icon: 'fa-light fa-circle-check',
    title: 'You already applied to this term',
    subtitle: 'You have an application for this term, so you cannot apply again. Your applications are on your overview.',
  },
};

/**
 * Upstream statuses on the apply-target read or the submit that mean the form cannot be used,
 * keyed by status. 400 is an id that is not a UUID, 403 a program the mentee cannot view, 404 a
 * term that is not in the program, 422 a term outside its application window, and 409 an existing
 * application for the term (pending, decided or declined; upstream does not say which). Any other
 * status keeps the form and reports the failure.
 */
export const MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS: Readonly<Record<number, MentorshipMenteeApplyBlockedReason>> = {
  400: 'not-found',
  403: 'not-found',
  404: 'not-found',
  409: 'already-applied',
  422: 'closed',
};

/**
 * Copy for the mentee profile edit drawer — the slide-in panel opened from the
 * "Edit Mentee Profile" button. Save fires the coming-soon toast until the update
 * endpoint is wired. Drawer-only labels: the Become a Mentee register form keeps its
 * own intro / skill copy. About Me uses the same 3000 code-point cap as register.
 */
export const MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE =
  'Your mentee profile is shared with mentors reviewing your applications. It is separate from your LFX account details.';
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_INTRO = 'Your background, goals, and what makes you a good fit for a mentorship. Answer the following:';
/**
 * Same 3000 code-point cap as register About Me (`introduction`). Issue #2764's
 * mockup showed a 2000 counter; clipping the drawer to 2000 would truncate a
 * register-length intro on seed, so edit and register share this constant.
 */
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX = MENTORSHIP_MENTEE_INTRODUCTION_MAX;
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO =
  'Enter your current skills as well as skills you would like to improve, so mentors can match you with the right program.';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL = 'What skills are you currently proficient in?';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL = 'What areas do you want to improve in?';
export const MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL = 'Save Changes';
export const MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL = 'Cancel';

export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_TITLE = 'Application History';
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_TITLE = 'No application history yet';
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_EMPTY_SUBTITLE = 'Programs you apply to will appear here once you submit your first application.';
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_VIEW_LABEL = 'View program';
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_WITHDRAW_LABEL = 'Withdraw application';

/**
 * Application History badge copy. Labels are display-only — stored values stay the
 * `applications.status` enum (`pending`, `declined`, never `in-review` / `rejected`).
 */
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_LABELS = {
  pending: 'In Review',
  accepted: 'Accepted',
  declined: 'Not Selected',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
  hold: 'On Hold',
} as const satisfies Record<MentorshipMenteeApplicationHistoryStatus, string>;

/**
 * Runtime Tailwind class map for the Application History status badge. The tokens live
 * outside the app's `content` glob, so this map's values are also spread into the
 * Tailwind safelist — a status/class change here cannot silently lose styling.
 */
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_BADGE_CLASSES = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-gray-100 text-gray-600',
  withdrawn: 'bg-gray-100 text-gray-600',
  graduated: 'bg-emerald-50 text-emerald-700',
  hold: 'bg-blue-50 text-blue-700',
} as const satisfies Record<MentorshipMenteeApplicationHistoryStatus, string>;

/**
 * Neutral fallback when `applications.status` is not in the enum map. Must not
 * reuse declined/withdrawn classes, or an unknown future status would look like
 * "Not Selected".
 */
export const MENTORSHIP_MENTEE_APPLICATION_HISTORY_STATUS_UNKNOWN_BADGE_CLASS = 'bg-slate-100 text-slate-700';

export const EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE: MentorshipMenteeProfileResponse = {
  profile: { aboutMe: '', skillsHave: [], skillsWant: [] },
  history: [],
};

// ---------------------------------------------------------------------------
// Dev shortcuts
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_DEV_DASHBOARD_LABEL = 'Go to Mentee Dashboard';
