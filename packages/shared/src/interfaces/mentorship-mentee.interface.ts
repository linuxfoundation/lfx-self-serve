// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Become a Mentee form types
// ---------------------------------------------------------------------------

/**
 * Become a Mentee form state. Name, email, and avatar are not here — they come from the
 * signed-in LFX account, matching the mentor form's `MentorshipMentorRegisterForm`.
 * `resumeFileName` is metadata only: there is no upload endpoint yet, so the picked bytes
 * are never sent. The five demographic fields are each optional and independently
 * consent-gated — a mentee can decline any of them without blocking submission.
 */
export interface MentorshipMenteeRegisterForm {
  introduction: string;
  skillsHave: string[];
  skillsWant: string[];
  additionalNotes: string;
  resumeFileName: string;
  ageConsent: boolean;
  age: string;
  raceEthnicityConsent: boolean;
  raceEthnicity: string;
  genderConsent: boolean;
  gender: string;
  incomeConsent: boolean;
  income: string;
  educationConsent: boolean;
  education: string;
  ageEligible: boolean;
  workAuthorized: boolean;
  noDuplicateProfile: boolean;
  complianceAccepted: boolean;
  termsAccepted: boolean;
}

/**
 * Field-keyed validation errors for the Become a Mentee form. Both skills fields are
 * required — mentors get matched against the skills the mentee has AND the skills the
 * mentee wants to improve, so a blank on either side breaks that match. The demographic
 * fields have no entries: each is optional unless its consent checkbox is checked, and
 * that pairing is enforced by the demographics section itself rather than surfaced as a
 * submit-blocking error, matching how the resume picker validates at selection time
 * instead of at submit.
 */
export interface MentorshipMenteeRegisterFieldErrors {
  introduction?: string;
  skillsHave?: string;
  skillsWant?: string;
  ageEligible?: string;
  workAuthorized?: string;
  noDuplicateProfile?: string;
  complianceAccepted?: string;
  termsAccepted?: string;
}

/** One selectable option in a mentee demographic question. */
export interface MentorshipDemographicOption {
  text: string;
  value: string;
}

/** One demographic question rendered by the demographics section, driven off `MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS`. */
export interface MentorshipMenteeDemographicRow {
  /** Form control holding the checked consent, e.g. `ageConsent`. */
  consentControl: keyof MentorshipMenteeRegisterForm;
  /** Form control holding the selected answer, e.g. `age`. */
  answerControl: keyof MentorshipMenteeRegisterForm;
  question: string;
  options: MentorshipDemographicOption[];
}

// ---------------------------------------------------------------------------
// Mentee page types
// ---------------------------------------------------------------------------

/** Underline tabs on the mentee shell at `/mentorship/mentee/*`. */
export type MentorshipMenteePageTab = 'overview' | 'tasks' | 'profile';

/**
 * Unified mentee task status — used by both applicant and accepted phases.
 *
 * | Backend value  | Display label |
 * |----------------|---------------|
 * | `pending`      | To Do         |
 * | `incomplete`   | To Do         |
 * | `in_progress`  | In Progress   |
 * | `submitted`    | Submitted     |
 * | `complete`     | Submitted     |
 *
 * NOTE: These are the raw values the mentee mock data uses and intentionally
 * differ from `MentorshipApplicantTaskStatus` (the kebab-case admin/mentor
 * vocabulary: `pending` / `in-progress` / `submitted` / `completed`). They stay
 * separate until the real BFF contract lands; the two vocabularies get reconciled
 * at that mapping boundary. Do not merge them before the contract exists.
 */
export type MentorshipMenteeTaskStatus = 'pending' | 'incomplete' | 'in_progress' | 'submitted' | 'complete';

/**
 * One task row on the mentee My Tasks tab (accepted/graduated phase).
 *
 * BFF mapping from `tasks`:
 * - `submitFile` ← `tasks.submit_file` (`null` = no submission, `'required'` = needs upload, URL = file already uploaded)
 * - `fileUrl` ← `tasks.file` (uploaded file URL, null until the mentee uploads)
 */
export interface MentorshipMenteeTask {
  id: string;
  title: string;
  description: string;
  status: MentorshipMenteeTaskStatus;
  /** `null` = no submission needed, `'required'` = needs upload, URL string = file already uploaded */
  submitFile: string | null;
  /** Uploaded file URL — present when `submitFile` is a URL or after a successful upload */
  fileUrl?: string;
  /** ISO 8601 UTC date string (`YYYY-MM-DDT00:00:00Z`). The BFF **must** normalise date-only values. */
  dueDate?: string;
  /** ISO 8601 UTC date string (`YYYY-MM-DDT00:00:00Z`), rendered via `DatePipe` with `'UTC'` like `dueDate`. Present when status is `'submitted'` or `'complete'`. */
  submittedDate?: string;
}

/** Response body from `GET /api/mentorship/mentee/tasks`. */
export interface MentorshipMenteeTasksResponse {
  data: MentorshipMenteeTask[];
  total: number;
}

// ---------------------------------------------------------------------------
// Mentee application tasks — prerequisite tasks grouped by application
// ---------------------------------------------------------------------------

/**
 * One prerequisite task row inside an application card on the My Application Tasks tab.
 *
 * BFF mapping from `tasks` (where `category = prerequisite`):
 * - `submitFile` ← `tasks.submit_file` (`null` | `'required'` | URL)
 * - `fileUrl` ← `tasks.file`
 * - `dueDate` ← `tasks.due_date` normalised to UTC instant
 * - `submittedOn` ← `tasks.updated_on` normalised to UTC instant when status is `'submitted'`
 */
export interface MentorshipMenteeApplicationTask {
  id: string;
  /**
   * Display text. Named `name` (not `title`) to mirror the applicant `tasks` backend shape;
   * `buildMentorshipMenteeApplicationViews` maps it onto the shared `title` view field.
   */
  name: string;
  description: string;
  status: MentorshipMenteeTaskStatus;
  /** `null` = no submission needed, `'required'` = needs upload, URL string = file already uploaded */
  submitFile: string | null;
  /** Uploaded file URL — present when `submitFile` is a URL or after a successful upload */
  fileUrl?: string;
  /** ISO 8601 UTC date string (`YYYY-MM-DDT00:00:00Z`). */
  dueDate: string;
  /**
   * ISO 8601 UTC date string (`YYYY-MM-DDT00:00:00Z`), rendered via `DatePipe` with `'UTC'` like `dueDate`.
   * Present when status is `'submitted'`. NOTE: this is a raw instant — unlike
   * `MentorshipMenteeApplicationHistoryEntry.submittedOn`, which is a BFF pre-formatted display string.
   */
  submittedOn?: string;
}

/**
 * Display-ready task row for the mentee tasks UI (applicant + accepted phases).
 *
 * Built by `buildMentorshipMenteeTaskView` and consumed by the shared
 * `MenteeTaskRowComponent`, so the template reads flat fields instead of
 * recomputing presentation logic in bindings.
 */
export interface MentorshipMenteeTaskView {
  id: string;
  title: string;
  description: string;
  status: MentorshipMenteeTaskStatus;
  /** `true` when the task is in a submitted/complete state. */
  submitted: boolean;
  inProgress: boolean;
  /** Tailwind badge classes for the status pill. */
  statusClass: string;
  /** A submission file already exists (renders View/Download). */
  hasUploadedFile: boolean;
  /** An upload is required but no file exists yet (renders Upload). */
  needsUpload: boolean;
  fileUrl: string | null;
  /** ISO 8601 UTC date string, or `null`. Rendered via `DatePipe` with `'UTC'`. */
  dueDate: string | null;
  /**
   * ISO 8601 UTC date string, or `null`. Named for its value (like `dueDate`/`submittedDate`),
   * not "label" — the template formats it via `DatePipe` with `'UTC'` (same contract as `dueDate`).
   */
  submittedDate: string | null;
}

/** Display-ready application card for the applicant phase of the mentee tasks tab. */
export interface MentorshipMenteeApplicationView {
  id: string;
  programName: string;
  projectName: string;
  termName: string;
  statusLabel: string;
  statusBadgeClass: string;
  submittedCount: number;
  totalCount: number;
  tasks: MentorshipMenteeTaskView[];
}

/**
 * Mentee's own profile fields on `/mentorship/mentee/profile`.
 *
 * BFF mapping from `user_profiles` (`profile_type = mentee`) — do not invent columns:
 * - `aboutMe` ← `introduction`
 * - `skillsHave` ← `skill_set.skills`
 * - `skillsWant` ← `skill_set.improvementSkills`
 * - `additionalNotes` ← `skill_set.comments`
 * - `resumeUrl` ← `profile_links.resumeLink` (Mentorship stores a URL; it has no upload API)
 * - `resumeFileName` is display-only (derived from the URL). Not a stored column.
 */
export interface MentorshipMenteeProfileDetails {
  aboutMe: string;
  skillsHave: string[];
  skillsWant: string[];
  additionalNotes?: string;
  resumeFileName?: string;
  resumeUrl?: string;
}

/** Status on an Application History row: the stored `applications.status` value. */
export type MentorshipMenteeApplicationHistoryStatus = MentorshipUpstreamApplicationStatus;

/**
 * One Application History row: an `applications` row with `role = mentee`, joined to
 * `program_terms` + `programs`. Mentees are not `program_members`.
 *
 * - `id` ← `applications.id`
 * - `programName` ← `programs.name` (`project_uid` is not a column — do not send a project)
 * - `termName` ← `program_terms.name`
 * - `submittedOn` ← BFF-formatted `applications.created_on`
 * - `status` ← `applications.status`
 */
export interface MentorshipMenteeApplicationHistoryEntry {
  id: string;
  programName: string;
  termName: string;
  /**
   * BFF pre-formatted display string (e.g. `'Jun 28, 2026'`). Rendered verbatim — no `DatePipe` needed.
   * NOTE: differs from `MentorshipMenteeApplicationTask.submittedOn`, which is a raw ISO UTC instant
   * formatted client-side. Application History is display-only, so the BFF formats it.
   */
  submittedOn: string;
  status: MentorshipMenteeApplicationHistoryStatus;
}

/**
 * Voluntary demographic answers stored with the mentee profile. Tokens match
 * `MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS` option values. A missing field, a blank
 * string, or `preferNotToSay` means the mentee did not provide that answer.
 */
export interface MentorshipMenteeDemographics {
  age?: string;
  raceEthnicity?: string;
  gender?: string;
  income?: string;
  education?: string;
}

/** Response body from `GET /api/mentorship/mentee/profile`. */
export interface MentorshipMenteeProfileResponse {
  profile: MentorshipMenteeProfileDetails;
  history: MentorshipMenteeApplicationHistoryEntry[];
  /** Absent until the mentee has saved demographics. The apply page treats that as all "Not provided". */
  demographics?: MentorshipMenteeDemographics;
}

/** Both ids required to open `/mentorship/mentee/apply` and to return there after registration. */
export interface MentorshipMenteeApplyIds {
  programId: string;
  programTermId: string;
}

/** Header fields for the mentee apply page, from `GET /api/mentorship/mentee/apply-target`. */
export interface MentorshipMenteeApplyTarget {
  programName: string;
  projectName: string;
  termName: string;
}

// ---------------------------------------------------------------------------
// Mentee overview — three-phase model
// ---------------------------------------------------------------------------

/** The mentee overview progresses through three phases. */
export type MentorshipMenteePhase = 'empty' | 'applicant' | 'accepted';

/**
 * Display status on applicant-phase cards.
 *
 * When the real BFF lands, these will be derived (not stored):
 * - `'in-progress'` — application pending, tasks not yet submitted
 * - `'awaiting-review'` — application pending, all tasks submitted
 */
export type MentorshipMenteeApplicationStatus = 'in-progress' | 'awaiting-review';

/** Lightweight term reference for application cards. */
export interface MentorshipMenteeTermRef {
  id: string;
  /** Display name for the term (e.g. "Fall 2026"). */
  name: string;
}

/** One application card on the applicant overview (screen 2). */
export interface MentorshipMenteeApplication {
  id: string;
  programId: string;
  /** Two-letter abbreviation derived from project data. */
  orgAbbreviation: string;
  projectName: string;
  term: MentorshipMenteeTermRef;
  programName: string;
  status: MentorshipMenteeApplicationStatus;
  /** BFF pre-formatted display string (e.g. `'Jun 28, 2026'`). Rendered verbatim — no `DatePipe` needed. */
  lastTaskUpdatedOn: string;
  /** BFF pre-formatted display string (e.g. `'Aug 15, 2026'`). Rendered verbatim — no `DatePipe` needed. */
  decisionExpectedDate: string;
  prerequisiteTasksCompleted: number;
  prerequisiteTasksTotal: number;
  programLogoUrl?: string;
  /** Prerequisite tasks for this application (populated on the My Application Tasks tab). */
  tasks?: MentorshipMenteeApplicationTask[];
}

/**
 * Outcome for a past application row.
 * - `'not-selected'` is a display-friendly alias for `applications.status = 'declined'`.
 */
export type MentorshipMenteePastOutcome = 'not-selected' | 'withdrawn' | 'accepted' | 'graduated';

/** One row in the Past Applications table (screen 2). */
export interface MentorshipMenteePastApplication {
  id: string;
  programName: string;
  projectName: string;
  termName: string;
  /** BFF pre-formatted display string (e.g. `'Jun 28, 2026'`). Rendered verbatim — no `DatePipe` needed. */
  createdOn: string;
  outcome: MentorshipMenteePastOutcome;
}

/** Mentor info shown on the accepted-phase card (screen 3). */
export interface MentorshipMenteeActiveMentor {
  /** Stable user/member identifier for tracking. */
  id: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Task status on the accepted "Up Next" list.
 * BFF may return `'pending'` or `'incomplete'` — both display as "To Do".
 * `'in-progress'` maps to `tasks.status = 'in_progress'`.
 */
export type MentorshipMenteeUpNextTaskStatus = 'in-progress' | 'pending' | 'incomplete';

/** One upcoming task row on the accepted-phase card (screen 3). */
export interface MentorshipMenteeUpNextTask {
  id: string;
  name: string;
  status: MentorshipMenteeUpNextTaskStatus;
  /** ISO 8601 UTC date string (`YYYY-MM-DDT00:00:00Z`). The BFF **must** normalise the backend's date-only value to an explicit UTC instant before returning it — `DatePipe` with `'UTC'` relies on this to render the correct calendar day in every timezone. Mock data already follows this contract. */
  dueDate: string;
  /** `tasks.category` */
  category?: 'prerequisite' | 'non_prerequisite';
}

/** The single accepted program on the accepted-phase overview (screen 3). */
export interface MentorshipMenteeActiveProgram {
  id: string;
  programId: string;
  projectName: string;
  programName: string;
  tasksCompleted: number;
  tasksTotal: number;
  /** All active mentors for this program. */
  mentors: MentorshipMenteeActiveMentor[];
  upNextTasks: MentorshipMenteeUpNextTask[];
}

// -- Discriminated union response -------------------------------------------

export interface MentorshipMenteeOverviewEmpty {
  phase: 'empty';
}

export interface MentorshipMenteeOverviewApplicant {
  phase: 'applicant';
  applications: MentorshipMenteeApplication[];
  pastApplications: MentorshipMenteePastApplication[];
  openTaskCount: number;
}

export interface MentorshipMenteeOverviewAccepted {
  phase: 'accepted';
  program: MentorshipMenteeActiveProgram;
  openTaskCount: number;
}

/** Response body from `GET /api/mentorship/mentee/overview`. */
export type MentorshipMenteeOverviewResponse = MentorshipMenteeOverviewEmpty | MentorshipMenteeOverviewApplicant | MentorshipMenteeOverviewAccepted;

/** Response body from `GET /api/mentorship/mentee/has-profile`. */
export interface MentorshipMenteeHasProfileResponse {
  hasProfile: boolean;
}

// ---------------------------------------------------------------------------
// Upstream mentorship service shapes (`/mentorship/v1/...`) the mentee BFF reads
// ---------------------------------------------------------------------------

/** List envelope the mentorship service wraps collection responses in. */
export interface MentorshipUpstreamListResponse<T> {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * `applications.status` as the mentorship service stores it. Never send `rejected` (program-only)
 * or `active` (directory filter only — persisted value is `accepted`).
 */
export type MentorshipUpstreamApplicationStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'graduated' | 'hold';

/** `program_terms.status` as the mentorship service stores it. */
export type MentorshipUpstreamProgramTermStatus = 'open' | 'closed' | 'deleted';

/** `tasks.status` as the mentorship service stores it. */
export type MentorshipUpstreamTaskStatus = 'incomplete' | 'in_progress' | 'submitted' | 'complete';

/** Which side of the program an application or profile belongs to. */
export type MentorshipUpstreamRole = 'mentor' | 'mentee';

/** Program summary embedded on an application row. */
export interface MentorshipUpstreamApplicationProgram {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
}

/** Term summary embedded on an application row. Dates are ISO 8601 strings. */
export interface MentorshipUpstreamApplicationTerm {
  id: string;
  name: string;
  status: MentorshipUpstreamProgramTermStatus;
  start_date?: string;
  end_date?: string;
  application_start_date?: string;
  application_end_date?: string;
}

/** One row from `GET /mentorship/v1/me/applications`. */
export interface MentorshipUpstreamApplication {
  id: string;
  program_term_id: string;
  user_id: string;
  role: MentorshipUpstreamRole;
  status: MentorshipUpstreamApplicationStatus;
  program_term_status?: MentorshipUpstreamProgramTermStatus;
  start_date_time?: string;
  end_date_time?: string;
  attendance_type?: 'full_time' | 'part_time';
  tasks_submitted: boolean;
  admin_notified: boolean;
  created_on: string;
  updated_on: string;
  program?: MentorshipUpstreamApplicationProgram;
  term?: MentorshipUpstreamApplicationTerm;
}

/** Body of `GET /mentorship/v1/programs/{programID}/terms/{termID}`. */
export interface MentorshipUpstreamProgramTerm {
  id: string;
  program_id: string;
  name: string;
  status: MentorshipUpstreamProgramTermStatus;
  active_users: number;
  start_date_time?: string;
  end_date_time?: string;
  application_start_date?: string;
  application_end_date?: string;
  created_on: string;
  updated_on: string;
}

/** One task row from the mentorship service. `due_date` is an ISO date string. */
export interface MentorshipUpstreamTask {
  id: string;
  application_id?: string;
  program_term_id?: string;
  assignee_id: string;
  owner_id?: string;
  name?: string;
  description?: string;
  category?: 'prerequisite' | 'non_prerequisite';
  status: MentorshipUpstreamTaskStatus;
  application_status?: MentorshipUpstreamApplicationStatus;
  program_term_status?: MentorshipUpstreamProgramTermStatus;
  custom: boolean;
  submit_file?: string;
  file?: string;
  due_date?: string;
  created_by?: string;
  created_on: string;
  updated_on: string;
}

/**
 * Body of `GET /mentorship/v1/me/profiles/{profileType}`. The JSON columns (`address`,
 * `demographics`, `socioeconomics`, `skill_set`, `profile_links`) are free-form on the
 * service side, so they stay `unknown` until a BFF mapper narrows them.
 */
export interface MentorshipUpstreamUserProfile {
  id: string;
  user_id: string;
  profile_type: MentorshipUpstreamRole;
  slug?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  logo_url?: string;
  introduction?: string;
  terms_and_conditions: boolean;
  number_of_projects: number;
  address?: unknown;
  demographics?: unknown;
  socioeconomics?: unknown;
  skill_set?: unknown;
  profile_links?: unknown;
  created_on: string;
  updated_on: string;
}
