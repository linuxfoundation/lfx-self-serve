// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS } from '../constants/mentorship-mentee.constants';

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
 * NOTE: These are the stored `tasks.status` values plus `pending`, the status
 * dropdown's To Do option. They intentionally differ from
 * `MentorshipApplicantTaskStatus` (the kebab-case admin/mentor vocabulary:
 * `pending` / `in-progress` / `submitted` / `completed`), which still reads mocks.
 */
export type MentorshipMenteeTaskStatus = 'pending' | 'incomplete' | 'in_progress' | 'submitted' | 'complete';

// ---------------------------------------------------------------------------
// Mentee application tasks — tasks grouped by application
// ---------------------------------------------------------------------------

/** `tasks.category`. A task with no category counts as non-prerequisite. */
export type MentorshipMenteeTaskCategory = 'prerequisite' | 'non_prerequisite';

/**
 * One task on a mentee application.
 *
 * BFF mapping from `GET /mentorship/v1/applications/{id}/tasks`:
 * - `submitFile` ← `tasks.submit_file` (`null` | `'required'` | URL)
 * - `fileUrl` ← `tasks.file`
 * - `dueDate` ← `tasks.due_date`, else the term's application close for a prerequisite task, as its UTC midnight instant
 * - `submittedOn` ← `tasks.updated_on` when status is `submitted` or `complete`
 * - `updatedOn` ← `tasks.updated_on`
 */
export interface MentorshipMenteeApplicationTask {
  id: string;
  /**
   * Display text. Named `name` (not `title`) to mirror the `tasks` backend shape;
   * `buildMentorshipMenteeApplicationView` maps it onto the shared `title` view field.
   */
  name: string;
  description: string;
  category: MentorshipMenteeTaskCategory;
  status: MentorshipMenteeTaskStatus;
  /** `null` = no submission needed, `'required'` = needs upload, URL string = file already uploaded */
  submitFile: string | null;
  /** Uploaded file URL — present when `submitFile` is a URL or after a successful upload */
  fileUrl?: string;
  /**
   * ISO 8601 UTC instant, rendered via `DatePipe` with `'UTC'`. The BFF turns the upstream date-only
   * value into its UTC midnight instant, since `DatePipe` reads a bare date as local midnight.
   */
  dueDate?: string;
  /**
   * ISO 8601 instant, rendered via `DatePipe` with `'UTC'` like `dueDate`. Present when the task
   * is submitted. NOTE: this is a raw instant — unlike
   * `MentorshipMenteeApplicationHistoryEntry.submittedOn`, which is a BFF pre-formatted display string.
   */
  submittedOn?: string;
  /** ISO 8601 instant of the task's last change. */
  updatedOn: string;
}

/**
 * Display-ready task row for the mentee tasks UI.
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

/**
 * Display-ready application card, shared by the Overview and My Tasks tabs. `tasks` holds the
 * tasks the card tracks: the prerequisite tasks for a pending application, the
 * non-prerequisite tasks for an accepted one. The counts and `progressPercent` cover those tasks.
 */
export interface MentorshipMenteeApplicationView {
  id: string;
  programName: string;
  /** Absent when the program has no LF project; the card then shows only the term. */
  projectName?: string;
  termName: string;
  /** The program's logo for the card's avatar; the program's initial shows when it is absent. */
  programLogoUrl?: string;
  status: MentorshipMenteeApplicationStatus;
  /**
   * True for an accepted or graduated application: the card tracks its non-prerequisite tasks,
   * sits in the My Tasks accepted section and offers no Withdraw.
   */
  accepted: boolean;
  statusLabel: string;
  statusBadgeClass: string;
  progressLabel: string;
  submittedCount: number;
  totalCount: number;
  /** 0–100, rounded. */
  progressPercent: number;
  /** ISO 8601 instant: the latest change to the application or any of its tasks. */
  lastUpdatedOn: string;
  /**
   * ISO 8601 date the term's application window closes, or `null` for an accepted or graduated
   * application (already decided) or when the term has none.
   */
  decisionExpectedDate: string | null;
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
 * - `programId` ← `programs.id`, used to link the row to the program's public page
 * - `programName` ← `programs.name` (`project_uid` is not a column — do not send a project)
 * - `termName` ← `program_terms.name`
 * - `submittedOn` ← BFF-formatted `applications.created_on`
 * - `status` ← `applications.status`
 */
export interface MentorshipMenteeApplicationHistoryEntry {
  id: string;
  programId: string;
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

/** Skills group of a profile update. Sent whole: upstream replaces the whole `skill_set` column. */
export interface MentorshipMenteeSkillSetUpdate {
  skillsHave: string[];
  skillsWant: string[];
  /** Blank or omitted means no notes (the upstream key is left out, which clears them). */
  additionalNotes?: string;
}

/** Age, gender and race answers. Sent whole when any row changed; an omitted row has no stored answer. */
export interface MentorshipMenteeDemographicsGroupUpdate {
  age?: string;
  gender?: string;
  raceEthnicity?: string;
}

/** Income and education answers. Sent whole when any row changed; an omitted row has no stored answer. */
export interface MentorshipMenteeSocioeconomicsGroupUpdate {
  income?: string;
  education?: string;
}

/** Body of `PATCH /api/mentorship/mentee/profile`. Only changed groups are present; at least one is required. */
export interface MentorshipMenteeProfileUpdateRequest {
  /** PLAIN TEXT. The BFF converts it to HTML. `''` clears the introduction. Omitted means unchanged. */
  introduction?: string;
  skillSet?: MentorshipMenteeSkillSetUpdate;
  demographics?: MentorshipMenteeDemographicsGroupUpdate;
  socioeconomics?: MentorshipMenteeSocioeconomicsGroupUpdate;
}

/** 200 body of `PATCH /api/mentorship/mentee/profile`: the saved profile, re-mapped. History is not returned. */
export interface MentorshipMenteeProfileUpdateResponse {
  profile: MentorshipMenteeProfileDetails;
  demographics?: MentorshipMenteeDemographics;
}

/** Values the profile edit drawer hands the diff builder (`form.getRawValue()` is assignable). */
export interface MentorshipMenteeProfileFormValue {
  introduction: string;
  skillsHave: string[];
  skillsWant: string[];
  additionalNotes: string;
}

/** `form.getRawValue()` of the demographics drawer: `${key}Consent` booleans and `${key}` answers per `MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS`. */
export type MentorshipMenteeDemographicsFormValue = Record<string, string | boolean>;

/** A demographics column the profile update writes: a key of `MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS`. */
export type MentorshipMenteeDemographicGroupName = keyof typeof MENTORSHIP_MENTEE_DEMOGRAPHIC_GROUPS;

/** Both ids required to open `/mentorship/mentee/apply` and to return there after registration. */
export interface MentorshipMenteeApplyIds {
  programId: string;
  programTermId: string;
}

/** Header fields for the mentee apply page, from `GET /api/mentorship/mentee/apply-target`. */
export interface MentorshipMenteeApplyTarget {
  programName: string;
  /** Empty when upstream has no LF project on the program. */
  projectName: string;
  termName: string;
  /**
   * Whether the term takes applications today, by the same rule upstream applies on submit: the
   * term is `open` and today is inside its application window. A missing window date leaves that
   * side open.
   */
  acceptingApplications: boolean;
}

/**
 * Why the apply page shows a state in place of the form: the term was not found or cannot be
 * viewed, it is not taking applications, or the mentee already has an application for it.
 */
export type MentorshipMenteeApplyBlockedReason = 'not-found' | 'closed' | 'already-applied';

/** Copy for one of the apply page's blocked states. */
export interface MentorshipMenteeApplyBlockedState {
  icon: string;
  title: string;
  subtitle: string;
}

// ---------------------------------------------------------------------------
// Mentee overview — derived from the mentee's applications
// ---------------------------------------------------------------------------

/** `'empty'` when the mentee has no applications, `'applicant'` otherwise. */
export type MentorshipMenteePhase = 'empty' | 'applicant';

/**
 * Display status on an application card, derived from the stored status and the tasks:
 * - `'active'` — application accepted
 * - `'graduated'` — application graduated; otherwise shown like an accepted one
 * - `'awaiting-review'` — application pending, every prerequisite task submitted (or none assigned)
 * - `'in-progress'` — application pending, a prerequisite task still open or its tasks not read
 */
export type MentorshipMenteeApplicationStatus = 'active' | 'graduated' | 'awaiting-review' | 'in-progress';

/** Lightweight term reference for application cards. */
export interface MentorshipMenteeTermRef {
  id: string;
  /** Display name for the term (e.g. "Fall 2026"). */
  name: string;
}

/**
 * One of the mentee's own applications, from `GET /api/mentorship/mentee/applications`. Dates
 * are raw ISO 8601 strings; the frontend derives the display status and formats the dates.
 *
 * BFF mapping from `GET /mentorship/v1/me/applications?role=mentee`:
 * - `programName` / `programLogoUrl` ← the embedded `program`
 * - `projectName` ← the embedded `program.project_name`; absent when the program has no LF project
 * - `term` ← the embedded `term`
 * - `decisionExpectedDate` ← `term.application_end_date` as its UTC midnight instant
 * - `tasks` ← `GET /mentorship/v1/applications/{id}/tasks`, read only with `withTasks=true` and
 *   only for pending, accepted and graduated applications; absent otherwise, never an empty stand-in
 */
export interface MentorshipMenteeApplication {
  id: string;
  programId: string;
  programName: string;
  programLogoUrl?: string;
  projectName?: string;
  term: MentorshipMenteeTermRef;
  upstreamStatus: MentorshipUpstreamApplicationStatus;
  createdOn: string;
  updatedOn: string;
  decisionExpectedDate?: string;
  tasks?: MentorshipMenteeApplicationTask[];
}

/** Response body from `GET /api/mentorship/mentee/applications`. */
export interface MentorshipMenteeApplicationsResponse {
  data: MentorshipMenteeApplication[];
  total: number;
}

/**
 * Outcome for a past application row.
 * - `'not-selected'` is a display-friendly alias for `applications.status = 'declined'`.
 * - `'on-hold'` is `applications.status = 'hold'`.
 */
export type MentorshipMenteePastOutcome = 'not-selected' | 'withdrawn' | 'on-hold';

/** One row in the Past Applications table. */
export interface MentorshipMenteePastApplication {
  id: string;
  programName: string;
  projectName?: string;
  termName: string;
  /** ISO 8601 instant the application was submitted, rendered via `DatePipe`. */
  createdOn: string;
  outcome: MentorshipMenteePastOutcome;
  outcomeLabel: string;
  /** Tailwind classes for the outcome badge. */
  outcomeBadgeClass: string;
}

/** The mentee overview, derived from the applications by `buildMentorshipMenteeOverview`. */
export interface MentorshipMenteeOverview {
  phase: MentorshipMenteePhase;
  /** Applications still awaiting a decision. */
  pendingCount: number;
  /** Tasks not yet submitted across every card. */
  openTaskCount: number;
  /** Pending, accepted and graduated applications, ordered active → graduated → awaiting review → in progress. */
  cards: MentorshipMenteeApplicationView[];
  /** Every other application, newest first. */
  past: MentorshipMenteePastApplication[];
}

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
  /** Display name of the program's LF project; absent when the program has none. */
  project_name?: string;
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

/** One task row from the mentorship service. `due_date` is a date-only `YYYY-MM-DD` string. */
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

/**
 * The `skill_set` column as the mentee profile update writes it. The index signature carries stored keys
 * the BFF does not model, which the update keeps because upstream replaces the column whole.
 */
export interface MentorshipUpstreamMenteeSkillSet {
  skills: string[];
  improvementSkills: string[];
  comments?: string;
  [key: string]: unknown;
}

/** The `demographics` column as the mentee profile update writes it, with any stored keys the BFF does not model. */
export interface MentorshipUpstreamMenteeDemographics {
  age?: string;
  gender?: string;
  race?: string;
  [key: string]: unknown;
}

/** The `socioeconomics` column as the mentee profile update writes it, with any stored keys the BFF does not model. */
export interface MentorshipUpstreamMenteeSocioeconomics {
  income?: string;
  educationLevel?: string;
  [key: string]: unknown;
}

/**
 * Body of `PATCH /mentorship/v1/me/profiles/mentee`. Every key is optional and an omitted key keeps
 * the stored value; a present JSON column replaces the stored one whole. Never `{}` or `null`.
 */
export interface MentorshipUpstreamMenteeProfileUpdate {
  /** HTML built by the BFF. `''` clears. */
  introduction?: string;
  skill_set?: MentorshipUpstreamMenteeSkillSet;
  demographics?: MentorshipUpstreamMenteeDemographics;
  socioeconomics?: MentorshipUpstreamMenteeSocioeconomics;
}
