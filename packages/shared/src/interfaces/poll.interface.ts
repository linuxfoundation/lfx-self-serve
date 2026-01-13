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

/**
 * Choice/option within a poll question
 * @description Aligns with lfx-pcc UserChoice interface
 */
export interface UserChoice {
  /** Unique choice identifier */
  choice_id: string;
  /** Display text for the choice */
  choice_text: string;
  /** Optional value for the choice */
  choice_value?: number;
  /** Optional rank for ranked-choice voting */
  choice_rank?: number;
}

/**
 * Question in a poll
 * @description Aligns with lfx-pcc PollQuestion interface
 */
export interface PollQuestion {
  /** Unique question identifier */
  question_id: string;
  /** Question text/prompt */
  prompt: string;
  /** Question type (single_choice, multiple_choice) */
  type: string;
  /** Available choices for this question */
  choices: UserChoice[];
  /** Total number of voters who answered this question */
  total_voters?: number;
}

/**
 * User's answer to a poll question
 * @description Aligns with lfx-pcc PollAnswer interface
 */
export interface PollAnswer {
  /** Question text/prompt */
  prompt: string;
  /** Question identifier */
  question_id: string;
  /** Question type */
  type: string;
  /** User's selected choices */
  user_choice: UserChoice[];
  /** User's ranked choices (for ranked-choice voting) */
  ranked_user_choice: UserChoice[];
  /** Total voters for this question */
  total_voters?: number;
}

/**
 * Vote breakdown statistics for closed votes (generic/plurality voting)
 * @description Maps choice_id to vote count
 */
export interface GenericChoiceVotes {
  [choice_id: string]: number;
}

/**
 * Extended vote details for the vote drawer view
 * @description Contains full vote information including questions, options, and results
 */
export interface VoteDetails extends UserVote {
  /** Description of the vote */
  description?: string;
  /** Person who created/proposed the vote */
  creator?: string;
  /** Link to discussion thread */
  discussion_link?: string;
  /** Questions in this poll */
  poll_questions: PollQuestion[];
  /** User's submitted answers (null if not voted) */
  poll_answers?: PollAnswer[];
  /** Total number of voting invitations sent */
  total_voting_request_invitations?: number;
  /** Number of responses received */
  num_response_received?: number;
  /** Vote results for generic/plurality voting (choice_id -> vote count) */
  generic_choice_votes?: GenericChoiceVotes;
  /** Number of winners (for elections) */
  num_winners?: number;
  /** Whether voting is pseudo-anonymous */
  pseudo_anonymity?: boolean;
}
