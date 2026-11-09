// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES,
  MENTORSHIP_ADMIN_DECISION_STATUSES,
  MENTORSHIP_ADMIN_MENTEE_TABS,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_ADMIN_MENTOR_UPDATE_STATUSES,
  MENTORSHIP_ATTENDANCE_TYPES,
  MENTORSHIP_PROGRAM_DETAIL_TABS,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_TERM_ROW_STATUSES,
} from '../constants/mentorship.constants';
import type {
  MentorshipApplicantDisplayStatus,
  MentorshipApplicantTask,
  MentorshipMenteeStatus,
  MentorshipProgramApplicant,
  MentorshipProgramPersonBase,
} from './mentorship.interface';
import type { MentorshipUpstreamProgramTerm, MentorshipUpstreamTaskStatus } from './mentorship-mentee.interface';

/**
 * Enrollment / graduation counters shown on the admin program card.
 */
export interface MentorshipProgramStats {
  mentors: number;
  mentees: number;
  graduated: number;
}

/**
 * Program status as the admin list shows it (upstream `admin_status`, `_` written as `-`). A published program reads
 * from its terms (deleted terms ignored), the first match winning:
 * - `completed` — a closed term and no open one
 * - `accepting` — an open term inside its application window (UTC calendar days, both included)
 * - `in-progress` — an open term inside its term window
 * - `upcoming` — an open term whose application window has not opened, or no terms yet
 * - `in-progress` — any other open term (applications closed but not started, ended but not closed, or undated)
 *
 * The rest come from the program's own status:
 * - `pending-review` — pending, awaiting review
 * - `rejected` — rejected
 * - `hidden` — hidden
 */
export type MentorshipProgramStatus = (typeof MENTORSHIP_PROGRAM_STATUSES)[number];

/** The term fields a published program's status is read from. */
export type MentorshipProgramTermDates = Pick<
  MentorshipUpstreamProgramTerm,
  'status' | 'start_date_time' | 'end_date_time' | 'application_start_date' | 'application_end_date'
>;

/** A program admin's visibility change on the program-detail header: `hide` a published program, `unhide` a hidden one. */
export type MentorshipProgramVisibilityAction = 'hide' | 'unhide';

/** One row of the program-detail header's `…` menu, rendered with a description under the label. */
export interface MentorshipProgramMenuItem {
  action: MentorshipProgramVisibilityAction;
  label: string;
  icon: string;
  description: string;
  danger?: boolean;
  command: () => void;
}

/** Core program fields as returned by the LFX One BFF for the mentorship admin list. */
export interface MentorshipProgram {
  id: string;
  /** URL-safe identifier. `/mentorship/admin/:programId` accepts `id` (default) or `slug`. */
  slug: string;
  /** Program name, e.g. "GridFlow: Time-Series Ingestion Pipeline". */
  name: string;
  /** Foundation / project sponsoring the program, e.g. "LF Energy". */
  projectName: string;
  status: MentorshipProgramStatus;
  stats: MentorshipProgramStats;
  /** Optional program logo. When absent, the card renders an initials avatar. */
  logoUrl?: string;
  /** True when upstream status is `pending` or `published` and the program has no logo (R12). List rows only. */
  logoMissing?: boolean;
  createdOn: string;
  updatedOn: string;
}

export type MentorshipProgramsResponse = {
  data: MentorshipProgram[];
  total: number;
};

/**
 * One page of an admin program list, as the BFF sends it upstream: the caller's programs (Me lens Admin) or a project's
 * programs (Project lens Mentorship Programs). The two lists share these filters.
 */
export interface MentorshipAdminProgramListOptions {
  search?: string;
  status?: MentorshipProgramStatus;
  /** From 0. */
  offset: number;
  /** From 1 to `MENTORSHIP_PROGRAMS_MAX_LIMIT`. */
  limit: number;
  /** A project's list only: also the programs of its sub-projects, at any depth (the Foundation lens). */
  includeSubprojects?: boolean;
}

/** The filters an admin program list page has applied: the search text, the status and, in the Project lens, the project. */
export interface MentorshipAdminProgramListFilters {
  search: string;
  status: MentorshipProgramStatus | null;
  /** The Project lens's project; `''` on the Me lens Admin. */
  projectUid: string;
}

/** Admin program-detail underline tabs. */
export type MentorshipProgramDetailTab = (typeof MENTORSHIP_PROGRAM_DETAIL_TABS)[number]['value'];

/** One admin program-detail tab: its value, label and the count its badge reads. */
export type MentorshipProgramDetailTabDefinition = (typeof MENTORSHIP_PROGRAM_DETAIL_TABS)[number];

/** Program identity and available tabs used to preserve or reset the admin page's selected tab. */
export interface MentorshipProgramDetailTabSource {
  programId: string;
  tabs: readonly MentorshipProgramDetailTab[];
}

/** Mentor lifecycle on the admin Mentors tab; upstream's `approved` mentor shows as Approved. */
export type MentorshipAdminMentorStatus = (typeof MENTORSHIP_ADMIN_MENTOR_STATUSES)[number];

/** A status an admin may set on a mentor member. */
export type MentorshipAdminMentorUpdateStatus = (typeof MENTORSHIP_ADMIN_MENTOR_UPDATE_STATUSES)[number];

/** Body of `PATCH /api/mentorship/admin/programs/:programId/mentors/:memberId`. */
export interface MentorshipAdminMentorStatusUpdate {
  status: MentorshipAdminMentorUpdateStatus;
}

/** Body of `POST /api/mentorship/admin/programs/:programId/mentors`: the LFID of the picked candidate, invited as a mentor. */
export interface MentorshipAdminMentorInviteRequest {
  lfid: string;
}

/** One action on a Mentors tab row: `key` names its copy, `status` is what it sets. */
export interface MentorshipAdminMentorAction {
  key: 'accept' | 'decline' | 'revoke' | 'remove';
  label: string;
  status: MentorshipAdminMentorUpdateStatus;
}

/** Mentor row on the Mentors tab. */
export interface MentorshipProgramMentor extends MentorshipProgramPersonBase {
  status: MentorshipAdminMentorStatus;
  /** ISO `YYYY-MM-DD` date the mentor was added or asked to join. */
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

/** Body of `POST /api/mentorship/admin/programs/:programId/terms` and `PATCH …/terms/:termId`. All dates are ISO `YYYY-MM-DD`. */
export interface MentorshipAdminTermInput {
  name: string;
  startDate: string;
  endDate: string;
  applicationStartDate: string;
  applicationEndDate: string;
}

/**
 * Body of `PATCH /mentorship/v1/tasks/{id}`. A field left out is unchanged; an empty `submit_file` or `due_date` clears it.
 * `submit_file` is `required` when the mentee must upload a file. Upstream refuses `application_status`, `program_term_status`
 * and `file` here, so none is sent.
 */
export interface MentorshipUpstreamTaskUpdate {
  name?: string;
  description?: string;
  status?: MentorshipUpstreamTaskStatus;
  submit_file?: string;
  due_date?: string;
}

/**
 * One row of upstream `GET /mentorship/v1/me/programs`: a program the caller administers, with the program-wide counts its card shows.
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
  stats: MentorshipProgramStats;
  created_on: string;
  updated_on: string;
}

/** How an accepted mentee attends; sent as `attendance_type` upstream. */
export type MentorshipAttendanceType = (typeof MENTORSHIP_ATTENDANCE_TYPES)[number];

/** A status an admin decision sets on an application. */
export type MentorshipAdminDecisionStatus = (typeof MENTORSHIP_ADMIN_DECISION_STATUSES)[number];

/**
 * Body of `PATCH /api/mentorship/admin/applications/:applicationId/status`. `attendanceType` is optional and sent only
 * with `accepted`; an accept without it undoes a graduation, and upstream keeps the stored one. `pending` re-opens a
 * declined or withdrawn application.
 */
export interface MentorshipAdminApplicationStatusUpdate {
  status: MentorshipAdminDecisionStatus;
  attendanceType?: MentorshipAttendanceType;
}

/** A Current Mentees decision, by its success toast: `ungraduated` is an undone graduation, `reopened` a re-open. */
export type MentorshipAdminDecisionOutcome = keyof typeof MENTORSHIP_ADMIN_DECISION_DONE_MESSAGES;

/**
 * Copy for one reason the mentorship service gives when it refuses a write. `match` is a fragment of the service's
 * error text ("eligibility criteria not met: <reason>"), compared ignoring case, which is not written for a reader;
 * `message` is what the toast says instead.
 */
export interface MentorshipUpstreamReasonMessage {
  match: string;
  message: string;
}

/**
 * How a decision's 422 toast reads: `lead` goes in front of the matched reason's copy, and `fallback` stands alone
 * when upstream names no reason this app knows.
 */
export interface MentorshipAdminDecisionRefusal {
  lead: string;
  fallback: string;
}

/** A reviewer note an admin saved, announced so whichever Current Mentees tab is on screen writes it into its row. */
export interface MentorshipAdminSavedNote {
  applicationId: string;
  note: string;
}

/** A saved reviewer note with the version of its save, so a page read that started before the save knows to keep it. */
export interface MentorshipAdminVersionedNote {
  note: string;
  version: number;
}

/** Response of `POST /api/mentorship/admin/programs/:programId/terms/:termId/decline-pending`. */
export interface MentorshipAdminDeclinePendingResponse {
  declinedCount: number;
}

/** Data of the Accept dialog: the mentee being accepted. The dialog closes with the chosen attendance type, or nothing when dismissed. */
export interface MentorshipAcceptDialogData {
  personName: string;
}

/** Data of the Decline by Term dialog: the open terms to pick from. The dialog closes with the chosen term, or nothing when dismissed. */
export interface MentorshipDeclineByTermDialogData {
  terms: MentorshipAdminTermOption[];
}

/** One of the two mentee tabs of an admin program page. */
export type MentorshipAdminMenteeTab = (typeof MENTORSHIP_ADMIN_MENTEE_TABS)[number];

/**
 * The status filter of a mentee tab. Current Mentees filters on the statuses its table shows, so `pending` splits
 * into `applied` and `tasks-completed`; Past Mentees filters on the wire status.
 */
export type MentorshipAdminMenteeStatusFilter = MentorshipMenteeStatus | MentorshipApplicantDisplayStatus;

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

/** Query of `GET /api/mentorship/admin/programs/:programId/mentors`. */
export interface MentorshipAdminMentorsQuery {
  status?: MentorshipAdminMentorStatus;
  search?: string;
  /** From 0. */
  offset?: number;
  /** From 1 to `MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT`. */
  limit?: number;
}

/** One page of a program's mentors, from `GET /api/mentorship/admin/programs/:programId/mentors`. */
export interface MentorshipAdminMentorsResponse {
  data: MentorshipProgramMentor[];
  total: number;
}

/**
 * Body of `POST /api/mentorship/admin/programs/:programId/mentor-candidates`. The search is in the body, not the query
 * string, because it can be a full email address and the request URL is logged on every line.
 */
export interface MentorshipAdminMentorCandidatesRequest {
  search: string;
}

/** One person the Mentors tab can invite, from `POST /api/mentorship/admin/programs/:programId/mentor-candidates`. Never carries an email. */
export interface MentorshipAdminMentorCandidate {
  lfid: string;
  /** Upstream's name, or the LFID when upstream has none. */
  name: string;
  avatarUrl?: string;
}

/** At most 10 candidates matching the search, from `POST /api/mentorship/admin/programs/:programId/mentor-candidates`. */
export interface MentorshipAdminMentorCandidatesResponse {
  data: MentorshipAdminMentorCandidate[];
}

/** One page of a program's terms, from `GET /api/mentorship/admin/programs/:programId/terms`. */
export interface MentorshipAdminTermsResponse {
  data: MentorshipProgramTermRow[];
  total: number;
}

/** Query of `GET /api/mentorship/admin/programs/:programId/terms`. */
export interface MentorshipAdminTermsQuery {
  /** From 0. */
  offset?: number;
  /** From 1 to `MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT`. */
  limit?: number;
}

/**
 * One row of upstream `GET /mentorship/v1/programs/{id}/member-management`. `status` stays a plain string: the BFF maps
 * it to `MentorshipAdminMentorStatus` and logs a value it does not know.
 */
export interface MentorshipUpstreamMemberManagementRow {
  id: string;
  user_id: string;
  name?: string;
  email?: string;
  username?: string;
  avatar_url?: string;
  status?: string;
  created_on: string;
  updated_on: string;
  profile_created: boolean;
}

/** One row of upstream `GET /mentorship/v1/programs/{id}/mentor-candidates`. `name` and `avatar_url` may be missing. */
export interface MentorshipUpstreamMentorCandidate {
  lfid: string;
  name?: string;
  avatar_url?: string;
}

/** One row of upstream `GET /mentorship/v1/programs/{id}/term-management`: a term with its mentee application counts. */
export interface MentorshipUpstreamTermManagementRow extends MentorshipUpstreamProgramTerm {
  pending: number;
  declined: number;
  accepted: number;
  graduated: number;
}

/** One row's View Tasks read in the Current Mentees tab: in flight, answered, or failed. */
export interface MentorshipAdminTasksState {
  status: 'loading' | 'loaded' | 'failed';
  tasks: MentorshipApplicantTask[];
}

/** Query of `GET /api/mentorship/admin/programs/:programId/mentees`. */
export interface MentorshipAdminMenteesQuery {
  type: MentorshipAdminMenteeTab;
  /** One display status on `current`, one wire status on `past`. */
  status?: MentorshipAdminMenteeStatusFilter;
  /** UUID of one term. */
  termId?: string;
  search?: string;
  /** From 0. */
  offset?: number;
  /** From 1 to `MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT`. */
  limit?: number;
}

/**
 * What the BFF builds for `GET /api/mentorship/admin/programs/:programId/mentees/export`: the CSV text, its data row
 * count, and whether the read stopped at the page cap with more mentees left out.
 */
export interface MentorshipAdminMenteesExport {
  csv: string;
  count: number;
  truncated: boolean;
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
