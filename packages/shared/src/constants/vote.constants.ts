// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Rolling deadline window shared by personal and management vote summaries. */
export const VOTES_STATS_WINDOW_DAYS = 7;

/** Compatibility alias for the My Votes summary. */
export const MY_VOTES_STATS_WINDOW_DAYS = VOTES_STATS_WINDOW_DAYS;

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

/**
 * Re-fetch interval while a votes list shows a just-opened vote still waiting on its invitation count (GH-4078).
 * Polling stops once the index reports the count or the RECENTLY_OPENED_VOTE_TTL_MS carrier expires.
 */
export const VOTE_INVITATION_COUNT_REFRESH_MS = 10 * 1000;

/** Reminder reads/sends reject an inactive poll with this state-conflict code. */
export const VOTE_REMINDER_INACTIVE = 'VOTE_REMINDER_INACTIVE';

/** The voter list (#3911) rejects a draft or unrecognized-status vote with this state-conflict code. */
export const VOTE_VOTERS_DRAFT = 'VOTE_VOTERS_DRAFT';

/** The voter list (#3911) refuses a vote that is not explicitly named (`pseudo_anonymity !== false`) with this code. */
export const VOTE_VOTERS_PSEUDO_ANONYMOUS = 'VOTE_VOTERS_PSEUDO_ANONYMOUS';

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

/** Presenter view (#4140): live-count poll cadence while the tab is visible. */
export const VOTE_PRESENTER_POLL_INTERVAL_MS = 5_000;

/** Presenter view: first reconnect delay after a failed poll; doubles per consecutive failure up to the cap. */
export const VOTE_PRESENTER_BACKOFF_BASE_MS = 5_000;

/** Presenter view: ceiling for the reconnect backoff so a recovered network is noticed within half a minute. */
export const VOTE_PRESENTER_BACKOFF_MAX_MS = 30_000;

/** Presenter view: the one-second tick that refreshes the "Updated N seconds ago" label. */
export const VOTE_PRESENTER_CLOCK_TICK_MS = 1_000;

/** Presenter view and copy-slide PNG share one title cap so the two surfaces truncate identically (#4142, #4145). */
export const VOTE_PRESENTER_TITLE_MAX_CHARS = 80;

/** Copy-slide PNG (#4145): fixed 16:9 export size so it drops into Google Slides / PowerPoint uncropped. */
export const VOTE_SLIDE_WIDTH_PX = 1920;
export const VOTE_SLIDE_HEIGHT_PX = 1080;

/** Presenter view: how long the "Link copied" confirmation stays before the button label returns. */
export const VOTE_PRESENTER_COPY_CONFIRMATION_MS = 2_000;

/** QR code quiet zone in modules; the spec asks for 4, 2 still scans reliably on a projector and keeps the code large. */
export const VOTE_QR_QUIET_ZONE_MODULES = 2;

/** How long Copy slide waits for the slide's QR to render before reporting a failed export. */
export const VOTE_SLIDE_QR_READY_TIMEOUT_MS = 5000;

/** After "Send ballots now" succeeds, the action stays disabled this long to avoid re-mailing every non-responder. */
export const VOTE_SEND_BALLOTS_COOLDOWN_MS = 2 * 60 * 1000;

/** Recipients per bulk_resend call when sending ballots; ITX rejects a whole call if any recipient is invalid, so batches bound the blast radius. */
export const VOTE_SEND_BALLOTS_BATCH_SIZE = 100;

/** Upper bound on a vote link token's length — matches the voting service's `vote_token` maxLength; anything larger is rejected before it is forwarded. */
export const VOTE_LINK_TOKEN_MAX_LENGTH = 1024;

/** Fragment parameter that carries the vote link token (`/votes/{uid}#vote_token=...`). */
export const VOTE_LINK_TOKEN_FRAGMENT_PARAM = 'vote_token';

/** Upstream 400 message (lowercased substring) when a first submission hits a ballot that already has a response: switch to update. */
export const VOTE_LINK_NOT_AWAITING_RESPONSE = 'not awaiting response';

/** Upstream 400 message (lowercased substring) when an update hits a ballot with no response yet: switch to first submission. */
export const VOTE_LINK_NOT_RESPONDED = 'not responded';
