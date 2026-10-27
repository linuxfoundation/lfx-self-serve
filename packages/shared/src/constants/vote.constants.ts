// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollType, VoteVoterStatus } from '../enums/poll.enum';
import type {
  VoteCommentAnonymityReason,
  VoteDetailTab,
  VoteDetailTabOption,
  VoteParticipationStatusFilter,
  VoteVoterStatusFilter,
} from '../interfaces/poll.interface';

/** Rolling deadline window shared by personal and management vote summaries. */
export const VOTES_STATS_WINDOW_DAYS = 7;

/** Compatibility alias for the My Votes summary. */
export const MY_VOTES_STATS_WINDOW_DAYS = VOTES_STATS_WINDOW_DAYS;

/** Sentinel thrown by `submitMyResponse` when the user has no pre-allocated vote_response row. */
export const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

/** Page size for the paginated comment-response lists in the vote comment results. */
export const VOTE_COMMENT_RESULTS_PAGE_SIZE = 25;

/** Page-size options for the comment-results paginator in the vote comment results. Includes the default page size. */
export const VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS = [5, 10, 25];

/** Notice above text-only comment results, keyed by why the comments carry no names (#4330). */
export const VOTE_COMMENT_ANONYMOUS_NOTICES: Record<VoteCommentAnonymityReason, string> = {
  pseudo_anonymous:
    "Pseudo-anonymous vote. Comments are shown without names or dates, in alphabetical order. A comment's wording can still reveal who wrote it.",
  voter_view: 'Comments are shown without names. Only vote managers can see who wrote each comment.',
};

/**
 * Aggregate bound on comment responses per prompt returned by the BFF results endpoint. The upstream
 * results contract has no pagination, so without a cap the payload grows with electorate size × prompt
 * count × response length (50 prompts × 5,000 code points × N voters). Named votes keep the most recent N for vote
 * managers; pseudo-anonymous votes, and every non-manager read (#4330), keep the first N in comment-text order. The pre-cap count is reported via
 * `PollCommentResult.total_responses`. Well above any realistic committee electorate; true cursor pagination is an upstream contract follow-up.
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

/**
 * Re-fetch interval while a votes list shows a just-opened vote still waiting on its invitation count (GH-4078).
 * Polling stops once the index reports the count or the RECENTLY_OPENED_VOTE_TTL_MS carrier expires.
 */
export const VOTE_INVITATION_COUNT_REFRESH_MS = 10 * 1000;

/** Reminder reads/sends reject an inactive poll with this state-conflict code. */
export const VOTE_REMINDER_INACTIVE = 'VOTE_REMINDER_INACTIVE';

/** The voter list (#3911) rejects a draft or unrecognized-status vote with this state-conflict code. */
export const VOTE_VOTERS_DRAFT = 'VOTE_VOTERS_DRAFT';

/** No reminders were sent because at least one selected recipient is no longer eligible. */
export const VOTE_REMINDER_SELECTION_STALE = 'VOTE_REMINDER_SELECTION_STALE';

/** Pre-send checks failed before bulk_resend was attempted; retrying cannot duplicate this attempt. */
export const VOTE_REMINDER_PRECHECK_FAILED = 'VOTE_REMINDER_PRECHECK_FAILED';

/** The on-demand close summary (#3662) refuses a vote that has not ended yet with this state-conflict code. */
export const VOTE_SUMMARY_NOT_ENDED = 'VOTE_SUMMARY_NOT_ENDED';

/** The on-demand close summary (#3662) failed to send to every recipient; none were emailed. */
export const VOTE_SUMMARY_SEND_FAILED = 'VOTE_SUMMARY_SEND_FAILED';

/** Code-point cap on the vote title in the mailing-list reminder draft (#3658), so a long title can't crowd the body. */
export const VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS = 120;

/** Encoded-length cap for the same title: it appears in both subject and body, and CJK/emoji expand ~3–9× under `encodeURIComponent`. */
export const VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS = 400;

/** Upper bound for the reminder `mailto:` href; the caller reports an error when the draft exceeds it. */
export const VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS = 1900;

/** Vote detail page (#3913) tab shown when `?tab=` is absent or invalid; omitted from the URL. */
export const VOTE_DETAIL_DEFAULT_TAB: VoteDetailTab = 'overview';

/** `?tab=` values the vote detail page accepts; anything else falls back to {@link VOTE_DETAIL_DEFAULT_TAB}. */
export const VOTE_DETAIL_VALID_TABS: ReadonlySet<string> = new Set<VoteDetailTab>(['overview', 'results', 'comments', 'voters']);

/**
 * Tab strip on the vote detail page, in display order. The Comments tab is shown only when the vote has comment prompts;
 * the Voters tab (#3914, #3916) only to vote managers on a vote that is open or closed. Named votes show ballots;
 * pseudo-anonymous votes show participation only, without ballot or choice links.
 */
export const VOTE_DETAIL_TABS: readonly VoteDetailTabOption[] = [
  { key: 'overview', label: 'Overview', icon: 'fa-grid-2' },
  { key: 'results', label: 'Results', icon: 'fa-chart-simple' },
  { key: 'comments', label: 'Comments', icon: 'fa-comments' },
  { key: 'voters', label: 'Voters', icon: 'fa-users' },
];

/** Default page size for the Voters tab table on the vote detail page (#3914). */
export const VOTE_VOTERS_PAGE_SIZE = 25;

/** Page-size options for the Voters tab table. Includes the default page size. */
export const VOTE_VOTERS_ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

/** Status pill shown when no status filter is applied on the Voters tab. */
export const VOTE_VOTERS_ALL_STATUS_FILTER: VoteVoterStatusFilter = 'all';

/** Status pill labels on the Voters tab. The not-voted pill reads per vote state — see {@link VOTE_VOTER_NOT_VOTED_LABELS}. */
export const VOTE_VOTER_STATUS_FILTER_LABELS: Record<VoteVoterStatusFilter, string> = {
  all: 'All',
  [VoteVoterStatus.VOTED]: 'Voted',
  [VoteVoterStatus.ABSTAINED]: 'Abstained',
  [VoteVoterStatus.NOT_VOTED]: 'Not voted yet',
};

/** Status pill shown when no participation status filter is applied on the pseudo-anonymous Voters tab (#3916). */
export const VOTE_PARTICIPATION_ALL_STATUS_FILTER: VoteParticipationStatusFilter = 'all';

/** Status pill and Status column labels on the participation-only Voters tab of a pseudo-anonymous vote (#3916). */
export const VOTE_PARTICIPATION_STATUS_FILTER_LABELS: Record<VoteParticipationStatusFilter, string> = {
  all: 'All',
  responded: 'Responded',
  pending: 'Not responded',
};

/** A not-voted voter can still vote while the vote is open; after it closes they did not vote. */
export const VOTE_VOTER_NOT_VOTED_LABELS = { active: 'Not voted yet', closed: 'Did not vote' } as const;

/** Most chips a Choice cell shows per question before collapsing the rest into `+N`. */
export const VOTE_VOTER_MAX_CHOICE_CHIPS = 2;

/** `voters_choice` value the results' abstain row links with — it selects the Abstained status pill, not a choice. */
export const VOTE_VOTERS_ABSTAINED_CHOICE_KEY = 'status:abstained';

/** Display label per voting method — shared by the vote detail page's header and facts. A missing `poll_type` reads as {@link PollType.GENERIC}. */
export const VOTE_METHOD_LABELS: Record<PollType, string> = {
  [PollType.GENERIC]: 'Plurality Vote',
  [PollType.MAJORITY]: 'Majority Vote',
  [PollType.CONDORCET_IRV]: 'Ranked Choice (Condorcet IRV)',
  [PollType.INSTANT_RUNOFF_VOTE]: 'Instant Runoff Vote',
  [PollType.MEEK_STV]: 'Meek STV',
};
