// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { IndividualVoteStatus, PollStatus, PollType, VoteResponseStatus } from '../enums/poll.enum';
import { IndividualVote, UserVote, Vote, VoteDetails } from '../interfaces/poll.interface';

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
 * Map string to CommitteeMemberVotingStatus
 * @description Converts query service voting status string to enum
 * @param value - The voting status string
 * @returns The corresponding CommitteeMemberVotingStatus or undefined if invalid
 */
function mapToCommitteeMemberVotingStatus(value: string): CommitteeMemberVotingStatus | undefined {
  const validStatuses = Object.values(CommitteeMemberVotingStatus);
  return validStatuses.find((status) => status === value);
}

/**
 * Map string array to CommitteeMemberVotingStatus array
 * @description Converts query service voting status strings to enum array.
 * @remarks Function name uses 'Filers' to match the backend field name 'committee_filers',
 * which represents eligible voting statuses despite the naming convention.
 * @param values - The voting status strings from query service (from Vote.committee_filers)
 * @returns Array of valid CommitteeMemberVotingStatus values
 */
export function mapCommitteeFilersToVotingStatuses(values: string[]): CommitteeMemberVotingStatus[] {
  return values.map((v) => mapToCommitteeMemberVotingStatus(v)).filter((v): v is CommitteeMemberVotingStatus => v !== undefined);
}

/**
 * Map IndividualVoteStatus to VoteResponseStatus
 * @description Converts query service status to user-centric status
 * @param status - The individual vote status from query service
 * @returns The corresponding VoteResponseStatus
 */
export function mapIndividualVoteStatus(status: IndividualVoteStatus): VoteResponseStatus {
  switch (status) {
    case IndividualVoteStatus.RESPONDED:
      return VoteResponseStatus.RESPONDED;
    case IndividualVoteStatus.AWAITING_RESPONSE:
    default:
      return VoteResponseStatus.AWAITING_RESPONSE;
  }
}

/**
 * Transform a Vote and IndividualVote to UserVote
 * @description Converts entity-centric data to user-centric view for "My Activity"
 * @param vote - The full vote entity from query service
 * @param individualVote - The user's individual vote record
 * @returns A UserVote object for UI consumption
 */
export function toUserVote(vote: Vote, individualVote: IndividualVote): UserVote {
  return {
    poll_id: vote.uid,
    poll_name: vote.name,
    poll_type: vote.poll_type,
    poll_status: vote.status,
    committees: [
      {
        uid: vote.committee_uid,
        name: vote.committee_name,
        allowed_voting_statuses: mapCommitteeFilersToVotingStatuses(vote.committee_filers),
      },
    ],
    end_time: vote.end_time,
    vote_status: mapIndividualVoteStatus(individualVote.vote_status),
    vote_creation_time: individualVote.vote_creation_time || null,
  };
}

/**
 * Transform a Vote and IndividualVote to VoteDetails
 * @description Converts entity-centric data to detailed view for vote drawer
 * @param vote - The full vote entity from query service
 * @param individualVote - The user's individual vote record
 * @returns A VoteDetails object for UI consumption
 */
export function toVoteDetails(vote: Vote, individualVote: IndividualVote): VoteDetails {
  return {
    ...toUserVote(vote, individualVote),
    description: vote.description,
    poll_questions: vote.poll_questions,
    poll_answers: individualVote.poll_answers ?? undefined,
    total_voting_request_invitations: vote.total_voting_request_invitations,
    num_response_received: vote.num_response_received,
    num_winners: vote.num_winners,
    pseudo_anonymity: vote.pseudo_anonymity,
  };
}

/**
 * Type guard for Vote entity
 * @description Checks if an object is a Vote entity from query service.
 * Performs minimal structural validation for quick checks. For production use,
 * consider additional validation of enum values against PollStatus and PollType.
 * @param obj - The object to check
 * @returns True if the object is a Vote
 */
export function isVote(obj: unknown): obj is Vote {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const vote = obj as Record<string, unknown>;

  // Basic structural validation
  const hasRequiredFields =
    typeof vote['uid'] === 'string' &&
    typeof vote['poll_id'] === 'string' &&
    typeof vote['name'] === 'string' &&
    typeof vote['status'] === 'string' &&
    typeof vote['poll_type'] === 'string' &&
    Array.isArray(vote['poll_questions']);

  if (!hasRequiredFields) {
    return false;
  }

  // Validate enum values
  const validStatuses = Object.values(PollStatus) as string[];
  const validPollTypes = Object.values(PollType) as string[];

  return validStatuses.includes(vote['status'] as string) && validPollTypes.includes(vote['poll_type'] as string);
}

/**
 * Type guard for IndividualVote entity
 * @description Checks if an object is an IndividualVote entity from query service.
 * Performs minimal structural validation for quick checks. For production use,
 * consider additional validation of enum values against IndividualVoteStatus.
 * @param obj - The object to check
 * @returns True if the object is an IndividualVote
 */
export function isIndividualVote(obj: unknown): obj is IndividualVote {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const individualVote = obj as Record<string, unknown>;

  // Basic structural validation
  const hasRequiredFields =
    typeof individualVote['vote_id'] === 'string' &&
    typeof individualVote['poll_id'] === 'string' &&
    typeof individualVote['user_id'] === 'string' &&
    typeof individualVote['vote_status'] === 'string';

  if (!hasRequiredFields) {
    return false;
  }

  // Validate enum values
  const validStatuses = Object.values(IndividualVoteStatus) as string[];

  return validStatuses.includes(individualVote['vote_status'] as string);
}
