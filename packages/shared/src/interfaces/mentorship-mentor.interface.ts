// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MENTORSHIP_MENTOR_PROGRAM_DETAIL_TABS } from '../constants/mentorship-mentor.constants';
import type { MentorshipLfxProfileFields, MentorshipUpstreamLfxProfileFields } from './mentorship-lfx-profile-card.interface';
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

/**
 * Body of `POST /api/mentorship/mentor/profile`. Program requests and the resume are not part of
 * it: requests are sent separately, and there is no upload endpoint yet. `lfxProfile` carries the
 * name, email and avatar the profile card shows; it is omitted when the card had none to give.
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
