// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Sentinel thrown by `submitMyResponse` when the user has no pre-allocated vote_response row. */
export const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

/** Page size for the paginated comment-response lists in the vote results drawer. */
export const VOTE_COMMENT_RESULTS_PAGE_SIZE = 25;

/** Page-size options for the comment-results paginator in the vote results drawer. Includes the default page size. */
export const VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS = [5, 10, 25];

/**
 * Aggregate bound on comment responses per prompt returned by the BFF results endpoint. The upstream
 * results contract has no pagination, so without a cap the payload grows with electorate size × prompt
 * count × response length (50 prompts × 5,000 code points × N voters). The BFF keeps the most recent N
 * per prompt and reports the pre-cap count via `PollCommentResult.total_responses`. Well above any
 * realistic committee electorate; true cursor pagination is an upstream contract follow-up.
 */
export const VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT = 200;

/**
 * Response header carrying the BFF-stamped create-completion time (epoch ms) on POST /api/votes (GH-2826);
 * the client echoes it verbatim as `create_completed_at` — the enable route's FGA tuple-propagation grace hint.
 */
export const VOTE_CREATE_COMPLETED_AT_HEADER = 'x-vote-create-completed-at';

/** Tuple-propagation grace for just-created votes (GH-2826): pre-tuple FGA checks cache a denial, so first enable PUTs and the speculative-discard compensating DELETE both stay behind fga-sync's ~1.5 s tuple write. */
export const VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS = 2000;

/** Compensating-DELETE retry delay (GH-2826) — past the 10 s OpenFGA check-query cache TTL, so a pre-tuple first attempt's cached denial has expired. */
export const VOTE_SPECULATIVE_DELETE_RETRY_DELAY_MS = 12000;

/**
 * Short TTL for the vote-detail cache — lets the writerGuard probe and VoteManageComponent's refetch share one request. Mirrors COMMITTEE_DETAIL_CACHE_TTL_MS.
 */
export const VOTE_DETAIL_CACHE_TTL_MS = 10 * 1000;

/**
 * TTL for the recently-opened-vote carrier (GH-2730): how long after a successful enable the votes
 * list merges the known-open status over stale index rows while the search index catches up.
 */
export const RECENTLY_OPENED_VOTE_TTL_MS = 30 * 1000;
