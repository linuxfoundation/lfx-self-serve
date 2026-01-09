// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, PollType, VoteResponseStatus } from '../enums/poll.enum';
import { CommitteeReference } from './committee.interface';

/**
 * User's vote/poll participation
 * @description Represents a user's participation in a poll - aligns with lfx-pcc VoteResponse
 */
export interface UserVote {
  /** Unique poll identifier */
  poll_id: string;
  /** Display name of the poll */
  poll_name: string;
  /** Poll type (generic, condorcet_irv, instant_runoff_vote, meek_stv) */
  poll_type: PollType;
  /** Current status of the poll */
  poll_status: PollStatus;
  /** Associated committees with allowed voting statuses */
  committees: CommitteeReference[];
  /** Poll deadline/end time */
  end_time: string;
  /** User's voting status */
  vote_status: VoteResponseStatus;
  /** Timestamp when user submitted their vote (null if not voted) */
  vote_creation_time: string | null;
}
