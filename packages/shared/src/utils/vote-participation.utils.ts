// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, VoteRowParticipationState } from '../enums/poll.enum';
import type { Vote, VoteRowParticipation } from '../interfaces/poll.interface';
import { normalizePollStatus } from './poll.utils';

/** Rounds participation against a positive electorate, capping incomplete counts at 99% and complete/excess counts at 100%. */
export function computeParticipationPercent(responses: number, invited: number): number {
  return Math.min(responses < invited ? 99 : 100, Math.round((responses / invited) * 100));
}

/** A count is usable only when upstream sent a real non-negative number — strings/null/NaN are never coerced to 0. */
function isParticipationCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Computes the votes-table participation summary for one vote row
 * @description The denominator is the invited electorate (`total_voting_request_invitations`), not current group
 * membership. Upstream counts abstentions in `num_response_received`, matching `num_votes_cast` on the vote detail page.
 * Drafts never show counts; missing counts degrade to UNAVAILABLE/COUNT_ONLY instead of a false zero; a zero electorate
 * never yields a percent. Use the same completion-aware rounding as the vote detail page: incomplete counts cap at 99%,
 * complete/excess counts at 100%. A just-opened vote whose index row has not reported a positive electorate yet shows
 * COUNTING instead of a false "No one invited" (GH-4078).
 * @param vote - Vote list row from the query-service index or per-vote REST
 * @param awaitingInvitationCount - True while the vote is in the client's just-opened/just-created carrier window
 * @returns VoteRowParticipation for the Responses cell
 */
export function computeVoteRowParticipation(vote: Vote, awaitingInvitationCount = false): VoteRowParticipation {
  const status = normalizePollStatus(vote.status);
  const empty = { responses: null, invited: null, percent: null, secondaryLabel: null, ariaLabel: null };

  if (status === PollStatus.DISABLED) {
    return { ...empty, state: VoteRowParticipationState.NOT_OPEN, label: 'Not open yet' };
  }

  const invited = vote.total_voting_request_invitations;
  if (awaitingInvitationCount && !(isParticipationCount(invited) && invited > 0)) {
    return { ...empty, state: VoteRowParticipationState.COUNTING, label: 'Counting invitations…' };
  }

  const responses = vote.num_response_received;
  if (!isParticipationCount(responses)) {
    return { ...empty, state: VoteRowParticipationState.UNAVAILABLE, label: 'Unavailable' };
  }

  if (!isParticipationCount(invited)) {
    return {
      ...empty,
      state: VoteRowParticipationState.COUNT_ONLY,
      responses,
      label: `${responses} responded`,
      secondaryLabel: 'Total unavailable',
    };
  }

  if (invited === 0) {
    return {
      ...empty,
      state: VoteRowParticipationState.NO_ELECTORATE,
      responses,
      invited,
      label: 'No one invited',
    };
  }

  const percent = computeParticipationPercent(responses, invited);
  return {
    state: VoteRowParticipationState.PROGRESS,
    responses,
    invited,
    percent,
    label: `${responses} of ${invited} responded · ${percent}%`,
    secondaryLabel: null,
    ariaLabel: status === PollStatus.ACTIVE ? `Participation: ${responses} of ${invited} responded, ${percent}%` : null,
  };
}
