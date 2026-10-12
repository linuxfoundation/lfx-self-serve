// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS, MENTORSHIP_MENTOR_PROGRAM_STATUSES } from '../constants/mentorship-mentor.constants';
import type { MentorshipLfxProfileFields, MentorshipUpstreamLfxProfileFields } from './mentorship-lfx-profile-card.interface';
import type {
  MentorshipUpstreamApplicationStatus,
  MentorshipUpstreamApplicationTerm,
  MentorshipUpstreamProgramTermStatus,
} from './mentorship-mentee.interface';
import type {
  MentorshipApplicantTaskStatus,
  MentorshipMenteeStatus,
  MentorshipMentorStatus,
  MentorshipProgramApplicant,
  MentorshipProgramMentee,
  MentorshipRegisterSubmitFailure,
} from './mentorship.interface';

// ---------------------------------------------------------------------------
// Become a Mentor form types
// ---------------------------------------------------------------------------

/**
 * One program a mentor has asked to join, as listed on the Become a Mentor form, with the
 * request's `MentorshipMentorStatus` as the mentor sees it. The admin Mentors tab shows the
 * same membership with the wider `MentorshipAdminMentorStatus`.
 */
export interface MentorshipMentorProgramRequest {
  id: string;
  programId: string;
  programName: string;
  status: MentorshipMentorStatus;
}

/** Response body from `GET /api/mentorship/mentor/requests`. */
export interface MentorshipMentorProgramRequestsResponse {
  data: MentorshipMentorProgramRequest[];
  /**
   * Programs the mentor has an open invitation to. They are not requests, so `data` leaves them out,
   * but upstream refuses a request for them, so the picker leaves them out too.
   */
  invitedProgramIds: string[];
}

/** The profile drawer's view of the mentor's requests: a failed read is its own state, never an empty list. */
export interface MentorshipMentorRequestsState {
  requests: MentorshipMentorProgramRequest[];
  invitedProgramIds: string[];
  loading: boolean;
  failed: boolean;
}

/** Body of `POST /api/mentorship/mentor/requests`. A request is for the whole program, not a term. */
export interface MentorshipMentorProgramRequestCreate {
  programId: string;
}

/**
 * A program the mentor picker offers: any published program. Only what the picker shows, so the
 * admin `MentorshipProgram` is not needed to fill it.
 */
export interface MentorshipMentorOpenProgram {
  id: string;
  name: string;
}

/** Query for `GET /api/mentorship/mentor/open-programs`: one page of published programs, optionally narrowed by name. */
export interface MentorshipMentorOpenProgramsQuery {
  /** Matched anywhere in the program name, ignoring case. */
  search?: string;
  /** Rows to skip; the page size is fixed by the BFF. */
  offset?: number;
}

/** Response body from `GET /api/mentorship/mentor/open-programs`: one page, and how many programs match in all. */
export interface MentorshipMentorOpenProgramsResponse {
  data: MentorshipMentorOpenProgram[];
  total: number;
}

/**
 * One option in the mentor program picker. A program the mentor already asked to join, or is invited
 * to, stays listed but disabled, with a note saying why, so the mentor can see it rather than wonder
 * where it went.
 */
export interface MentorshipMentorProgramOption {
  label: string;
  value: string;
  disabled: boolean;
  note: string | null;
}

/** What the picker has loaded so far for the current search. */
export interface MentorshipMentorOpenProgramsState {
  programs: MentorshipMentorOpenProgram[];
  total: number;
  /** True while the first page of a search is in flight. */
  loading: boolean;
  /** True while a further page is in flight. */
  loadingMore: boolean;
  /** True when the last page read failed, so the list is not mistaken for "no programs". */
  failed: boolean;
}

/**
 * Become a Mentor form state. Name, email, and avatar are not here — they come from the
 * signed-in LFX account.
 */
export interface MentorshipMentorRegisterForm {
  introduction: string;
  skills: string[];
  complianceAccepted: boolean;
  termsAccepted: boolean;
}

/**
 * Field-keyed validation errors for the Become a Mentor form. Program requests have no
 * entry: applying to a program is optional, so a mentor can register a profile and pick
 * programs later.
 */
export interface MentorshipMentorRegisterFieldErrors extends MentorshipMentorProfileFieldErrors {
  complianceAccepted?: string;
  termsAccepted?: string;
}

/**
 * Body of `POST /api/mentorship/mentor/profile`. Program requests are not part of it: they are
 * sent separately. `lfxProfile` carries the
 * name and avatar the profile card shows; it is omitted when the card had none to give. The BFF
 * adds the primary email itself.
 */
export interface MentorshipMentorRegisterRequest {
  introduction: string;
  skills: string[];
  complianceAccepted: boolean;
  termsAccepted: boolean;
  lfxProfile?: MentorshipLfxProfileFields;
}

/** A failed Become a Mentor submit, as `mapMentorshipRegisterFailure` classifies it. */
export type MentorshipMentorRegisterSubmitFailure = MentorshipRegisterSubmitFailure<MentorshipMentorRegisterFieldErrors>;

/** Response body from `GET /api/mentorship/mentor/has-profile`. */
export interface MentorshipMentorHasProfileResponse {
  hasProfile: boolean;
}

/**
 * Body of `PUT /mentorship/v1/me/profiles/mentor`. `user_id` and `profile_type` are set upstream
 * from the token and path, and the name, email and logo come from the LFX profile. A PUT to an
 * existing profile replaces every column, which is why the BFF checks for one first. Upstream has no
 * compliance column, so that confirmation stops at the BFF.
 */
export interface MentorshipUpstreamMentorProfileInput extends MentorshipUpstreamLfxProfileFields {
  introduction: string;
  terms_and_conditions: boolean;
  skill_set: { skills: string[] };
}

/**
 * Statuses of an upstream `program_members` row, in the order the request lifecycle reaches them.
 * Upstream renamed `active` to `approved`; `active` stays until every environment has migrated.
 */
export type MentorshipUpstreamProgramMemberStatus = 'invited' | 'requested' | 'pending' | 'approved' | 'active' | 'declined' | 'withdrawn';

/**
 * One row of upstream `GET /mentorship/v1/me/program-memberships`: the caller's own membership of a
 * program, with its name. Upstream omits the email on this read.
 */
export interface MentorshipUpstreamProgramMembership {
  id: string;
  program_id: string;
  program_name: string;
  member_type: 'program_admin' | 'mentor';
  /** Absent on a row upstream never gave a status. */
  status?: MentorshipUpstreamProgramMemberStatus;
  created_on: string;
  updated_on: string;
}

/** Body of `POST /mentorship/v1/me/program-memberships`. Upstream takes the user from the token. */
export interface MentorshipUpstreamProgramMembershipRequest {
  program_id: string;
}

/**
 * Body of `PUT /api/mentorship/mentor/applications/:applicationId/note`: the application's reviewer note,
 * shared by every mentor of the program. A note that is blank once trimmed clears it.
 */
export interface MentorshipMentorApplicationNoteUpdate {
  note: string;
}

/** Body of `PUT /mentorship/v1/applications/{id}/note`. An empty string clears the note. */
export interface MentorshipUpstreamApplicationNoteUpdate {
  reviewer_note: string;
}

/**
 * Body of `POST /mentorship/v1/applications/{id}/tasks`. `assignee_id` must be the accepted mentee's user id, and
 * `program_term_id` is what lists the task under its term. Upstream sets `status` to `incomplete`.
 */
export interface MentorshipUpstreamTaskCreate {
  assignee_id: string;
  program_term_id: string;
  owner_id: string;
  created_by: string;
  name: string;
  description: string;
  category: 'prerequisite' | 'non_prerequisite';
  custom: boolean;
  submit_file?: string;
  due_date?: string;
}

/** A mentor's decision on a submitted task: `complete` approves it, `incomplete` sends it back for changes. */
export type MentorshipMentorTaskReviewDecision = 'complete' | 'incomplete';

/** Body of `PATCH /api/mentorship/mentor/tasks/:taskId/review`. Upstream has no field for a comment. */
export interface MentorshipMentorTaskReviewUpdate {
  status: MentorshipMentorTaskReviewDecision;
}

/** Body of `PATCH /mentorship/v1/tasks/{id}/review`. */
export interface MentorshipUpstreamTaskReviewUpdate {
  status: MentorshipMentorTaskReviewDecision;
}

/** What the mentor Tasks tab emits when a mentor approves a task or requests changes on it. */
export interface MentorshipMentorTaskReviewRequest {
  taskId: string;
  status: MentorshipMentorTaskReviewDecision;
}

/** What an invited mentor does with the invitation on `/mentorship/mentor/invites`. */
export type MentorshipMentorInviteDecision = 'accept' | 'decline';

/** Body of `POST /api/mentorship/mentor/invites/accept|decline`: the signed token from the invite email. */
export interface MentorshipMentorInviteResponseRequest {
  token: string;
}

/** What the invite page shows: the choice, the outcome, or why the link cannot be used. */
export type MentorshipMentorInviteState = 'confirm' | 'submitting' | 'accepted' | 'declined' | 'invalid-link' | 'forbidden' | 'read-only' | 'error';

// ---------------------------------------------------------------------------
// My Programs and program detail types
// ---------------------------------------------------------------------------

/** Counters shown on the mentor My Programs card. */
export interface MentorshipMentorProgramStats {
  mentees: number;
  tasksToReview: number;
  applicants: number;
}

/** A mentor's program status: `completed` once every term is closed, otherwise `open`. */
export type MentorshipMentorProgramStatus = (typeof MENTORSHIP_MENTOR_PROGRAM_STATUSES)[number];

/** Program row on the mentor My Programs list and the program-detail header. The counts cover all the program's terms. */
export interface MentorshipMentorProgram {
  id: string;
  slug: string;
  name: string;
  projectName: string;
  status: MentorshipMentorProgramStatus;
  stats: MentorshipMentorProgramStats;
  logoUrl?: string;
}

export type MentorshipMentorProgramsResponse = {
  data: MentorshipMentorProgram[];
  total: number;
};

export type MentorshipMentorProgramDetailTab = (typeof MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS)[number]['value'];

/**
 * One mentee task on the mentor program-detail Tasks tab. Flattened from current
 * mentees' assigned `tasks` where status is `submitted` (awaiting review) or
 * `completed` (approved). Pending / in-progress work is not listed here.
 */
export type MentorshipMentorTaskReviewStatus = Extract<MentorshipApplicantTaskStatus, 'submitted' | 'completed'>;

export interface MentorshipMentorReviewTask {
  /** Row key, unique across mentees. */
  id: string;
  /** Upstream task UUID, which the review write takes. */
  taskId: string;
  menteeId: string;
  menteeName: string;
  menteeEmail: string;
  avatarUrl?: string;
  taskName: string;
  description: string;
  status: MentorshipMentorTaskReviewStatus;
  termName: string;
  updatedOn: string;
  hasSubmission: boolean;
}

/**
 * Count badges shown next to each mentor program-detail tab label. `tasks` is the
 * number of current-mentee tasks with status `submitted` (Awaiting Review).
 */
export interface MentorshipMentorProgramTabCounts {
  tasks: number;
  mentees: number;
  applicants: number;
}

/**
 * An application the same person holds on another program, as a mentor sees it. The Applicants tab links the
 * program name to that program's public page on the mentorship site, which anyone may open; `programId` is
 * left out when upstream's id is not a UUID, and the name then shows as plain text.
 */
export interface MentorshipMentorOtherApplication {
  programId?: string;
  programName: string;
  status: MentorshipMenteeStatus;
}

/** One Applicants tab row. Its `id` is the application id. */
export interface MentorshipMentorProgramApplicant extends Omit<MentorshipProgramApplicant, 'otherApplications' | 'termId'> {
  otherApplications?: MentorshipMentorOtherApplication[];
}

/** Tab lists returned with a mentor program-detail payload. No Mentors/Terms tabs on this side. Each row's `id` is its application id. */
export interface MentorshipMentorProgramLists {
  mentees: MentorshipProgramMentee[];
  applicants: MentorshipMentorProgramApplicant[];
}

/** Full mentor program-detail payload from `GET /api/mentorship/mentor/programs/:programId`. */
export interface MentorshipMentorProgramDetail extends MentorshipMentorProgramLists {
  program: MentorshipMentorProgram;
  tabCounts: MentorshipMentorProgramTabCounts;
}

/** Underline tabs on `/mentorship/mentor/programs`. */
export type MentorshipMentorPageTab = 'programs' | 'profile';

// ---------------------------------------------------------------------------
// Mentor profile types
// ---------------------------------------------------------------------------

/** Mentoring history entry lifecycle on `/mentorship/mentor/profile`. */
export type MentorshipMentoringHistoryStatus = 'in-progress' | 'completed';

/** One row on the Mentoring History section of the mentor profile page. */
export interface MentorshipMentoringHistoryEntry {
  id: string;
  /** Program name, e.g. "GridFlow: Ingestion Pipeline". */
  programName: string;
  /** Term the mentor supported, e.g. "Fall 2026". */
  term: string;
  /** Number of mentees the mentor supported during the term. */
  menteesCount: number;
  status: MentorshipMentoringHistoryStatus;
}

/** One (program name, term name) pair of the Mentoring History while the BFF builds it. */
export interface MentorshipMentoringHistoryGroup {
  programName: string;
  term: string;
  menteeIds: Set<string>;
  hasCurrentMentee: boolean;
}

/** Mentor's own profile detail fields on `/mentorship/mentor/profile`. */
export interface MentorshipMentorProfileDetails {
  /** Rich-text HTML or plain text authored on the Become a Mentor form. */
  aboutMe: string;
  skills: string[];
}

/** Full response body from `GET /api/mentorship/mentor/profile`. */
export interface MentorshipMentorProfileResponse {
  profile: MentorshipMentorProfileDetails;
  history: MentorshipMentoringHistoryEntry[];
}

/**
 * Validation errors for the two profile fields a mentor writes, shared by the register form and the
 * profile edit, so both are held to one rule set.
 */
export interface MentorshipMentorProfileFieldErrors {
  introduction?: string;
  skills?: string;
}

/**
 * Body of `PATCH /api/mentorship/mentor/profile`. Only the fields the mentor changed are sent, and at
 * least one must be. `introduction` is the rich-text HTML the editor produces.
 */
export interface MentorshipMentorProfileUpdateRequest {
  introduction?: string;
  skills?: string[];
}

/** Response body from `PATCH /api/mentorship/mentor/profile`: the saved profile, without the history. */
export interface MentorshipMentorProfileUpdateResponse {
  profile: MentorshipMentorProfileDetails;
}

/**
 * The `skill_set` column as the mentor profile edit writes it. The index signature carries stored keys
 * the BFF does not model, which the edit keeps because upstream replaces the column whole.
 */
export interface MentorshipUpstreamMentorSkillSet {
  skills: string[];
  [key: string]: unknown;
}

/** Body of `PATCH /mentorship/v1/me/profiles/mentor`. Upstream keeps every column the body leaves out. */
export interface MentorshipUpstreamMentorProfileUpdate {
  introduction?: string;
  skill_set?: MentorshipUpstreamMentorSkillSet;
}

/** Body of `GET /mentorship/v1/me`: the signed-in user's local record. `id` is the user id other reads take. */
export interface MentorshipUpstreamUser {
  id: string;
  email?: string;
  lfid?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  avatar_url?: string;
  created_on: string;
  updated_on: string;
}

/** One non-deleted term of a program on `GET /mentorship/v1/mentors/{id}`. Dates are RFC 3339 instants. */
export interface MentorshipUpstreamMentorProgramTerm {
  id: string;
  name: string;
  status: MentorshipUpstreamProgramTermStatus;
  start_date_time?: string;
  end_date_time?: string;
  application_start_date?: string;
  application_end_date?: string;
}

/** One published program the mentor is an active member of, on `GET /mentorship/v1/mentors/{id}`. */
export interface MentorshipUpstreamMentorProgram {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  skills: string[];
  terms: MentorshipUpstreamMentorProgramTerm[];
  /** The program's public mentor cards. Not read by the BFF. */
  mentors: unknown[];
}

/** Status of a mentee row on `GET /mentorship/v1/mentors/{id}`. */
export type MentorshipUpstreamMentorMenteeStatus = 'active' | 'accepted' | 'graduated';

/**
 * One mentee of a program the mentor belongs to. The row names its program and term but carries
 * neither id, so it is matched to a term by name.
 */
export interface MentorshipUpstreamMentorMentee {
  user_id: string;
  name?: string;
  avatar_url?: string;
  introduction?: string;
  program_name: string;
  term_name: string;
  status: MentorshipUpstreamMentorMenteeStatus;
}

/** Counts on `GET /mentorship/v1/mentors/{id}`. */
export interface MentorshipUpstreamMentorStats {
  programs_mentoring: number;
  current_mentees: number;
  mentees_graduated: number;
}

/**
 * Body of `GET /mentorship/v1/mentors/{id}`, the public mentor profile. Upstream answers 404 for a user
 * with no active membership of a published program.
 */
export interface MentorshipUpstreamMentorDetail {
  user_id: string;
  name?: string;
  avatar_url?: string;
  introduction?: string;
  skills: string[];
  joined_at: string;
  github_url?: string;
  linkedin_url?: string;
  programs: MentorshipUpstreamMentorProgram[];
  current_mentees: MentorshipUpstreamMentorMentee[];
  graduated_mentees: MentorshipUpstreamMentorMentee[];
  stats: MentorshipUpstreamMentorStats;
}

/** Another program a mentee row's applicant has applied to, on `GET /mentorship/v1/programs/{id}/applications`. */
export interface MentorshipUpstreamProgramApplicationOther {
  program_id: string;
  program_name: string;
  status: MentorshipUpstreamApplicationStatus;
}

/**
 * One mentee application of a program, on `GET /mentorship/v1/programs/{id}/applications`, which a program's
 * mentors and administrators may read. `tasks_submitted` counts the applicant's submitted and complete tasks.
 */
export interface MentorshipUpstreamProgramApplicationRow {
  user_id: string;
  application_id: string;
  status: MentorshipUpstreamApplicationStatus;
  name?: string;
  email?: string;
  avatar_url?: string;
  note?: string;
  tasks_submitted: number;
  tasks_total: number;
  other_applications?: MentorshipUpstreamProgramApplicationOther[];
  term?: MentorshipUpstreamApplicationTerm;
  created_on: string;
  updated_on: string;
}

/**
 * One row of upstream `GET /mentorship/v1/me/mentor-programs`: a published program the caller is an active mentor
 * of. `stats` counts all the program's terms. `status` stays a plain string: the BFF maps it and logs a value it
 * does not know.
 */
export interface MentorshipUpstreamMentoredProgram {
  id: string;
  slug?: string;
  name: string;
  project_name?: string;
  logo_url?: string;
  status: string;
  stats: {
    mentees: number;
    applicants: number;
    tasks_to_review: number;
  };
}
