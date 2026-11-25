// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { IrvRoundCell, IrvRoundRow, IrvRoundStep, IrvRoundSummary, IrvRoundsView, IrvRoundTransfer } from '../interfaces/poll.interface';

/**
 * Builds the round-by-round instant-runoff view from a question's `irv_round_summary` (#6152)
 * @description Rounds are sorted by `round_number`. Rows follow `orderedChoiceIds` (the caller's standings order), then
 * any other choice a round counts, in first-seen order. A candidate missing from a round's `votes` is out of the race
 * for that round. The voting service sends `eliminated_choice_id` as `""` when nobody was eliminated, so `""` and a
 * missing id mean the same. Percentages are whole numbers of the round's continuing ballots; the upstream `percentage`
 * is ignored. Round messages embed raw choice ids, so only their tie-break markers are read. Node-safe: imports types only.
 * @param rounds - The question's `irv_round_summary`
 * @param orderedChoiceIds - Choice ids in the order rows should read
 * @param winnerIds - The displayed winners; one marks the final round's winner, several mark a tie, none marks no winner
 * @param textOf - Resolves a choice id to its display text
 * @returns The round view, or null when there are no rounds
 */
export function buildIrvRoundsView(
  rounds: IrvRoundSummary[],
  orderedChoiceIds: string[],
  winnerIds: string[],
  textOf: (choiceId: string) => string
): IrvRoundsView | null {
  if (!rounds.length) return null;

  const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);
  const finalRoundNumber = sortedRounds[sortedRounds.length - 1].round_number;

  const rowIds = [...new Set([...orderedChoiceIds, ...sortedRounds.flatMap((round) => (round.votes ?? []).map((vote) => vote.choice_id))])];
  const rowPosition = new Map(rowIds.map((id, index) => [id, index]));
  const winnerSet = new Set(winnerIds);
  const orderedWinnerIds = [...winnerSet].sort((a, b) => (rowPosition.get(a) ?? rowIds.length) - (rowPosition.get(b) ?? rowIds.length));

  const columns = sortedRounds.map((round) => ({
    roundNumber: round.round_number,
    continuingBallots: round.total_votes,
    exhaustedBallots: round.exhausted_votes,
    threshold: round.threshold,
    isFinal: round.round_number === finalRoundNumber,
  }));

  const rows: IrvRoundRow[] = rowIds.map((choiceId) => ({
    choiceId,
    choiceText: textOf(choiceId),
    cells: sortedRounds.map((round) => buildCell(round, choiceId, round.round_number === finalRoundNumber, winnerSet)),
  }));

  const steps = sortedRounds.map((round) => buildStep(round, round.round_number === finalRoundNumber, orderedWinnerIds, rowPosition, textOf));

  return { rounds: columns, rows, steps };
}

/** One candidate's cell in one round: out of the race, eliminated, the final round's winner or tied winner, or continuing. */
function buildCell(round: IrvRoundSummary, choiceId: string, isFinal: boolean, winnerSet: Set<string>): IrvRoundCell {
  const vote = (round.votes ?? []).find((entry) => entry.choice_id === choiceId);
  if (!vote) return { roundNumber: round.round_number, votes: null, percentage: null, status: 'out' };

  const eliminatedId = round.eliminated_choice_id || null;
  let status: IrvRoundCell['status'] = 'continuing';
  if (eliminatedId === choiceId) {
    status = 'eliminated';
  } else if (isFinal && !eliminatedId && winnerSet.has(choiceId)) {
    status = winnerSet.size === 1 ? 'winner' : 'tied';
  }

  const percentage = round.total_votes > 0 ? Math.round((vote.vote_count / round.total_votes) * 100) : 0;
  return { roundNumber: round.round_number, votes: vote.vote_count, percentage, status };
}

/** What happened in one round: an elimination with its transfers, or the final round's winner, tie, exhaustion or no winner. */
function buildStep(
  round: IrvRoundSummary,
  isFinal: boolean,
  orderedWinnerIds: string[],
  rowPosition: Map<string, number>,
  textOf: (choiceId: string) => string
): IrvRoundStep {
  const countOf = (choiceId: string): number | null => (round.votes ?? []).find((entry) => entry.choice_id === choiceId)?.vote_count ?? null;
  const step: IrvRoundStep = {
    roundNumber: round.round_number,
    kind: 'none',
    choiceTexts: [],
    votes: null,
    continuingBallots: round.total_votes,
    threshold: round.threshold,
    transfers: [],
    exhaustedFromElimination: 0,
    tieBreak: null,
    tieBreakLevel: null,
  };

  const eliminatedId = round.eliminated_choice_id || null;
  if (eliminatedId) {
    const votes = countOf(eliminatedId) ?? 0;
    const transfers: IrvRoundTransfer[] = (round.transferred_votes ?? [])
      .map((transfer) => ({ choiceId: transfer.choice_id, choiceText: textOf(transfer.choice_id), votes: transfer.vote_count }))
      .sort((a, b) => b.votes - a.votes || (rowPosition.get(a.choiceId) ?? rowPosition.size) - (rowPosition.get(b.choiceId) ?? rowPosition.size));
    const transferred = transfers.reduce((sum, transfer) => sum + transfer.votes, 0);
    return {
      ...step,
      kind: 'eliminated',
      choiceTexts: [textOf(eliminatedId)],
      votes,
      transfers,
      exhaustedFromElimination: Math.max(0, votes - transferred),
      ...parseTieBreak(round.message),
    };
  }

  if (!isFinal) return step;
  if (round.total_votes === 0) return { ...step, kind: 'exhausted' };
  if (!orderedWinnerIds.length) return step;
  return {
    ...step,
    kind: orderedWinnerIds.length === 1 ? 'winner' : 'tie',
    choiceTexts: orderedWinnerIds.map(textOf),
    votes: countOf(orderedWinnerIds[0]),
  };
}

/** Reads how a tie for elimination was settled from the voting service's round message; no marker means no note. */
function parseTieBreak(message: string | undefined): Pick<IrvRoundStep, 'tieBreak' | 'tieBreakLevel'> {
  const level = /broken at preference level (\d+)/.exec(message ?? '');
  if (level) return { tieBreak: 'lower_preference', tieBreakLevel: Number(level[1]) };
  if (/broken randomly/.test(message ?? '')) return { tieBreak: 'random', tieBreakLevel: null };
  return { tieBreak: null, tieBreakLevel: null };
}
