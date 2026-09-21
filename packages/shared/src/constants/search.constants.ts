// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `lfx-user-search`'s default no-results copy. Shared so a consumer that swaps in its own message
 * for one mode (the formation assignee picker's local list, #2594) can hand the default back for
 * the other without restating it.
 */
export const USER_SEARCH_EMPTY_MESSAGE = 'No users found';

/**
 * The query-index corpora `GET /api/search/users` accepts as `type` — the runtime allowlist the
 * BFF validates against, and the source `UserSearchType` is derived from, so adding a corpus is
 * one edit rather than three.
 */
export const USER_SEARCH_TYPES = ['committee_member', 'meeting_registrant'] as const;
