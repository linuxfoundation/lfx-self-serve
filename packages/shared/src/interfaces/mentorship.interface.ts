// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MENTORSHIP_PERSON_STATUSES,
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

/** State held by the enroll wizard. The wizard posts `MentorshipEnrollRequest`, not this shape. */
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
  skills: string[];
  terms: MentorshipProgramTerm[];
  prerequisites: MentorshipPrerequisite[];
  termsAccepted: boolean;
}

/**
 * Body POSTed to `/api/mentorship/programs`. Named apart from the wizard state so UI-only fields
 * can be omitted here as they are added, rather than leaking into the request by default.
 */
export type MentorshipEnrollRequest = MentorshipEnrollForm;

/** Field-keyed validation errors for a single enroll wizard step. */
export interface MentorshipEnrollFieldErrors {
  name?: string;
  projectId?: string;
  technologies?: string;
  description?: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  codeOfConductUrl?: string;
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
  logoUrl?: string;
}

export type MentorshipLfProjectsResponse = {
  data: MentorshipLfProject[];
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

/** Person row status on mentees / applicants / mentors tabs. */
export type MentorshipPersonStatus = (typeof MENTORSHIP_PERSON_STATUSES)[number];

/** Mentee, applicant, or mentor row on the admin program-detail tabs. */
export interface MentorshipProgramPerson {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  status: MentorshipPersonStatus;
  termName: string;
  /** ISO `YYYY-MM-DD` invitation date — mentors tab. */
  invitedOn?: string;
  /** ISO `YYYY-MM-DD` application date — applicants / mentors tab. */
  appliedOn?: string;
  profileCreated?: boolean;
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
  mentees: MentorshipProgramPerson[];
  applicants: MentorshipProgramPerson[];
  mentors: MentorshipProgramPerson[];
  terms: MentorshipProgramTermRow[];
}

/** Full admin program-detail payload from `GET /api/mentorship/programs/:slug`. */
export interface MentorshipProgramDetail extends MentorshipProgramLists {
  program: MentorshipProgram;
  tabCounts: MentorshipProgramTabCounts;
}
