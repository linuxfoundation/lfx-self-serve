// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Sentinel thrown by `submitMyResponse` when the user has no pre-allocated vote_response row. */
export const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

/** Page size for the paginated comment-response lists in the vote results drawer. */
export const VOTE_COMMENT_RESULTS_PAGE_SIZE = 25;

/** Page-size options for the comment-results paginator in the vote results drawer. Includes the default page size. */
export const VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS = [5, 10, 25];
