// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Poll type options
 * @description Different voting methods/types available
 */
export enum PollType {
  GENERIC = 'generic',
  CONDORCET_IRV = 'condorcet_irv',
  INSTANT_RUNOFF_VOTE = 'instant_runoff_vote',
  MEEK_STV = 'meek_stv',
}

/**
 * Poll status options
 * @description Possible states for a poll/vote
 */
export enum PollStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ENDED = 'ended',
}

/**
 * User's vote response status
 * @description Status of a user's participation in a poll
 */
export enum VoteResponseStatus {
  RESPONDED = 'responded',
  AWAITING_RESPONSE = 'awaiting_response',
}

/**
 * Individual vote status from query service
 * @description Status values as stored in lfx.index.individual_vote
 */
export enum IndividualVoteStatus {
  AWAITING_RESPONSE = 'awaiting response',
  RESPONDED = 'responded',
}
