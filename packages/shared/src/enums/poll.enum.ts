// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Poll type options
 * @description Different voting methods/types available
 */
export enum PollType {
  GENERIC = 'generic',
  MAJORITY = 'majority',
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
 * Votes-table participation display state
 * @description Which participation summary a management votes-table row renders, derived from the row's indexed counts
 */
export enum VoteRowParticipationState {
  NOT_OPEN = 'not_open',
  UNAVAILABLE = 'unavailable',
  COUNT_ONLY = 'count_only',
  NO_ELECTORATE = 'no_electorate',
  PROGRESS = 'progress',
}

/** Status values as stored in `lfx.index.individual_vote`. */
export enum IndividualVoteStatus {
  AWAITING_RESPONSE = 'awaiting response',
  RESPONDED = 'responded',
}

/** Raw `vote_status` values written by the legacy ITX system into `vote_response` rows.
 *  `lfx-v2-voting-service` forwards these unchanged. */
export enum IndexedVoteResponseStatus {
  AWAITING_RESPONSE = 'awaiting_response',
  RESPONDED = 'responded',
  ENDED = 'ended',
  AWAITING_RESPONSE_BUT_POLL_ENDED = 'awaiting_response_but_poll_ended',
}

/**
 * Participation status of an invited voter, as returned by GET /api/votes/:uid/voters (#3911).
 * @description Derived from the voter's `vote_response` row: a submitted row is `abstained` or
 * `voted`; every other row is `not_voted`.
 */
export enum VoteVoterStatus {
  VOTED = 'voted',
  ABSTAINED = 'abstained',
  NOT_VOTED = 'not_voted',
}
