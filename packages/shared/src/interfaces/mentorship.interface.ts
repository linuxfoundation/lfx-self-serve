// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MENTORSHIP_APPLICANT_DISPLAY_STATUSES,
  MENTORSHIP_APPLICANT_TASK_STATUSES,
  MENTORSHIP_CURRENT_MENTEE_ACTIONS,
  MENTORSHIP_MENTEE_STATUSES,
  MENTORSHIP_MENTOR_STATUSES,
  MENTORSHIP_PROGRAM_REVIEW_DECISIONS,
  MENTORSHIP_UPSTREAM_PROGRAM_STATUSES,
} from '../constants/mentorship.constants';
import type { PaginatedResponse } from './api.interface';

/** Wizard step keys for `/mentorship/admin/enroll`. */
export type MentorshipEnrollStep = 'details' | 'setup' | 'prerequisites';

/** A mentorship term row on the enroll setup step. */
export interface MentorshipProgramTerm {
  id: string;
  name: string;
  /** ISO `YYYY-MM-01` built from the term dialog start month + start year. */
  startDate: string;
  /** ISO `YYYY-MM-01` built from the term dialog end month + end year. */
  endDate: string;
  /** ISO `YYYY-MM-DD` application window start. */
  applicationStartDate: string;
  /** ISO `YYYY-MM-DD` application window end. */
  applicationEndDate: string;
}

/** Payload for the enroll add/edit term dialog. */
export interface MentorshipTermFormDialogData {
  mode: 'add' | 'edit';
  term?: MentorshipProgramTerm;
}

/** Application material row on the enroll prerequisites step. */
export interface MentorshipPrerequisite {
  id: string;
  name: string;
  description: string;
  required: boolean;
  requireFile?: boolean;
  challengeUrl?: string;
  /** Admin-authored extra material, rendered as an editable card. */
  custom?: boolean;
  /** ISO `YYYY-MM-DD` due date — used by custom prerequisites. */
  dueDate?: string;
}

/**
 * State held by the enroll wizard. `logoPreviewUrl` is a browser-only `blob:` URL for the picker;
 * validation uses `MentorshipEnrollValidationInput` (the form minus the preview field).
 */
export interface MentorshipEnrollForm {
  importProgramId: string;
  name: string;
  projectId: string;
  technologies: string[];
  description: string;
  repositoryUrl: string;
  websiteUrl: string;
  ciiProjectId: string;
  codeOfConductUrl: string;
  logoFileName: string;
  logoPreviewUrl: string;
  skills: string[];
  terms: MentorshipProgramTerm[];
  prerequisites: MentorshipPrerequisite[];
  termsAccepted: boolean;
}

/**
 * Validation shape for `getMentorshipEnrollStepErrors`. Omits the browser-only
 * `logoPreviewUrl` so the validator never depends on a transient blob URL.
 */
export type MentorshipEnrollValidationInput = Omit<MentorshipEnrollForm, 'logoPreviewUrl'>;

/** Field-keyed validation errors for a single enroll wizard step. */
export interface MentorshipEnrollFieldErrors {
  name?: string;
  projectId?: string;
  technologies?: string;
  description?: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  codeOfConductUrl?: string;
  logoFileName?: string;
  ciiProjectId?: string;
  skills?: string;
  terms?: string;
  prerequisites?: string;
  challengeUrl?: string;
  termsAccepted?: string;
}

/** Linux Foundation project option for the enroll project picker. */
export interface MentorshipLfProject {
  id: string;
  name: string;
  /** Required by the upstream create body as `projectSlug`. */
  slug: string;
  logoUrl?: string;
}

/** One lazy-load page of LF projects; `page_token` is the cursor for the next page and is left out once the list is exhausted. */
export type MentorshipLfProjectsResponse = PaginatedResponse<MentorshipLfProject>;

/** LFX user option surfaced in the admin Mentors tab "invite mentor" picker. */
export interface MentorshipInvitableUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export type MentorshipInvitableUsersResponse = {
  data: MentorshipInvitableUser[];
  total: number;
};

/** Result of the program-name availability lookup. */
export interface MentorshipNameAvailability {
  available: boolean;
}

export type MentorshipNameLookupStatus = 'idle' | 'loading' | 'available' | 'taken' | 'unavailable';

/** Date-field errors from the add/edit term dialog. */
export interface MentorshipTermDateErrors {
  startDate?: string;
  endDate?: string;
  applicationStartDate?: string;
  applicationEndDate?: string;
}

/** Result of looking up a CII Best Practices badge by project ID. */
export interface MentorshipCiiBadge {
  projectId: string;
  badgeLevel: string;
}

export type MentorshipCiiLookupStatus = 'idle' | 'loading' | 'valid' | 'invalid' | 'unavailable';

/** Mentor lifecycle on the Mentors tab. No `graduated` (mentors don't graduate). */
export type MentorshipMentorStatus = (typeof MENTORSHIP_MENTOR_STATUSES)[number];

/** Mentee lifecycle on the Current Mentees / Past Mentees tabs. Adds `graduated`. */
export type MentorshipMenteeStatus = (typeof MENTORSHIP_MENTEE_STATUSES)[number];

/** Shared row fields consumed by the admin program-detail people tables. */
export interface MentorshipProgramPersonBase {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/** Mentee row on the admin Past Mentees tab and the mentor program-detail tables. */
export interface MentorshipProgramMentee extends MentorshipProgramPersonBase, MentorshipApplicationProgress {
  termName: string;
  /** Reviewer note shared with the program's admins and mentors. */
  note?: string;
  /** Assigned tasks loaded with the mentee; drives the View Tasks expansion. */
  tasks?: MentorshipApplicantTask[];
}

/**
 * Payload for the reviewer-note dialog, which serves any program-detail person row —
 * Current Mentees and Applicants both open it. Carries no id: the parent opens the
 * dialog and already holds the person it asked about, so echoing an id back would only
 * offer a second, divergent source for the same fact.
 */
export interface MentorshipNoteDialogData {
  personName: string;
  note: string;
}

export type MentorshipTaskFormMode = 'create' | 'edit';

/** Minimum mentee shape the task-form dialog needs for the multi-mentee assignee list. */
export interface MentorshipTaskDialogAssignee {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * Dialog config passed via `DialogService.open(..., { data })`.
 *
 * In `create` mode the caller passes at least one mentee in `mentees` and preselects it
 * via `preselectedMenteeIds`. The assignee list is hidden when `mentees.length === 1`
 * (single-mentee flow); it renders as a multi-select when the Mentees-tab group-create
 * flow passes more than one.
 *
 * In `edit` mode `mentees` is empty (a task's assignee is not editable here) and `task`
 * seeds the form.
 */
export interface MentorshipTaskFormDialogData {
  mode: MentorshipTaskFormMode;
  mentees: MentorshipTaskDialogAssignee[];
  preselectedMenteeIds: string[];
  task?: {
    id: string;
    name: string;
    description: string;
    dueOn?: string;
    requiresFileSubmission: boolean;
    status: MentorshipApplicantTaskStatus;
  };
}

/**
 * Value emitted by the task-form dialog on save. `taskId` is present in edit mode so
 * the caller can route the write to `PUT` vs. `POST`; `assignedMenteeIds` carries the
 * single preselected id in single-mentee mode and every checked id in multi mode.
 * `status` is only present in edit mode (upstream creates a task as `incomplete`, which reads as pending).
 */
export interface MentorshipTaskFormValue {
  taskId?: string;
  name: string;
  description: string;
  dueOn?: string;
  requiresFileSubmission: boolean;
  assignedMenteeIds: string[];
  status?: MentorshipApplicantTaskStatus;
}

/** Row action on the admin Current Mentees tab. */
export type MentorshipCurrentMenteeAction = (typeof MENTORSHIP_CURRENT_MENTEE_ACTIONS)[number];

/**
 * Status as shown on the admin Current Mentees and mentor Applicants tables. `applied` and `tasks-completed` are both the
 * `pending` wire status, split by whether every prerequisite task has been submitted.
 */
export type MentorshipApplicantDisplayStatus = (typeof MENTORSHIP_APPLICANT_DISPLAY_STATUSES)[number];

/**
 * The stored status of an application plus the prerequisite progress that splits its
 * `pending` state into Applied / Tasks Completed. Every application-shaped row derives
 * its display status from these three fields and nothing else.
 */
export interface MentorshipApplicationProgress {
  status: MentorshipMenteeStatus;
  /** Prerequisite tasks the applicant has submitted out of `tasksTotal`. */
  tasksSubmitted?: number;
  tasksTotal?: number;
}

/** An application the same person holds on another program, listed alongside this one. */
export interface MentorshipApplicantOtherApplication extends MentorshipApplicationProgress {
  /** Target of the row's link — `/mentorship/admin/:programId`. */
  programId: string;
  /** Short program name; the full name is too long for the column. */
  programName: string;
}

/** Emitted by a program-detail tab when a row asks to open its reviewer note. */
export interface MentorshipNoteRequest {
  personId: string;
  personName: string;
  /** The note the row arrived with, for a tab whose rows the page does not hold. */
  note?: string;
}

/**
 * One entry in a program-detail row's action menu, already resolved to what the menu
 * renders. `value` is the action key the menu hands back when the entry is picked.
 */
export interface MentorshipRowAction {
  value: string;
  label: string;
  icon: string;
}

/** Display fields for a row's reviewer-note line, resolved from the session's drafts. */
export interface MentorshipNoteDisplay {
  hasNote: boolean;
  /** The note itself when there is one, otherwise the "Add note" prompt. */
  noteLabel: string;
}

/** Status of one assigned task in the Applicants tab tasks sub-table. */
export type MentorshipApplicantTaskStatus = (typeof MENTORSHIP_APPLICANT_TASK_STATUSES)[number];

/** One assigned task shown when an applicant row expands on the Applicants tab. */
export interface MentorshipApplicantTask {
  id: string;
  name: string;
  description: string;
  status: MentorshipApplicantTaskStatus;
  /** When true, the row can be hidden via "Hide Prerequisite Tasks". */
  prerequisite: boolean;
  /** ISO date or date-time (`YYYY-MM-DD` or full `toISOString()`) behind the Tasks Dates column. */
  createdOn: string;
  /** ISO date or date-time. The Tasks-tab relative label needs time precision; older rows may be date-only. */
  updatedOn: string;
  /** ISO `YYYY-MM-DD` when set; omitted for prerequisite tasks with no fixed due date. */
  dueOn?: string;
  /** Whether the mentee uploaded a file the admin can view or download. */
  hasSubmission?: boolean;
  /**
   * Whether completing this task requires the mentee to upload a file. Set by the
   * task-form dialog; distinct from `hasSubmission`, which reports whether the mentee
   * has actually submitted one.
   */
  requiresFileSubmission?: boolean;
}

/** Resolved display fields for one row in the applicant tasks sub-table. */
export interface MentorshipApplicantTaskRow extends MentorshipApplicantTask {
  statusLabel: string;
  statusBadgeClass: string;
  createdLabel: string;
  dueLabel: string;
  updatedLabel: string;
  canView: boolean;
  canDownload: boolean;
}

/** Application row on the admin mentee tabs — a mentee row plus its application metadata. */
export interface MentorshipProgramApplicant extends MentorshipProgramMentee {
  /** Id of the application's term. The mentee tabs split on it, since two of a program's terms can share a name. */
  termId: string;
  /** ISO `YYYY-MM-DD` dates behind the Application Dates column. */
  createdOn: string;
  updatedOn: string;
  otherApplications?: MentorshipApplicantOtherApplication[];
}

// -- Program review (approver approve/reject email link) ---------------------

/**
 * Program status as the mentorship service stores it. Distinct from the admin-list
 * `MentorshipProgramStatus`, which is a BFF display grouping.
 */
export type MentorshipUpstreamProgramStatus = (typeof MENTORSHIP_UPSTREAM_PROGRAM_STATUSES)[number];

/** The two statuses a program review can move a `pending` program to. */
export type MentorshipProgramDecisionStatus = Extract<MentorshipUpstreamProgramStatus, 'published' | 'rejected'>;

/** The `?decision=` value on an approve/reject email link. */
export type MentorshipProgramReviewDecision = (typeof MENTORSHIP_PROGRAM_REVIEW_DECISIONS)[number];

/**
 * The upstream program fields the BFF reads: program review reads the id, name and status, and the
 * mentee apply page reads the name and project name.
 */
export interface MentorshipUpstreamProgram {
  id: string;
  name: string;
  status: MentorshipUpstreamProgramStatus;
  /** Name of the program's LF project; absent when the program has none. */
  project_name?: string;
}

/** Upstream body for `POST /mentorship/v1/programs/{id}/decision`. */
export interface MentorshipUpstreamProgramDecisionRequest {
  status: MentorshipProgramDecisionStatus;
}

/**
 * Response body from `GET /api/mentorship/program-review/:programId` and
 * `POST /api/mentorship/program-review/:programId/decision`: the subset of
 * `MentorshipUpstreamProgram` the page receives. Status values and their lifecycle are documented
 * on `MENTORSHIP_UPSTREAM_PROGRAM_STATUSES`.
 */
export type MentorshipProgramReview = Pick<MentorshipUpstreamProgram, 'id' | 'name' | 'status'>;

/** Request body for `POST /api/mentorship/program-review/:programId/decision`. */
export interface MentorshipProgramDecisionRequest {
  decision: MentorshipProgramReviewDecision;
}

/**
 * What the program-review page shows. `already-decided` covers a program that is no
 * longer `pending`, whether the page found it that way or the POST got a 409.
 */
export type MentorshipProgramReviewState =
  | 'loading'
  | 'confirm'
  | 'submitting'
  | 'success'
  | 'already-decided'
  | 'forbidden'
  | 'not-found'
  | 'invalid-link'
  | 'error';

/** The program-review page's current state and the program it is showing, when known. */
export interface MentorshipProgramReviewView {
  state: MentorshipProgramReviewState;
  program: MentorshipProgramReview | null;
}

/** The program id and decision read from a program-review link. */
export interface MentorshipProgramReviewLink {
  programId: string;
  decision: MentorshipProgramReviewDecision | null;
}

/** What the program-review confirm card renders: the loaded program and the decision to confirm. */
export interface MentorshipProgramReviewConfirmation {
  program: MentorshipProgramReview;
  decision: MentorshipProgramReviewDecision;
}

/** How a failed mentor or mentee registration submit is shown. */
export type MentorshipRegisterSubmitFailureKind = 'field-errors' | 'profile-exists' | 'read-only' | 'conflict' | 'ineligible' | 'error';

/** Result of `mapMentorshipRegisterFailure`: banner copy plus, for 'field-errors', the mapped field errors. */
export interface MentorshipRegisterSubmitFailure<TFieldErrors extends object> {
  kind: MentorshipRegisterSubmitFailureKind;
  /** Banner / toast copy. For 'field-errors' this is the first field message. */
  message: string;
  /** Present only for kind 'field-errors'; contains only keys listed in the caller's `fieldKeys`. */
  fieldErrors?: TFieldErrors;
}

/** What differs between the mentor and mentee register pages when a save fails. */
export interface MentorshipRegisterFailureOptions<TFieldErrors extends object> {
  /** The code the BFF puts on its 409 when the profile already exists. */
  profileExistsCode: string;
  profileExistsMessage: string;
  /** The form fields a server 400 can name; any other field in `errors[]` is ignored. */
  fieldKeys: readonly (keyof TFieldErrors)[];
  /** Copy for a 422. Without it a 422 gets the fallback message, since the page has no eligibility statements to point at. */
  ineligibleMessage?: string;
}

// -- Admin enroll: create a program -------------------------------------------

/**
 * One term in the create body. No `id` (upstream generates it) and dates are date-only `YYYY-MM-DD`, which upstream stores
 * at 00:00 UTC. Upstream needs `endDate` after `startDate`, and `applicationEndDate` strictly after `applicationStartDate`
 * (a same-day window is refused) and before `startDate`.
 */
export interface MentorshipEnrollCreateTerm {
  name: string;
  startDate: string;
  endDate: string;
  applicationStartDate: string;
  applicationEndDate: string;
}

/** One prerequisite in the create body. `dueDate` is a date-only `YYYY-MM-DD` or `null`. */
export interface MentorshipEnrollCreatePrerequisite {
  name: string;
  description: string;
  /** Whether the admin picked this prerequisite. Upstream saves only `true` items and drops a `false` one without an error. */
  required: boolean;
  requireFile: boolean;
  dueDate: string | null;
}

/**
 * Request body for `POST /api/mentorship/admin/programs`, sent on to upstream `POST /mentorship/v1/programs` as is. It has no
 * `status`, `logoUrl` or term `id`: upstream sets the status to `pending`, and the logo goes up in a second call.
 */
export interface MentorshipEnrollCreateRequest {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectLogoUrl?: string;
  name: string;
  description: string;
  repositoryUrl: string;
  websiteUrl?: string;
  codeOfConductUrl?: string;
  ciiProjectId?: string;
  /** The wizard's Technologies, joined with `', '`. Upstream keeps it apart from `skills`. */
  industry?: string;
  skills: string[];
  terms: MentorshipEnrollCreateTerm[];
  prerequisites: MentorshipEnrollCreatePrerequisite[];
  termsAccepted: true;
}

/** Response from `POST /api/mentorship/admin/programs`: what the wizard keeps so a failed logo upload can retry without a second create. */
export interface MentorshipEnrollProgramRef {
  id: string;
  /** Falls back to `id` when upstream returns no slug. */
  slug: string;
  status: string;
}

/** Response from `POST /api/mentorship/admin/programs/:programId/logo`. */
export interface MentorshipProgramLogoUploadResult {
  logoUrl: string;
}

/** The two calls one Submit makes, in order. There is no review step: create already leaves the program `pending`. */
export type MentorshipEnrollSubmitStep = 'create' | 'logo';

export type MentorshipEnrollSubmitPhase = 'idle' | 'creating' | 'uploading-logo' | 'failed' | 'done';

/** Shown in the wizard after a failed submit. `step` says which write failed; `message` is the banner text. */
export interface MentorshipEnrollSubmitFailure {
  step: MentorshipEnrollSubmitStep;
  message: string;
}

/** The upstream fields the BFF reads from the program a create returns. */
export interface MentorshipUpstreamCreatedProgram {
  id: string;
  slug?: string;
  status: string;
}

/** Upstream body from `POST /mentorship/v1/programs/{id}/logo-upload`. */
export interface MentorshipUpstreamLogoUpload {
  public_url: string;
  filename: string;
  content_type: string;
  size: number;
}
