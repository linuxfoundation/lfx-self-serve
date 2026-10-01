// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipMentorProgramTermStatus,
  MentorshipMentorStatus,
  MentorshipUpstreamApplicationStatus,
  MentorshipUpstreamProgramMemberStatus,
} from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// Mentorship service — Server-Only Constants
// ---------------------------------------------------------------------------

/** Upstream path that creates (or refreshes) the signed-in user's local mentorship record with a PUT, and reads it with a GET. */
export const MENTORSHIP_BOOTSTRAP_PATH = '/mentorship/v1/me';

/**
 * The `error` the mentorship service returns with a 401 when the signed-in user has no local
 * record yet. Every authenticated mentorship route except `PUT /me` answers this way until
 * that call has run once for the user.
 */
export const MENTORSHIP_NOT_PROVISIONED_ERROR = 'local user is not provisioned';

/** Upstream path that lists the signed-in user's own `user_profiles` rows (filter with `profile_type`). */
export const MENTORSHIP_ME_PROFILES_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/profiles`;
export const MENTORSHIP_ME_MENTEE_PROFILE_PATH = `${MENTORSHIP_ME_PROFILES_PATH}/mentee`;
export const MENTORSHIP_ME_MENTOR_PROFILE_PATH = `${MENTORSHIP_ME_PROFILES_PATH}/mentor`;

/** Upstream path that lists the signed-in user's own applications (filter with `role`). */
export const MENTORSHIP_ME_APPLICATIONS_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/applications`;

/**
 * Upstream path for the signed-in user's own `program_members` rows (filter with `member_type`). A
 * mentor asks to join a program with a POST here and withdraws a request at `/{id}/withdraw`.
 */
export const MENTORSHIP_ME_PROGRAM_MEMBERSHIPS_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/program-memberships`;

/** Upstream applications collection; an application's tasks live at `/{id}/tasks`. */
export const MENTORSHIP_APPLICATIONS_PATH = '/mentorship/v1/applications';

/** Upstream mentor invites; the invited mentor answers at `/{token}/accept` or `/{token}/decline`. */
export const MENTORSHIP_MENTOR_INVITES_PATH = '/mentorship/v1/mentor-invites';

/** Upstream tasks collection; a mentee changes a task's status at `/{id}/submission`. */
export const MENTORSHIP_TASKS_PATH = '/mentorship/v1/tasks';

/**
 * Upstream programs collection. A program's terms live at `/{id}/terms/{termId}` and a term takes
 * applications at `.../applications`; each needs the program's UUID, since the gateway denies a slug.
 */
export const MENTORSHIP_PROGRAMS_PATH = '/mentorship/v1/programs';

/** Upstream public mentor profiles; `/{userId}` is one mentor's programs, mentees and counts, keyed by local user id. */
export const MENTORSHIP_MENTORS_PATH = '/mentorship/v1/mentors';

/** Page size for upstream mentorship list reads: the largest `limit` the service accepts. */
export const MENTORSHIP_LIST_PAGE_SIZE = 100;

/** Most pages one upstream mentorship list read follows, so a list that never ends cannot loop forever. */
export const MENTORSHIP_LIST_MAX_PAGES = 50;

/** Page size for a program's applications: the largest `limit` upstream accepts there, which resets anything above it to 10. */
export const MENTORSHIP_PROGRAM_APPLICATIONS_PAGE_SIZE = 50;

/** Most programs whose rows the mentor My Programs read loads at once. */
export const MENTORSHIP_MENTOR_PROGRAM_READ_CONCURRENCY = 5;

/** The order of the groups on mentor My Programs. */
export const MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_ORDER: readonly MentorshipMentorProgramTermStatus[] = ['active-term', 'upcoming', 'completed'];

/** Application statuses a mentor's program counts as its mentees. */
export const MENTORSHIP_MENTOR_PROGRAM_MENTEE_STATUSES: readonly MentorshipUpstreamApplicationStatus[] = ['accepted', 'graduated'];

/** Most application task reads the mentee applications read runs at once. */
export const MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY = 5;

/** Application statuses whose tasks the mentee views track; every other status is a past application. */
export const MENTORSHIP_MENTEE_TASK_TRACKED_STATUSES: readonly MentorshipUpstreamApplicationStatus[] = ['pending', 'accepted', 'graduated'];

/** Application History lists these statuses first, in this order; every other status follows. */
export const MENTORSHIP_MENTEE_HISTORY_STATUS_ORDER: readonly MentorshipUpstreamApplicationStatus[] = ['graduated', 'accepted', 'pending'];

/**
 * How a mentor's own program membership status reads on their request list. `requested` is the
 * mentor's own ask and `pending` an administrator's hold, so both are still waiting on the program,
 * and `approved` is an accepted mentor (`active` before upstream renamed it). `invited` is left out: an invitation is not a
 * request the mentor raised, and mentor invites are their own story, so those rows are not listed.
 */
export const MENTORSHIP_MENTOR_REQUEST_STATUS_MAP: Readonly<Partial<Record<MentorshipUpstreamProgramMemberStatus, MentorshipMentorStatus>>> = {
  requested: 'pending',
  pending: 'pending',
  approved: 'accepted',
  active: 'accepted',
  declined: 'declined',
  withdrawn: 'withdrawn',
};
