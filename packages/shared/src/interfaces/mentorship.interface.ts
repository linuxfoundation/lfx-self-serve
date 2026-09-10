// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MENTORSHIP_APPLICANT_ACTIONS,
  MENTORSHIP_APPLICANT_DISPLAY_STATUSES,
  MENTORSHIP_MENTEE_ACTIONS,
  MENTORSHIP_MENTEE_STATUSES,
  MENTORSHIP_MENTOR_STATUSES,
  MENTORSHIP_PROGRAM_DETAIL_TABS,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_TERM_ROW_STATUSES,
} from '../constants/mentorship.constants';

/**
 * Enrollment / graduation counters shown on the admin program card.
 */
export interface MentorshipProgramStats {
  mentors: number;
  mentees: number;
  graduated: number;
}

/**
 * Program status lifecycle:
 * - `open` — accepting applications / active
 * - `pending-review` — submitted, awaiting admin approval
 * - `completed` — cohort finished
 */
export type MentorshipProgramStatus = (typeof MENTORSHIP_PROGRAM_STATUSES)[number];

/** Core program fields as returned by the LFX One BFF for the mentorship admin list. */
export interface MentorshipProgram {
  id: string;
  /** URL-safe identifier. `/mentorship/admin/:programId` accepts `id` (default) or `slug`. */
  slug: string;
  /** Program name, e.g. "GridFlow: Time-Series Ingestion Pipeline". */
  name: string;
  /** Foundation / project sponsoring the program, e.g. "LF Energy". */
  projectName: string;
  term: string;
  status: MentorshipProgramStatus;
  stats: MentorshipProgramStats;
  /** Optional program logo. When absent, the card renders an initials avatar. */
  logoUrl?: string;
  createdOn: string;
  updatedOn: string;
}

export type MentorshipProgramsResponse = {
  data: MentorshipProgram[];
  total: number;
};

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
 * State held by the enroll wizard. `logoPreviewUrl` is a browser-only `blob:` URL for the picker,
 * so the wizard posts `MentorshipEnrollRequest` rather than this shape.
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
 * Body POSTed to `/api/mentorship/programs`. Carries `logoFileName` as metadata only — there is no
 * logo upload endpoint, so the bytes the picker holds are never sent.
 */
export type MentorshipEnrollRequest = Omit<MentorshipEnrollForm, 'logoPreviewUrl'>;

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

/**
 * One program a mentor has asked to join, as listed on the Become a Mentor form. Carries
 * the same `MentorshipMentorStatus` the admin Mentors tab shows for that person, since it
 * is the same fact viewed from the mentor's side.
 */
export interface MentorshipMentorProgramRequest {
  id: string;
  programId: string;
  programName: string;
  status: MentorshipMentorStatus;
}

/**
 * Become a Mentor form state. Name, email, and avatar are not here — they come from the
 * signed-in LFX account. `resumeFileName` is metadata only, like the enroll wizard's
 * `logoFileName`: there is no upload endpoint yet, so the picked bytes are never sent.
 */
export interface MentorshipMentorRegisterForm {
  introduction: string;
  skills: string[];
  resumeFileName: string;
  complianceAccepted: boolean;
  termsAccepted: boolean;
}

/**
 * Field-keyed validation errors for the Become a Mentor form. Program requests have no
 * entry: applying to a program is optional, so a mentor can register a profile and pick
 * programs later.
 */
export interface MentorshipMentorRegisterFieldErrors {
  introduction?: string;
  skills?: string;
  complianceAccepted?: string;
  termsAccepted?: string;
}

/** Linux Foundation project option for the enroll project picker. */
export interface MentorshipLfProject {
  id: string;
  name: string;
  logoUrl?: string;
}

export type MentorshipLfProjectsResponse = {
  data: MentorshipLfProject[];
  total: number;
};

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

/** Result of the mock unique-name check. */
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

/** Admin program-detail underline tabs. */
export type MentorshipProgramDetailTab = (typeof MENTORSHIP_PROGRAM_DETAIL_TABS)[number]['value'];

/** Count badges shown next to each program-detail tab label. */
export interface MentorshipProgramTabCounts {
  mentees: number;
  applicants: number;
  mentors: number;
  terms: number;
}

/** Mentor lifecycle on the Mentors tab. No `graduated` (mentors don't graduate). */
export type MentorshipMentorStatus = (typeof MENTORSHIP_MENTOR_STATUSES)[number];

/** Mentee lifecycle on the Current Mentees / Applicants tabs. Adds `graduated`. */
export type MentorshipMenteeStatus = (typeof MENTORSHIP_MENTEE_STATUSES)[number];

/** Shared row fields consumed by the admin program-detail people tables. */
interface MentorshipProgramPersonBase {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/** Mentor row on the Mentors tab. */
export interface MentorshipProgramMentor extends MentorshipProgramPersonBase {
  status: MentorshipMentorStatus;
  /** ISO `YYYY-MM-DD` invitation date. */
  invitedOn?: string;
  profileCreated?: boolean;
}

/** Mentee row on the Current Mentees / Past Mentees / Applicants tabs. */
export interface MentorshipProgramMentee extends MentorshipProgramPersonBase, MentorshipApplicationProgress {
  termName: string;
  /** Reviewer note shared with the program's admins and mentors. */
  note?: string;
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

/** Row action on the Current Mentees tab. Each maps to a terminal mentee status. */
export type MentorshipMenteeAction = (typeof MENTORSHIP_MENTEE_ACTIONS)[number];

/**
 * Status as shown on the Applicants tab. `applied` and `tasks-completed` are both the
 * `pending` wire status, split by whether every prerequisite task has been submitted.
 */
export type MentorshipApplicantDisplayStatus = (typeof MENTORSHIP_APPLICANT_DISPLAY_STATUSES)[number];

/** Row action on the Applicants tab. Each maps to the same-named application status. */
export type MentorshipApplicantAction = (typeof MENTORSHIP_APPLICANT_ACTIONS)[number];

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
}

/**
 * One entry in a program-detail row's action menu, already resolved to what the menu
 * renders. The tabs' action unions differ, so they map their own labels and icons and
 * hand over this shape rather than the status the action came from.
 */
export interface MentorshipRowAction {
  label: string;
  icon: string;
}

/** Display fields for a row's reviewer-note line, resolved from the session's drafts. */
export interface MentorshipNoteDisplay {
  hasNote: boolean;
  /** The note itself when there is one, otherwise the "Add note" prompt. */
  noteLabel: string;
}

/** Applicant row on the Applicants tab — a mentee row plus its application metadata. */
export interface MentorshipProgramApplicant extends MentorshipProgramMentee {
  /** ISO `YYYY-MM-DD` dates behind the Application Dates column. */
  createdOn: string;
  updatedOn: string;
  otherApplications?: MentorshipApplicantOtherApplication[];
}

/** Term lifecycle on the admin program-detail Terms tab. */
export type MentorshipTermRowStatus = (typeof MENTORSHIP_TERM_ROW_STATUSES)[number];

/** Term row on the admin program-detail Terms tab. */
export interface MentorshipProgramTermRow {
  id: string;
  name: string;
  status: MentorshipTermRowStatus;
  pending: number;
  declined: number;
  accepted: number;
  graduated: number;
  startDate: string;
  endDate: string;
  applicationStartDate: string;
  applicationEndDate: string;
}

/** Tab lists returned with a program-detail payload. */
export interface MentorshipProgramLists {
  mentees: MentorshipProgramMentee[];
  applicants: MentorshipProgramApplicant[];
  mentors: MentorshipProgramMentor[];
  terms: MentorshipProgramTermRow[];
}

/** Full admin program-detail payload from `GET /api/mentorship/programs/:slug`. */
export interface MentorshipProgramDetail extends MentorshipProgramLists {
  program: MentorshipProgram;
  tabCounts: MentorshipProgramTabCounts;
}
