// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MentorshipMenteeDemographicRow } from '../interfaces/mentorship.interface';

export const MENTORSHIP_MENTEE_REGISTER_TITLE = 'Become a Mentee';

/**
 * Split around the `*` so the template can render it in red, matching how every
 * required-field marker elsewhere on this form is styled.
 */
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX = 'Register as a mentee to apply for LFX mentorship programs. Fields marked ';
export const MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX = ' are required.';

export const MENTORSHIP_MENTEE_INTRODUCTION_INTRO =
  'This information is displayed on your mentee profile page. Your name, email and avatar come from your LFX account.';
export const MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER = `What is your current status, are you a student/transitioning into a new career?
What are your goals and aspirations? 
Why are you interested in this mentorship opportunity?
Tell us something that makes you unique as an applicant.`;

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

/**
 * The five demographic questions, each pairing a consent checkbox with its answer
 * dropdown so the section can `@for` over one data-driven list instead of five
 * hand-written blocks. Question text is reproduced verbatim from the program's
 * demographic survey; `value`s are the persisted contract (#1509) — normalised as
 * compact tokens rather than the display copy, so a future rewording of a label does
 * not silently invalidate stored answers. The same `'preferNotToSay'` value repeats
 * on every row so callers can filter opt-outs uniformly.
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
      { text: `I don't want to provide`, value: 'preferNotToSay' },
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
// Mentee shell page — tab metadata, profile labels, and mock data
// ---------------------------------------------------------------------------

import type {
  MentorshipMenteeApplicationStatus,
  MentorshipMenteeOverviewAccepted,
  MentorshipMenteeOverviewApplicant,
  MentorshipMenteeOverviewEmpty,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePastOutcome,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeTask,
  MentorshipMenteeTasksResponse,
  MentorshipMenteeUpNextTaskStatus,
} from '../interfaces/mentorship.interface';

// ---------------------------------------------------------------------------
// Tab configs — one per phase
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_TABS_EMPTY = [
  { value: 'overview' as const, label: 'Overview' },
  { value: 'profile' as const, label: 'Mentee Profile' },
] as const;

export const MENTORSHIP_MENTEE_TABS_APPLICANT = [
  { value: 'overview' as const, label: 'Overview' },
  { value: 'tasks' as const, label: 'My Application Tasks' },
  { value: 'profile' as const, label: 'Mentee Profile' },
] as const;

export const MENTORSHIP_MENTEE_TABS_ACCEPTED = [
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

// ---------------------------------------------------------------------------
// Overview — empty phase (screen 1)
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_EMPTY_TITLE = "You haven't applied to a program yet";
export const MENTORSHIP_MENTEE_EMPTY_SUBTITLE =
  'Browse open programs and apply to up to three in a term. Your applications, prerequisite tasks and decisions will show up here.';

// ---------------------------------------------------------------------------
// Overview — applicant phase (screen 2)
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_SINGULAR = 'application under review';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_TITLE_SUFFIX_PLURAL = 'applications under review';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_BODY =
  'Program admins review submissions after the application window closes. Finish the prerequisite tasks to be considered.';
export const MENTORSHIP_MENTEE_APPLICANT_BANNER_LIMIT_SUFFIX =
  ' You can hold three applications at a time and you are at the limit \u2014 withdraw one before you apply to another program.';
export const MENTORSHIP_MENTEE_APPLICATION_LIMIT = 3;

export const MENTORSHIP_MENTEE_APPLICATION_STATUS_LABELS: Record<MentorshipMenteeApplicationStatus, string> = {
  'in-progress': 'In Progress',
  'awaiting-review': 'Awaiting Review',
};

export const MENTORSHIP_MENTEE_APPLICATION_STATUS_CLASSES: Record<MentorshipMenteeApplicationStatus, string> = {
  'in-progress': 'bg-emerald-50 text-emerald-700',
  'awaiting-review': 'bg-amber-50 text-amber-700',
};

export const MENTORSHIP_MENTEE_PAST_OUTCOME_LABELS: Record<MentorshipMenteePastOutcome, string> = {
  'not-selected': 'Not selected',
  withdrawn: 'Withdrawn',
  accepted: 'Accepted',
  graduated: 'Graduated',
};

export const MENTORSHIP_MENTEE_PAST_OUTCOME_CLASSES: Record<MentorshipMenteePastOutcome, string> = {
  'not-selected': 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-600',
  accepted: 'bg-emerald-100 text-emerald-700',
  graduated: 'bg-emerald-100 text-emerald-700',
};

export const MENTORSHIP_MENTEE_WITHDRAW_LABEL = 'Withdraw';
export const MENTORSHIP_MENTEE_WITHDRAW_TOAST_SUMMARY = 'Coming Soon';
export const MENTORSHIP_MENTEE_WITHDRAW_TOAST_DETAIL = 'Withdraw will be available once the backend endpoint is live.';
export const MENTORSHIP_MENTEE_VIEW_TASKS_LABEL = 'View Tasks';
export const MENTORSHIP_MENTEE_VIEW_TASKS_TOAST_SUMMARY = 'Coming Soon';
export const MENTORSHIP_MENTEE_ALL_TASKS_TOAST_SUMMARY = 'Coming Soon';
export const MENTORSHIP_MENTEE_PAST_APPLICATIONS_TITLE = 'Past Applications';

// ---------------------------------------------------------------------------
// Overview — accepted phase (screen 3)
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_ACTIVE_BADGE_LABEL = 'Active';
export const MENTORSHIP_MENTEE_YOUR_MENTORS_LABEL = 'YOUR MENTORS';
export const MENTORSHIP_MENTEE_UP_NEXT_TITLE = 'Up Next';
export const MENTORSHIP_MENTEE_ALL_TASKS_LABEL = 'All tasks';

export const MENTORSHIP_MENTEE_UP_NEXT_STATUS_LABELS: Record<MentorshipMenteeUpNextTaskStatus, string> = {
  'in-progress': 'In Progress',
  pending: 'To Do',
  incomplete: 'To Do',
};

export const MENTORSHIP_MENTEE_UP_NEXT_STATUS_CLASSES: Record<MentorshipMenteeUpNextTaskStatus, string> = {
  'in-progress': 'bg-blue-100 text-blue-600',
  pending: 'bg-gray-100 text-gray-600',
  incomplete: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Empty overview response (loading fallback)
// ---------------------------------------------------------------------------

export const EMPTY_MENTORSHIP_MENTEE_OVERVIEW_RESPONSE: MentorshipMenteeOverviewEmpty = {
  phase: 'empty',
};

// ---------------------------------------------------------------------------
// Mock data — three phases
// ---------------------------------------------------------------------------

export const MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY: MentorshipMenteeOverviewEmpty = {
  phase: 'empty',
};

export const MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT: MentorshipMenteeOverviewApplicant = {
  phase: 'applicant',
  openTaskCount: 3,
  applications: [
    {
      id: 'app_apicurio',
      programId: 'prog_apicurio',
      orgAbbreviation: 'AR',
      projectName: 'CNCF',
      term: { id: 'term_apicurio_fall26', name: 'Fall 2026' },
      programName: 'Apicurio Registry: Prompt Template Playground',
      status: 'in-progress',
      lastTaskUpdatedOn: 'Jun 28, 2026',
      decisionExpectedDate: 'Jul 22, 2026',
      prerequisiteTasksCompleted: 1,
      prerequisiteTasksTotal: 3,
    },
    {
      id: 'app_zephyr',
      programId: 'prog_zephyr',
      orgAbbreviation: 'ZR',
      projectName: 'Zephyr Project',
      term: { id: 'term_zephyr_win26', name: 'Winter 2026' },
      programName: 'Zephyr RTOS: Power Management Test Harness',
      status: 'in-progress',
      lastTaskUpdatedOn: 'Jul 1, 2026',
      decisionExpectedDate: 'Aug 5, 2026',
      prerequisiteTasksCompleted: 1,
      prerequisiteTasksTotal: 2,
    },
    {
      id: 'app_janusgraph',
      programId: 'prog_janusgraph',
      orgAbbreviation: 'JA',
      projectName: 'LF AI & Data',
      term: { id: 'term_janusgraph_fall26', name: 'Fall 2026' },
      programName: 'JanusGraph: Adjacency Cache Instrumentation',
      status: 'awaiting-review',
      lastTaskUpdatedOn: 'Jul 4, 2026',
      decisionExpectedDate: 'Jul 29, 2026',
      prerequisiteTasksCompleted: 3,
      prerequisiteTasksTotal: 3,
    },
  ],
  pastApplications: [
    {
      id: 'past_backstage',
      programName: 'Backstage: Plugin Accessibility Audit',
      projectName: 'CNCF',
      termName: 'Summer 2026',
      lastTaskUpdatedOn: 'Feb 12, 2026',
      decidedOn: 'Apr 20, 2026',
      outcome: 'not-selected',
    },
    {
      id: 'past_openapi',
      programName: 'OpenAPI Tools: Type-Safe Client Generation',
      projectName: 'OpenAPI Initiative',
      termName: 'Spring 2026',
      lastTaskUpdatedOn: 'Nov 8, 2025',
      decidedOn: 'Jan 19, 2026',
      outcome: 'not-selected',
    },
  ],
};

export const MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED: MentorshipMenteeOverviewAccepted = {
  phase: 'accepted',
  openTaskCount: 3,
  program: {
    id: 'app_gridflow',
    programId: 'prog_gridflow',
    projectName: 'LF Energy',
    programName: 'GridFlow: Time-Series Ingestion Pipeline',
    tasksCompleted: 7,
    tasksTotal: 12,
    mentors: [
      { id: 'mentor_1', name: 'Test Mentor A' },
      { id: 'mentor_2', name: 'Test Mentor B' },
    ],
    upNextTasks: [
      { id: 'unt_1', name: 'Implement replay from durable buffer', status: 'in-progress', dueDate: '2026-09-18T00:00:00Z' },
      { id: 'unt_2', name: 'Benchmark 1M points per minute', status: 'pending', dueDate: '2026-09-25T00:00:00Z' },
      { id: 'unt_3', name: 'Write contributor onboarding doc', status: 'pending', dueDate: '2026-10-02T00:00:00Z' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tasks tab constants and mock data
// ---------------------------------------------------------------------------

export const EMPTY_MENTORSHIP_MENTEE_TASKS_RESPONSE: MentorshipMenteeTasksResponse = {
  data: [],
  total: 0,
};

const MOCK_MENTEE_TASKS: MentorshipMenteeTask[] = [
  {
    id: 'mt_1',
    title: 'Complete onboarding checklist',
    description: 'Set up your dev environment and review the contributor guide.',
    status: 'completed',
    dueDate: '2026-09-15T00:00:00Z',
    submittedDate: '2026-09-12T00:00:00Z',
  },
  {
    id: 'mt_2',
    title: 'First contribution PR',
    description: 'Submit your first pull request to the project repository.',
    status: 'submitted',
    dueDate: '2026-09-30T00:00:00Z',
    submittedDate: '2026-09-28T00:00:00Z',
  },
  {
    id: 'mt_3',
    title: 'Write a design document',
    description: 'Document the architecture for the ingestion pipeline feature.',
    status: 'in-progress',
    dueDate: '2026-10-15T00:00:00Z',
  },
  {
    id: 'mt_4',
    title: 'Implement time-series parser',
    description: 'Build the core parser module for time-series data.',
    status: 'pending',
    dueDate: '2026-10-30T00:00:00Z',
  },
  {
    id: 'mt_5',
    title: 'Final project presentation',
    description: 'Present your completed work to the mentors and community.',
    status: 'pending',
    dueDate: '2026-11-20T00:00:00Z',
  },
];

export const MOCK_MENTORSHIP_MENTEE_TASKS: MentorshipMenteeTasksResponse = {
  data: MOCK_MENTEE_TASKS,
  total: MOCK_MENTEE_TASKS.length,
};

// ---------------------------------------------------------------------------
// Profile tab constants and mock data
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_PROFILE_DETAILS_TITLE = 'Mentee Profile';
export const MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL = 'Edit Mentee Profile';
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_LABEL = 'About Me';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_LABEL = 'Skills I Have';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_LABEL = 'Skills I Want to Learn';
export const MENTORSHIP_MENTEE_PROFILE_RESUME_LABEL = 'Resume';
export const MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY = 'No introduction added yet.';
export const MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY = 'No skills added yet.';
export const MENTORSHIP_MENTEE_PROFILE_RESUME_EMPTY = 'No resume uploaded yet.';

export const EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE: MentorshipMenteeProfileResponse = {
  profile: { aboutMe: '', skillsHave: [], skillsWant: [] },
};

export const MOCK_MENTORSHIP_MENTEE_PROFILE: MentorshipMenteeProfileResponse = {
  profile: {
    aboutMe:
      'I am in my final year of a computer engineering degree, building telemetry tooling for a campus microgrid project. I want to learn how production ingestion pipelines are designed and reviewed.',
    skillsHave: ['Python', 'Postgres', 'Linux', 'Git'],
    skillsWant: ['Kubernetes', 'Go', 'Grafana', 'Prometheus'],
    resumeFileName: 'test-mentee-resume.pdf',
    resumeUrl: '#',
  },
};

// ---------------------------------------------------------------------------
// Dev shortcuts
// ---------------------------------------------------------------------------

export const MENTORSHIP_MENTEE_DEV_DASHBOARD_LABEL = 'Go to Mentee Dashboard';
export const MENTORSHIP_MENTEE_DEV_VIEW_EMPTY_LABEL = 'View the empty state \u2192';
export const MENTORSHIP_MENTEE_DEV_VIEW_APPLICANT_LABEL = 'View the applicant state \u2192';
export const MENTORSHIP_MENTEE_DEV_VIEW_ACCEPTED_LABEL = 'View the accepted state \u2192';
