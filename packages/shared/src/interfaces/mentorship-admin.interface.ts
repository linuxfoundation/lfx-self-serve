// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_PROGRAM_DETAIL_TABS, MENTORSHIP_PROGRAM_STATUSES, MENTORSHIP_TERM_ROW_STATUSES } from '../constants/mentorship.constants';
import type { MentorshipMentorStatus, MentorshipProgramApplicant, MentorshipProgramPersonBase } from './mentorship.interface';
import type { MentorshipUpstreamProgramTerm } from './mentorship-mentee.interface';

/**
 * Enrollment / graduation counters shown on the admin program card.
 */
export interface MentorshipProgramStats {
  mentors: number;
  mentees: number;
  graduated: number;
}

/**
 * Program status as the admin list shows it (upstream `admin_status`, `_` written as `-`):
 * - `open` — published, with an open term or no terms yet
 * - `pending-review` — draft or submitted, awaiting approval
 * - `completed` — published, with only closed terms
 * - `rejected` — rejected
 * - `hidden` — archived or hidden
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

/** Admin program-detail underline tabs. */
export type MentorshipProgramDetailTab = (typeof MENTORSHIP_PROGRAM_DETAIL_TABS)[number]['value'];

/** Count badges shown next to each program-detail tab label. */
export interface MentorshipProgramTabCounts {
  currentMentees: number;
  pastMentees: number;
  mentors: number;
  terms: number;
}

/** Mentor row on the Mentors tab. */
export interface MentorshipProgramMentor extends MentorshipProgramPersonBase {
  status: MentorshipMentorStatus;
  /** ISO `YYYY-MM-DD` invitation date. */
  invitedOn?: string;
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

/**
 * One row of upstream `GET /mentorship/v1/me/programs`: a program the caller administers, with the term and counts its card shows.
 * `admin_status` stays a plain string: the BFF maps it to `MentorshipProgramStatus` and logs a value it does not know.
 */
export interface MentorshipUpstreamAdministeredProgram {
  id: string;
  slug?: string;
  name: string;
  /** The program's own status. The card shows `admin_status`, which also reads the program's terms. */
  status: string;
  admin_status: string;
  project_uid?: string;
  /** Name of the program's LF project; absent when the program has none. */
  project_name?: string;
  logo_url?: string;
  /** The latest open term, else the latest closed one; absent when the program has no terms. */
  term?: Pick<MentorshipUpstreamProgramTerm, 'id' | 'name' | 'status'>;
  stats: MentorshipProgramStats;
  created_on: string;
  updated_on: string;
}

/** A program's raw lists, before its applications are split across the two mentee tabs. */
export interface MentorshipProgramLists {
  /** Every application on the program, whatever its status or term. */
  applications: MentorshipProgramApplicant[];
  mentors: MentorshipProgramMentor[];
  terms: MentorshipProgramTermRow[];
}

/** Full admin program-detail payload from `GET /api/mentorship/admin/programs/:programId`. */
export interface MentorshipProgramDetail {
  program: MentorshipProgram;
  tabCounts: MentorshipProgramTabCounts;
  /** Applications in an open term (or a term the program does not list), any status. */
  currentMentees: MentorshipProgramApplicant[];
  /** Applications in a closed term, any status. */
  pastMentees: MentorshipProgramApplicant[];
  mentors: MentorshipProgramMentor[];
  terms: MentorshipProgramTermRow[];
}
