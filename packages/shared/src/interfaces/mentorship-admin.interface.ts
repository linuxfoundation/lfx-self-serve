// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_PROGRAM_DETAIL_TABS, MENTORSHIP_PROGRAM_STATUSES, MENTORSHIP_TERM_ROW_STATUSES } from '../constants/mentorship.constants';
import type { MentorshipMentorStatus, MentorshipProgramApplicant, MentorshipProgramPersonBase } from './mentorship.interface';

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
