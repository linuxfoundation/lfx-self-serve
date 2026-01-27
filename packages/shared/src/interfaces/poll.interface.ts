// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IndividualVoteStatus, PollStatus, PollType, VoteResponseStatus } from '../enums/poll.enum';
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

/**
 * SES Email tracking information
 * @description Email delivery and engagement tracking from AWS SES
 */
export interface SESEmailTracking {
  /** SES bounce subtype */
  ses_bounce_subtype: string;
  /** SES bounce type */
  ses_bounce_type: string;
  /** SES complaint date */
  ses_complaint_date: string;
  /** Whether SES complaint exists */
  ses_complaint_exists: boolean;
  /** SES complaint type */
  ses_complaint_type: string;
  /** Whether SES delivery was successful */
  ses_delivery_successful: boolean;
  /** Whether SES email was opened */
  ses_email_opened: boolean;
  /** First time SES email was opened */
  ses_email_opened_first_time: string;
  /** Last time SES email was opened */
  ses_email_opened_last_time: string;
  /** Whether SES link was clicked */
  ses_link_clicked: boolean;
  /** First time SES link was clicked */
  ses_link_clicked_first_time: string;
  /** Last time SES link was clicked */
  ses_link_clicked_last_time: string;
  /** SES message ID */
  ses_message_id: string;
  /** Last time SES message was sent */
  ses_message_last_sent_time: string;
}

/**
 * Full Vote entity
 * @description Represents a board-level voting poll aligned with LFX v2 voting service API
 * @see https://github.com/linuxfoundation/lfx-v2-voting-service
 */
export interface Vote {
  /** Primary unique identifier (API field: vote_uid) */
  vote_uid: string;
  /** Poll name/title */
  name: string;
  /** Poll description */
  description?: string;
  /** Poll creation timestamp */
  creation_time?: string;
  /** Last modification timestamp */
  last_modified_time?: string;
  /** Poll end/deadline timestamp */
  end_time: string;
  /** Current poll status */
  status: PollStatus;
  /** V2 project UID */
  project_uid: string;
  /** V2 committee UID */
  committee_uid?: string;
  /** Committee name */
  committee_name?: string;
  /** Committee type/category */
  committee_type?: string;
  /** Whether committee voting is enabled */
  committee_voting_status?: boolean;
  /** Eligible voting roles/statuses for this poll */
  committee_filters?: string[];
  /** Whether voting is pseudo-anonymous */
  pseudo_anonymity?: boolean;
  /** Poll voting method type */
  poll_type?: PollType;
  /** Number of winners (for elections) */
  num_winners?: number;
  /** Whether to allow abstain option */
  allow_abstain?: boolean;
  /** Questions in this poll */
  poll_questions?: PollQuestion[];
  /** Total number of voting request invitations sent */
  total_voting_request_invitations?: number;
  /** Number of responses received */
  num_response_received?: number;
  /** Vote results for generic/plurality voting (choice_id -> vote count) */
  generic_choice_votes?: GenericChoiceVotes;
}

/**
 * Individual Vote entity from query service
 * @description Represents a user's participation record from lfx.index.individual_vote
 */
export interface IndividualVote extends SESEmailTracking {
  /** Individual vote record ID */
  vote_id: string;
  /** Alias for vote_id */
  vote_uid: string;
  /** Reference to parent poll ID */
  poll_id: string;
  /** Alias for poll_id */
  poll_uid: string;
  /** User's submitted answers (null if not voted) */
  poll_answers: PollAnswer[] | null;
  /** V1 project ID */
  project_id: string;
  /** V2 project UID */
  project_uid: string;
  /** User's email address */
  user_email: string;
  /** V1 user ID */
  user_id: string;
  /** User's display name */
  user_name: string;
  /** User's login username */
  username: string;
  /** User's organization ID */
  user_org_id: string;
  /** User's organization name */
  user_org_name: string;
  /** User's role in the committee */
  user_role: string;
  /** User's voting status (e.g., "Voting Rep") */
  user_voting_status: string;
  /** Whether voter has been removed */
  voter_removed: boolean;
  /** Timestamp when vote was created/submitted */
  vote_creation_time: string;
  /** Current status of this individual vote */
  vote_status: IndividualVoteStatus;
}

/**
 * Form data structure for a question in the vote creation/edit form
 * @description Used for template iteration with properly typed form controls
 */
export interface QuestionFormData {
  /** The FormGroup for this question */
  group: import('@angular/forms').FormGroup;
  /** The question text control */
  questionControl: import('@angular/forms').AbstractControl;
  /** The response type control */
  responseTypeControl: import('@angular/forms').AbstractControl;
  /** Array of option controls */
  optionsControls: import('@angular/forms').AbstractControl[];
}

/**
 * Processed question data for the vote review step
 * @description Used for displaying question summary in the review step
 */
export interface VoteReviewQuestion {
  /** One-based question index for display */
  index: number;
  /** Question text */
  question: string;
  /** Response type (single or multiple) */
  responseType: 'single' | 'multiple';
  /** Array of non-empty option texts */
  options: string[];
}

/**
 * Processed option data for vote results display
 * @description Contains computed values for displaying vote results
 */
export interface VoteResultsOption {
  /** Choice identifier */
  choiceId: string;
  /** Option text */
  text: string;
  /** Number of votes received */
  voteCount: number;
  /** Percentage of total votes (0-100) */
  percentage: number;
  /** Whether this option is the winner (highest votes, no tie) - only for closed votes */
  isWinner: boolean;
  /** Whether this option is tied for the lead - only for closed votes */
  isTied: boolean;
  /** Whether this option is currently leading (for live votes) */
  isLeading: boolean;
}

/**
 * Processed question data for vote results display
 * @description Contains question with processed options for results view
 */
export interface VoteResultsQuestion {
  /** Question identifier */
  questionId: string;
  /** Question text/prompt */
  question: string;
  /** Processed options with vote counts and percentages */
  options: VoteResultsOption[];
  /** Total votes cast for this question */
  totalVotes: number;
}

/**
 * Participation statistics for vote results
 * @description Contains participation metrics for the results header
 */
export interface VoteParticipationStats {
  /** Total number of eligible voters */
  eligibleVoters: number;
  /** Number of responses received */
  totalResponses: number;
  /** Participation rate as percentage (0-100) */
  participationRate: number;
}

/**
 * Choice definition for creating a poll question
 * @description Used in CreatePollQuestion to define answer options
 */
export interface CreatePollChoice {
  /** Display text for the choice */
  choice_text: string;
}

/**
 * Question definition for creating a poll
 * @description Used in CreateVoteRequest to define poll questions
 */
export interface CreatePollQuestion {
  /** Question text/prompt */
  prompt: string;
  /** Question type - single or multiple choice */
  type: 'single_choice' | 'multiple_choice';
  /** Available choices for this question */
  choices: CreatePollChoice[];
}

/**
 * Comment prompt definition for creating a poll
 * @description Used in CreateVoteRequest to define optional comment prompts
 */
export interface CreatePollCommentPrompt {
  /** Comment prompt text */
  prompt: string;
}

/**
 * Request body for creating a vote/poll
 * @description Aligns with LFX v2 voting service API contract
 * @see https://github.com/linuxfoundation/lfx-v2-voting-service
 */
export interface CreateVoteRequest {
  /** Name/title of the poll (required) */
  name: string;
  /** Description of the poll */
  description?: string;
  /** Poll end/deadline timestamp in RFC3339/ISO format (required) */
  end_time: string;
  /** V2 project UID the poll belongs to (required) */
  project_uid: string;
  /** V2 committee UID - required for single committee votes */
  committee_uid: string;
  /** V2 committee UIDs - for multi-committee votes */
  committee_uids?: string[];
  /** Eligible voting roles/statuses for this poll (e.g., ["voting_rep"]) */
  committee_filters?: string[];
  /** Questions in this poll */
  poll_questions?: CreatePollQuestion[];
  /** Optional comment prompts for voter feedback */
  poll_comment_prompts?: CreatePollCommentPrompt[];
  /** Whether voting is pseudo-anonymous */
  pseudo_anonymity?: boolean;
  /** Poll voting method type (defaults to "generic") */
  poll_type?: PollType;
  /** Number of winners for elections */
  num_winners?: number;
  /** Whether to allow abstain option */
  allow_abstain?: boolean;
  /** Quorum percentage required for vote to be valid */
  quorum_percentage?: number;
  /** Winning threshold percentage required */
  winning_threshold_percentage?: number;
}

/**
 * Request body for updating a vote/poll
 * @description Only permitted when vote status is "disabled"
 * @see https://github.com/linuxfoundation/lfx-v2-voting-service
 */
export interface UpdateVoteRequest {
  /** Name/title of the poll */
  name?: string;
  /** Description of the poll */
  description?: string;
  /** Poll end/deadline timestamp in RFC3339/ISO format */
  end_time?: string;
  /** V2 project UID the poll belongs to */
  project_uid?: string;
  /** V2 committee UID */
  committee_uid?: string;
  /** V2 committee UIDs - for multi-committee votes */
  committee_uids?: string[];
  /** Eligible voting roles/statuses for this poll */
  committee_filters?: string[];
  /** Questions in this poll */
  poll_questions?: CreatePollQuestion[];
  /** Optional comment prompts for voter feedback */
  poll_comment_prompts?: CreatePollCommentPrompt[];
  /** Whether voting is pseudo-anonymous */
  pseudo_anonymity?: boolean;
  /** Poll voting method type */
  poll_type?: PollType;
  /** Number of winners for elections */
  num_winners?: number;
  /** Whether to allow abstain option */
  allow_abstain?: boolean;
  /** Quorum percentage required for vote to be valid */
  quorum_percentage?: number;
  /** Winning threshold percentage required */
  winning_threshold_percentage?: number;
}
