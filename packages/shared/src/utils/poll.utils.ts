// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, VoteResponseStatus } from '../enums/poll.enum';
import { UserVote, Vote } from '../interfaces/poll.interface';

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

/**
 * Effective close time for a poll. When a poll auto-ended early (all voters responded
 * before end_time), early_end_time holds the real close timestamp; otherwise end_time
 * is the close. Mirrors the lfx-v2-ui / pcc-v2-frontend `early_end_time ?? end_time` fallback.
 */
export function getVoteCloseTime(vote: Pick<Vote, 'end_time' | 'early_end_time'>): string {
  return vote.early_end_time ?? vote.end_time;
}

/** Tooltip copy when the scheduled close date differs from the actual early close. */
export function getVoteEndedEarlyDetailTooltip(earlyEndTimeFormatted: string): string {
  return `Vote closed early on ${earlyEndTimeFormatted}. All voters have responded.`;
}

/** True when the poll closed before its scheduled end_time (ITX auto-end). */
export function isVoteEndedEarly(vote: Pick<Vote, 'end_time' | 'early_end_time'>): boolean {
  if (!vote.early_end_time || !vote.end_time) {
    return false;
  }

  return new Date(vote.early_end_time).getTime() < new Date(vote.end_time).getTime();
}
