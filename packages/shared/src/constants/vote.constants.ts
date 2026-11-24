// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollType, VoteVoterStatus } from '../enums/poll.enum';
import type {
  VoteCommentAnonymityReason,
  VoteMethodOption,
  VoteDetailTab,
  VoteDetailTabOption,
  VoteParticipationStatusFilter,
  VoteSummaryOutcomeDisplay,
  VoteSummaryRecipientOutcome,
  VoteVoterStatusFilter,
} from '../interfaces/poll.interface';

/** Rolling deadline window shared by personal and management vote summaries. */
export const VOTES_STATS_WINDOW_DAYS = 7;

/** Compatibility alias for the My Votes summary. */
export const MY_VOTES_STATS_WINDOW_DAYS = VOTES_STATS_WINDOW_DAYS;

/** Sentinel thrown by `submitMyResponse` when the user has no pre-allocated vote_response row. */
export const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

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

/** Comments the vote detail Overview previews before linking to the Comments tab (#4448). */
export const VOTE_OVERVIEW_COMMENT_PREVIEW_LIMIT = 3;

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

/** Additional own-ballot reads while a successfully submitted ballot may still be missing from the index. */
export const VOTE_BALLOT_READ_RETRY_COUNT = 3;

/** Delay between own-ballot 404 retries; authorization and other failures are never retried. */
export const VOTE_BALLOT_READ_RETRY_DELAY_MS = 1000;

/** Ranked-choice ballot drag start delay: touch needs a short hold so swipes still scroll; mouse starts immediately. */
export const VOTE_RANKED_CHOICE_DRAG_START_DELAY = { touch: 200, mouse: 0 };

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

/** Deleting (cancelling) a vote that has already ended is rejected with this state-conflict code (#5968). */
export const VOTE_DELETE_ENDED = 'VOTE_DELETE_ENDED';

/** Client message for a VOTE_DELETE_ENDED rejection: BFF-owned so upstream copy drift never reaches the user (#5968). */
export const VOTE_DELETE_ENDED_MESSAGE = "This vote has already ended, so it can't be cancelled.";

/** No reminders were sent because at least one selected recipient is no longer eligible. */
export const VOTE_REMINDER_SELECTION_STALE = 'VOTE_REMINDER_SELECTION_STALE';

/** Pre-send checks failed before bulk_resend was attempted; retrying cannot duplicate this attempt. */
export const VOTE_REMINDER_PRECHECK_FAILED = 'VOTE_REMINDER_PRECHECK_FAILED';

/** The on-demand close summary (#3662) refuses a vote that has not ended yet with this state-conflict code. */
export const VOTE_SUMMARY_NOT_ENDED = 'VOTE_SUMMARY_NOT_ENDED';

/** The on-demand close summary (#3662) was confirmed not sent to any recipient: every attempt was rejected, none was uncertain. */
export const VOTE_SUMMARY_SEND_FAILED = 'VOTE_SUMMARY_SEND_FAILED';

/** Client wait budget for a summary POST; expiry is unconfirmed, not proof that server-side sending stopped. */
export const VOTE_SUMMARY_SEND_TIMEOUT_MS = 5 * 60 * 1000;

/** Legacy toast lifetime hint (ms) returned by the notice helper; the persistent results dialog ignores it. */
export const VOTE_SUMMARY_NOTICE_LIFE_MS = 8000;

/** Pre-send checks failed before any summary email was attempted; nothing was sent and retrying cannot duplicate this attempt. */
export const VOTE_SUMMARY_PRECHECK_FAILED = 'VOTE_SUMMARY_PRECHECK_FAILED';

/** Tag label, severity and meaning for each per-voter summary send outcome (#4830). */
export const VOTE_SUMMARY_OUTCOME_DISPLAY: Readonly<Record<VoteSummaryRecipientOutcome, VoteSummaryOutcomeDisplay>> = {
  sent: { label: 'Sent', severity: 'success', description: 'The email service confirmed the send. Inbox delivery and opens are not tracked.' },
  failed: { label: 'Not sent', severity: 'danger', description: 'The email was not sent.' },
  skipped: { label: 'Missing email', severity: 'secondary', description: 'No email address on file, so nothing could be sent.' },
  uncertain: {
    label: 'Unconfirmed',
    severity: 'warn',
    description: "LFX couldn't confirm this send. The email may already have arrived, so sending again could create duplicates.",
  },
};

/** Display order of the summary results groups (#4830). */
export const VOTE_SUMMARY_OUTCOME_ORDER: readonly VoteSummaryRecipientOutcome[] = ['sent', 'failed', 'skipped', 'uncertain'];

/** Code-point cap on the vote title in the mailing-list reminder draft (#3658), so a long title can't crowd the body. */
export const VOTE_MAILING_LIST_REMINDER_TITLE_MAX_CHARS = 120;

/** Encoded-length cap for the same title: it appears in both subject and body, and CJK/emoji expand ~3–9× under `encodeURIComponent`. */
export const VOTE_MAILING_LIST_REMINDER_TITLE_MAX_ENCODED_CHARS = 400;

/** Upper bound for the reminder `mailto:` href; the caller reports an error when the draft exceeds it. */
export const VOTE_MAILING_LIST_REMINDER_MAILTO_MAX_CHARS = 1900;

/** Active manager results: non-overlapping visible-tab reads, with capped retry backoff (#4769). */
export const VOTE_DETAIL_RESULTS_POLL_OPTIONS = {
  intervalMs: 5000,
  backoffBaseMs: 5000,
  backoffMaxMs: 30000,
  // Votes keeps its fixed 5/10/20/30 s retry cadence, as the presenter does; Marketing OS readers take the jittered default.
  jitter: false,
} as const;

/** Detail managers: total final-results reads after closure, including held payloads and failed attempts. */
export const VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS = 12;

/** Vote detail page (#3913) tab shown when `?tab=` is absent or invalid; omitted from the URL. */
export const VOTE_DETAIL_DEFAULT_TAB: VoteDetailTab = 'overview';

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

/** `?tab=` values the vote detail page accepts, derived from {@link VOTE_DETAIL_TABS}; anything else falls back to {@link VOTE_DETAIL_DEFAULT_TAB}. */
export const VOTE_DETAIL_VALID_TABS: ReadonlySet<string> = new Set<string>(VOTE_DETAIL_TABS.map((tab) => tab.key));

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

/** Action keys emitted by the vote detail summary cards and their buttons (#4447, #4770): Voters tab and Comments tab. */
export const VOTE_DETAIL_SUMMARY_CARD_ACTIONS = { RESPONSES: 'responses', COMMENTS: 'comments' } as const;

/** Caption color for the vote detail summary tiles — darker than the grid's default `text-gray-400` to meet text contrast. */
export const VOTE_DETAIL_SUMMARY_CARD_SUB_LINE_CLASS = 'text-gray-600';

/** Display label per voting method — read by the Vote details card. A missing `poll_type` reads as {@link PollType.GENERIC}. */
export const VOTE_METHOD_LABELS: Record<PollType, string> = {
  [PollType.GENERIC]: 'Plurality vote',
  [PollType.MAJORITY]: 'Majority vote',
  [PollType.CONDORCET_IRV]: 'Ranked choice (Condorcet IRV)',
  [PollType.INSTANT_RUNOFF_VOTE]: 'Instant runoff vote',
  [PollType.MEEK_STV]: 'Meek STV',
};

/** Voting methods offered when creating a vote (#2921) — read by the Create Vote dropdown and the form's Voting Method select. */
export const VOTE_METHOD_OPTIONS: VoteMethodOption[] = [
  {
    label: 'Plurality',
    value: PollType.GENERIC,
    icon: 'fa-light fa-check-to-slot',
    description: 'Voters pick from the options; the option with the most votes wins.',
  },
  {
    label: 'Condorcet IRV',
    value: PollType.CONDORCET_IRV,
    icon: 'fa-light fa-list-ol',
    description: 'Voters rank the options. The winner beats every other option head-to-head; if none does, instant-runoff elimination decides.',
    // Enable only after #5969 results support is deployed and verified.
    disabled: true,
  },
];

/** Fewest eligible voters a Condorcet IRV vote can be opened with — matches PCC's `minMembersValidator`. */
export const VOTE_CONDORCET_MIN_ELIGIBLE_VOTERS = 3;

/** Admin Mode ballot policy (#4331): only active impersonation is restricted, never an admin acting as themselves. */
export const VOTE_IMPERSONATION_READ_ONLY_NOTICE = 'Ballots are read-only while impersonating another user. You cannot cast or change their vote.';
export const VOTE_IMPERSONATION_PRIVATE_NOTICE =
  'This ballot is private while impersonating another user. Choices, abstention and ballot comments are hidden unless the vote is explicitly named.';

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

/** Presenter view: delay between `/results` re-requests while the BFF still holds an ended pseudo-anonymous vote's results. */
export const VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS = 5_000;

/** Presenter view: total `/results` requests (first included) before it stops re-requesting a still-held ended vote. */
export const VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS = 12;

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

/** Upstream 409 message (lowercased substring) when a ballot update hits a vote that makes submitted ballots final (#4723). */
export const VOTE_CHANGE_NOT_ALLOWED = 'does not allow changing a submitted vote';

/** Upstream 400 message (lowercased substring) when a ballot write hits a vote that has ended (#5964). */
export const VOTE_UPSTREAM_ENDED = 'ended';

/** Upstream 400 message (lowercased substring) when a vote link's voter was removed from the vote (#5964). */
export const VOTE_UPSTREAM_REMOVED = 'removed';

/** Verified upstream 400 message fragments rejecting ballot updates after voter removal or loss of committee membership (#5964). */
export const VOTE_UPSTREAM_UPDATE_REMOVAL_MESSAGES = [
  'vote cannot be updated for a removed voter',
  'vote cannot be changed for a removed or missing voter',
  'user is no longer in the committee for this poll',
] as const;

/** BFF 404 `code` when a ballot update finds the caller's voter row explicitly removed; missing rows keep generic `NOT_FOUND` (#5964). */
export const VOTE_VOTER_REMOVED_ERROR_CODE = 'VOTE_VOTER_REMOVED';

/** Shown when a ballot update is rejected because the vote has ended (#5964). */
export const VOTE_BALLOT_ENDED_STATE = "This vote has ended, so your ballot can't be changed.";

/** Shown when a ballot update is rejected because the caller was removed from the vote (#5964). */
export const VOTE_BALLOT_REMOVED_STATE = "You're no longer a voter on this vote, so your ballot can't be changed.";

/** Shown when a ballot update cannot find the caller's submitted ballot (#5964). */
export const VOTE_BALLOT_NOT_FOUND = "We couldn't find your submitted ballot. Refresh the list and try again.";

/** Shown when a ballot read or write is rate limited (429), so the voter knows to retry shortly (#5964). */
export const VOTE_RATE_LIMITED_MESSAGE = 'Too many requests. Please wait a moment and try again.';

/** Shown when the initial vote-link ballot read is throttled; refreshing cannot reuse the consumed token (#5964). */
export const VOTE_LINK_RATE_LIMITED_READ_MESSAGE = 'Too many requests. Please wait a moment, then reopen your ballot link.';

/** Vote-link requests allowed per IP per window: covers a shared office of voters plus reloads and retries (#5964). */
export const VOTE_LINK_RATE_LIMIT_MAX = 300;

/** Window for the vote-link rate limiter (#5964). */
export const VOTE_LINK_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Exact methods and mount-relative `/public/api` paths metered by the vote-link limiter instead of the public API limiter (#5964). */
export const VOTE_LINK_RATE_LIMITED_REQUESTS = ['POST /votes/link-ballot', 'POST /votes/link-responses', 'PUT /votes/link-responses'] as const;

/** Pre-submit notice on every first-submit surface when the vote makes submitted ballots final (#4723). */
export const VOTE_BALLOT_FINAL_NOTICE = "Once you submit, your vote can't be changed.";

/** Shown in place of a change action once a ballot on a vote that disallows changes is submitted (#4723). */
export const VOTE_BALLOT_FINAL_STATE = "Your vote is final and can't be changed.";

/** Close-vote confirmation (presenter and votes-table row menu): one copy so the two entry points never drift. */
export const VOTE_CLOSE_CONFIRMATION = {
  header: 'Close vote',
  message: 'Close the vote now? Members can no longer cast or change ballots.',
  acceptLabel: 'Close vote',
  rejectLabel: 'Cancel',
  acceptButtonStyleClass: 'p-button-danger p-button-sm',
  rejectButtonStyleClass: 'p-button-outlined p-button-sm',
} as const;

/** Cancel-vote confirmation (votes-table row menu); the message names the vote, so the table supplies it. */
export const VOTE_CANCEL_CONFIRMATION = {
  header: 'Cancel vote',
  acceptLabel: 'Cancel vote',
  rejectLabel: 'Keep vote',
  defaultFocus: 'reject',
  acceptButtonStyleClass: 'p-button-danger p-button-sm',
  rejectButtonStyleClass: 'p-button-outlined p-button-sm',
} as const;

/** Last-voter confirmation (#4726) on every first-submit surface: one copy so the cast drawer, inline ballot and vote link never drift. */
export const VOTE_LAST_VOTER_CONFIRMATION = {
  header: 'Submitting will end this vote',
  message: "You're the last member to respond, so submitting now ends the vote. You won't be able to change your choices, comments, or abstention afterward.",
  acceptLabel: 'Submit and end vote',
  rejectLabel: 'Go back',
  defaultFocus: 'reject',
  acceptButtonStyleClass: 'p-button-sm',
  rejectButtonStyleClass: 'p-button-outlined p-button-sm',
} as const;
