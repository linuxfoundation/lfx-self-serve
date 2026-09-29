// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamApplicationStatus } from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// Mentorship service — Server-Only Constants
// ---------------------------------------------------------------------------

/** Upstream path that creates (or refreshes) the signed-in user's local mentorship record. */
export const MENTORSHIP_BOOTSTRAP_PATH = '/mentorship/v1/me';

/**
 * The `error` the mentorship service returns with a 401 when the signed-in user has no local
 * record yet. Every authenticated mentorship route except `PUT /me` answers this way until
 * that call has run once for the user.
 */
export const MENTORSHIP_NOT_PROVISIONED_ERROR = 'local user is not provisioned';

/** Upstream path that lists the signed-in user's own `user_profiles` rows (filter with `profile_type`). */
export const MENTORSHIP_ME_PROFILES_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/profiles`;

/** Upstream path that lists the signed-in user's own applications (filter with `role`). */
export const MENTORSHIP_ME_APPLICATIONS_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/applications`;

/** Upstream applications collection; an application's tasks live at `/{id}/tasks`. */
export const MENTORSHIP_APPLICATIONS_PATH = '/mentorship/v1/applications';

/**
 * Upstream programs collection. A program's terms live at `/{id}/terms/{termId}` and a term takes
 * applications at `.../applications`; each needs the program's UUID, since the gateway denies a slug.
 */
export const MENTORSHIP_PROGRAMS_PATH = '/mentorship/v1/programs';

/** Page size for upstream mentorship list reads: the largest `limit` the service accepts. */
export const MENTORSHIP_LIST_PAGE_SIZE = 100;

/** Most pages one upstream mentorship list read follows, so a list that never ends cannot loop forever. */
export const MENTORSHIP_LIST_MAX_PAGES = 50;

/** Most application task reads the mentee applications read runs at once. */
export const MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY = 5;

/** Application statuses whose tasks the mentee views track; every other status is a past application. */
export const MENTORSHIP_MENTEE_TASK_TRACKED_STATUSES: readonly MentorshipUpstreamApplicationStatus[] = ['pending', 'accepted', 'graduated'];

/** Application History lists these statuses first, in this order; every other status follows. */
export const MENTORSHIP_MENTEE_HISTORY_STATUS_ORDER: readonly MentorshipUpstreamApplicationStatus[] = ['graduated', 'accepted', 'pending'];
