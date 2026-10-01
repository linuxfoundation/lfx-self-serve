// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS } from '../constants/mentorship-mentor.constants';
import type { MentorshipLfxProfileFields, MentorshipUpstreamLfxProfileFields } from './mentorship-lfx-profile-card.interface';
import type { MentorshipUpstreamProgramTermStatus } from './mentorship-mentee.interface';
import type {
  MentorshipApplicantTaskStatus,
  MentorshipMentorStatus,
  MentorshipProgramApplicant,
  MentorshipProgramMentee,
  MentorshipRegisterSubmitFailure,
} from './mentorship.interface';

// ---------------------------------------------------------------------------
// Become a Mentor form types
// ---------------------------------------------------------------------------

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
export interface MentorshipMentorRegisterFieldErrors extends MentorshipMentorProfileFieldErrors {
  complianceAccepted?: string;
  termsAccepted?: string;
}

/**
 * Body of `POST /api/mentorship/mentor/profile`. Program requests and the resume are not part of
 * it: requests are sent separately, and there is no upload endpoint yet. `lfxProfile` carries the
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

/** Statuses of an upstream `program_members` row, in the order the request lifecycle reaches them. */
export type MentorshipUpstreamProgramMemberStatus = 'invited' | 'requested' | 'pending' | 'active' | 'declined' | 'withdrawn';

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

// ---------------------------------------------------------------------------
// My Programs and program detail types
// ---------------------------------------------------------------------------

/** Counters shown on the mentor My Programs card. */
export interface MentorshipMentorProgramStats {
  mentees: number;
  tasksToReview: number;
  applicants: number;
}

/** Term lifecycle badge on the mentor My Programs card. */
export type MentorshipMentorProgramTermStatus = 'active-term' | 'upcoming' | 'completed';

/** Program row on the mentor My Programs list. */
export interface MentorshipMentorProgram {
  id: string;
  slug: string;
  name: string;
  projectName: string;
  term: string;
  termStatus: MentorshipMentorProgramTermStatus;
  stats: MentorshipMentorProgramStats;
  logoUrl?: string;
  /** ISO `YYYY-MM-DD` term bounds, shown on the mentor program-detail page subtitle. */
  termStartDate?: string;
  termEndDate?: string;
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
  id: string;
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

/** Tab lists returned with a mentor program-detail payload. No Mentors/Terms tabs on this side. */
export interface MentorshipMentorProgramLists {
  mentees: MentorshipProgramMentee[];
  applicants: MentorshipProgramApplicant[];
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

/** Mentor's own profile detail fields on `/mentorship/mentor/profile`. */
export interface MentorshipMentorProfileDetails {
  /** Rich-text HTML or plain text authored on the Become a Mentor form. */
  aboutMe: string;
  skills: string[];
  /** Optional resume file name, matching the picker on the register form. */
  resumeFileName?: string;
  /** Optional signed URL for the stored resume, if the upload endpoint is live. */
  resumeUrl?: string;
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
 * least one must be. `introduction` is the rich-text HTML the editor produces. The resume is not part
 * of it: there is no upload endpoint yet.
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
