// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MENTORSHIP_ADMIN_MENTEE_TABS,
  MENTORSHIP_PROGRAM_DETAIL_TABS,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_TERM_ROW_STATUSES,
} from '../constants/mentorship.constants';
import type {
  MentorshipApplicantTask,
  MentorshipMenteeStatus,
  MentorshipMentorStatus,
  MentorshipProgramApplicant,
  MentorshipProgramPersonBase,
} from './mentorship.interface';
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

/** One of the two mentee tabs of an admin program page. */
export type MentorshipAdminMenteeTab = (typeof MENTORSHIP_ADMIN_MENTEE_TABS)[number];

/** Count badges on the live admin program page. A count is `null` when its upstream read failed; the tab shows a dash. */
export interface MentorshipAdminProgramTabCounts {
  currentMentees: number | null;
  pastMentees: number | null;
  mentors: number | null;
  terms: number | null;
}

/** A term the Current Mentees term filter offers. */
export interface MentorshipAdminTermOption {
  id: string;
  name: string;
  status: MentorshipTermRowStatus;
}

/** Payload of `GET /api/mentorship/admin/programs/:programId`: the header, the four tab counts and the term options. */
export interface MentorshipAdminProgramPage {
  program: MentorshipProgram;
  tabCounts: MentorshipAdminProgramTabCounts;
  /** Open and closed terms of the program; empty when the terms read failed. */
  terms: MentorshipAdminTermOption[];
}

/** One page of a program's mentees, from `GET /api/mentorship/admin/programs/:programId/mentees`. */
export interface MentorshipAdminMenteesResponse {
  data: MentorshipProgramApplicant[];
  total: number;
}

/** One row's View Tasks read in the Current Mentees tab: in flight, answered, or failed. */
export interface MentorshipAdminTasksState {
  status: 'loading' | 'loaded' | 'failed';
  tasks: MentorshipApplicantTask[];
}

/** Query of `GET /api/mentorship/admin/programs/:programId/mentees`. */
export interface MentorshipAdminMenteesQuery {
  type: MentorshipAdminMenteeTab;
  /** One wire status. */
  status?: MentorshipMenteeStatus;
  /** UUID of one term. */
  termId?: string;
  search?: string;
  /** From 0. */
  offset?: number;
  /** From 1 to `MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT`. */
  limit?: number;
}

/**
 * Body of `GET /mentorship/v1/programs/{id}/header`. `program.status` is the program's own status, which the
 * page shows once it is grouped with the program's terms (`mapMentorshipAdminHeaderProgram`).
 */
export interface MentorshipUpstreamProgramHeader {
  program: {
    id: string;
    slug?: string;
    name: string;
    status: string;
    project_name?: string;
    logo_url?: string;
    created_on: string;
    updated_on: string;
  };
  /** The latest open term; absent when the program has none. */
  active_term?: Pick<MentorshipUpstreamProgramTerm, 'id' | 'name' | 'status'>;
  stats: MentorshipProgramStats;
}

/** Body of `GET /mentorship/v1/programs/{id}/management-summary`. */
export interface MentorshipUpstreamProgramManagementSummary {
  has_open_term: boolean;
  has_closed_term: boolean;
  /** Accepted and graduated applications in open terms. */
  mentees: number;
  /** Every application in closed terms. */
  past_mentees: number;
  applicants: number;
  /** Active mentors. */
  mentors: number;
  /** Terms that are not deleted. */
  terms: number;
}

/** Mock-backed lists for the tabs not yet on the mentorship service, built client-side by `buildMentorshipProgramDetail`. */
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
