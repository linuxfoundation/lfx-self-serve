// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default row count for `GET /api/committees/:uid/activity`'s `page_size` param — matches the old
 * client-side FEED_LIMIT. (v1-emitted vs. deferred `ActivityEventType` split is documented on the
 * type itself, in `activity-event.interface.ts` — no separate runtime constant needed.)
 */
export const ACTIVITY_FEED_DEFAULT_PAGE_SIZE = 8;

/** Upper bound on the `page_size` query param, rejected (400) if exceeded. */
export const ACTIVITY_FEED_MAX_PAGE_SIZE = 50;

/**
 * Floor on the per-source upstream fetch size (independent of the caller's `page_size`) — keeps a
 * small `page_size` (e.g. 1) from starving the k-way-merge correctness guarantee in
 * `CommitteeActivityService.getCommitteeActivity`, which needs `page_size + 1` genuine candidates
 * per source, not just `page_size`.
 */
export const ACTIVITY_FEED_MIN_SOURCE_FETCH_SIZE = 25;
