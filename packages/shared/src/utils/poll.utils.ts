// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, VoteResponseStatus } from '../enums/poll.enum';
import type { PollCommentResponse, UserVote, Vote } from '../interfaces/poll.interface';

/**
 * Combined vote status type
 * @description Represents the combined state of poll status and vote response status
 */
export type CombinedVoteStatus = 'open' | 'submitted' | 'closed';

/**
 * Get the combined status for a vote/poll
 * @description Derives a single status from poll_status and vote_status
 * - 'open' = poll is ACTIVE and user has not RESPONDED
 * - 'submitted' = poll is ACTIVE and user has RESPONDED
 * - 'closed' = poll has ENDED (or any other status)
 * @param vote - The user vote to get status for
 * @returns The combined vote status
 */
export function getCombinedVoteStatus(vote: UserVote): CombinedVoteStatus {
  if (vote.poll_status === PollStatus.ENDED) {
    return 'closed';
  }

  if (vote.poll_status === PollStatus.ACTIVE) {
    return vote.vote_status === VoteResponseStatus.RESPONDED ? 'submitted' : 'open';
  }

  return 'closed';
}

/** Tooltip copy when a vote auto-ended because all eligible voters responded. */
export function getVoteEndedEarlyDetailTooltip(earlyEndTimeFormatted: string): string {
  return `Vote closed early on ${earlyEndTimeFormatted}. All voters have responded.`;
}

/** True when ITX auto-ended the poll because all eligible voters responded. */
export function isVoteEndedEarly(vote: Pick<Vote, 'early_end_time'>): boolean {
  return Boolean(vote.early_end_time);
}

/**
 * Lowercase and validate a poll status before comparing or looking it up.
 * @description `Vote.status` has shipped with inconsistent casing before (fixed in
 * PollStatusLabelPipe / PollStatusSeverityPipe, now both routed through this shared helper).
 * Takes `string | null | undefined` rather than `PollStatus` — the `PollStatus` type marks
 * `status` required and canonically-cased, but that guarantee is asserted rather than
 * runtime-validated (some server-side vote mappers construct partial objects with `as Vote`),
 * so the input type reflects what's actually received, not what the type system claims.
 * Returns `undefined` (not a cast-over `PollStatus`) when the value isn't a real member after
 * lowercasing, so callers' `POLL_STATUS_LABELS[key]` fallbacks stay type-visible instead of
 * silently unreachable dead code.
 */
export function normalizePollStatus(status: string | null | undefined): PollStatus | undefined {
  const normalized = (status ?? '').toLowerCase();
  return (Object.values(PollStatus) as string[]).includes(normalized) ? (normalized as PollStatus) : undefined;
}

/**
 * Sort comment-prompt responses newest-first by `vote_creation_time`.
 * @description Returns a new array — never mutates the API payload. An unparseable timestamp
 * parses to NaN, which `|| 0` collapses to epoch 0 so a malformed row sinks to the end instead
 * of scrambling the comparator with NaN. Ties keep the API's original order (stable sort).
 */
export function sortCommentResponsesByRecency(responses: PollCommentResponse[]): PollCommentResponse[] {
  return [...responses].sort((a, b) => (Date.parse(b.vote_creation_time) || 0) - (Date.parse(a.vote_creation_time) || 0));
}
