// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CondorcetOutcome, VoteVoterStatus } from '../enums/poll.enum';
import type {
  CondorcetBallotPatternRow,
  CondorcetCandidate,
  CondorcetMatrixEntry,
  CondorcetPairwiseCell,
  CondorcetPairwiseRow,
  CondorcetQuestionView,
  CondorcetRankSummaryRow,
  CondorcetStandingRow,
  IrvRoundSummary,
  PollQuestionResult,
  VoteResultsResponse,
  VoteResultsSummaryLine,
  VoteVoter,
} from '../interfaces/poll.interface';
import { joinNames } from './vote-results.utils';

/**
 * Builds the Condorcet IRV results view for each question (#5969), a port of PCC's condorcet-poll-result derivations
 * @description The winner is never computed here: it is read from `ranked_choice_winner_info.poll_choices` (the winners
 * only) and `condorcet_irv_used_for_eliminations`. Pairwise cells, head-to-head win counts, standings and rank
 * summaries are display derivations. Every table follows `question.choices` order, because upstream's
 * `ranked_choice_votes` order is unstable.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @param ballots - Named ballots readable by the vote's manager, or null when individual ballots aren't available
 * @returns One CondorcetQuestionView per poll question, in API order
 */
export function buildCondorcetQuestionViews(results: VoteResultsResponse | null, ballots: VoteVoter[] | null): CondorcetQuestionView[] {
  if (!results?.poll_results?.length) return [];
  return results.poll_results.map((pr) => buildQuestionView(pr, ballots));
}

/**
 * Builds the vote detail Overview line for each closed Condorcet IRV question (#5969)
 * @param views - Views from `buildCondorcetQuestionViews`
 * @param isClosed - Whether the vote is finalized
 * @returns "Winner: X", "Tied: A and B" or "No winner" per question; empty while the vote is open, so the caller keeps its live summary
 */
export function buildCondorcetSummaryLines(views: CondorcetQuestionView[], isClosed: boolean): VoteResultsSummaryLine[] {
  if (!isClosed) return [];
  return views.map((view) => {
    let text = 'No winner';
    if (view.outcome === CondorcetOutcome.CONDORCET_WINNER || view.outcome === CondorcetOutcome.IRV_WINNER) {
      text = `Winner: ${view.winnerNames[0]}`;
    } else if (view.outcome === CondorcetOutcome.TIE) {
      text = `Tied: ${joinNames(view.winnerNames)}`;
    }
    return { questionId: view.questionId, question: view.prompt, text };
  });
}

function buildQuestionView(pr: PollQuestionResult, ballots: VoteVoter[] | null): CondorcetQuestionView {
  const rankedVotes = pr.ranked_choice_votes ?? [];
  const textById = new Map((pr.question.choices ?? []).map((choice) => [choice.choice_id, choice.choice_text]));
  for (const choice of pr.ranked_choice_winner_info?.poll_choices ?? []) {
    if (choice.choice_text) textById.set(choice.choice_id, choice.choice_text);
  }

  const candidates: CondorcetCandidate[] = (pr.question.choices ?? []).map((choice) => ({
    choiceId: choice.choice_id,
    choiceText: textById.get(choice.choice_id) ?? choice.choice_id,
  }));
  // A ranked choice missing from the question definition still gets a row, labelled by id.
  for (const rcv of rankedVotes) {
    if (!candidates.some((candidate) => candidate.choiceId === rcv.choice_id)) {
      candidates.push({ choiceId: rcv.choice_id, choiceText: textById.get(rcv.choice_id) ?? rcv.choice_id });
    }
  }

  const matrix = buildMatrix(pr);
  const winCounts = new Map(candidates.map((candidate) => [candidate.choiceId, countHeadToHeadWins(candidate.choiceId, matrix)]));
  const totalMatchups = matrix.size > 0 ? Math.max(candidates.length - 1, 0) : 0;

  const winnerIds = [...new Set((pr.ranked_choice_winner_info?.poll_choices ?? []).map((choice) => choice.choice_id))];
  const usedIrv = pr.ranked_choice_winner_info?.condorcet_irv_used_for_eliminations === true;
  const outcome = resolveOutcome(winnerIds.length, candidates.length, usedIrv);
  // Every candidate returned is no winner (PCC parity), so nobody is marked as a winner.
  const winners = new Set(outcome === CondorcetOutcome.NO_WINNER ? [] : winnerIds);
  const winnerNames = candidates.filter((candidate) => winners.has(candidate.choiceId)).map((candidate) => candidate.choiceText);
  const isTie = outcome === CondorcetOutcome.TIE;

  const standings = usedIrv
    ? buildIrvStandings(candidates, winners, isTie, pr.irv_round_summary ?? [], matrix, winCounts, totalMatchups)
    : buildCondorcetStandings(candidates, winners, isTie, matrix, winCounts, totalMatchups);

  const ranks = candidates.map((_, index) => index + 1);
  const rankCountsById = new Map(rankedVotes.map((rcv) => [rcv.choice_id, rcv.rank_counts ?? []]));
  const rankSummary: CondorcetRankSummaryRow[] = candidates.map((candidate) => ({
    candidate,
    counts: ranks.map((rank) => rankCountsById.get(candidate.choiceId)?.find((rc) => rc.rank === rank)?.count ?? 0),
  }));

  return {
    questionId: pr.question.question_id,
    prompt: pr.question.prompt,
    candidates,
    outcome,
    winnerNames,
    usedIrv,
    standings,
    pairwise: buildPairwise(candidates, matrix),
    ranks,
    rankSummary,
    ballotPatterns: ballots ? buildBallotPatterns(pr.question.question_id, ballots, textById) : null,
  };
}

/** Outcome rules mirror PCC's condorcet-poll-result: one winner, a partial tie, or no winner (none, or every candidate). */
function resolveOutcome(winnerCount: number, candidateCount: number, usedIrv: boolean): CondorcetOutcome {
  if (winnerCount === 1) return usedIrv ? CondorcetOutcome.IRV_WINNER : CondorcetOutcome.CONDORCET_WINNER;
  if (winnerCount > 1 && winnerCount < candidateCount) return CondorcetOutcome.TIE;
  return CondorcetOutcome.NO_WINNER;
}

/** Pairwise lookup: row choice id → column choice id → matrix entry. */
function buildMatrix(pr: PollQuestionResult): Map<string, Map<string, CondorcetMatrixEntry>> {
  const matrix = new Map<string, Map<string, CondorcetMatrixEntry>>();
  for (const rcv of pr.ranked_choice_votes ?? []) {
    for (const entry of rcv.condorcet_matrix ?? []) {
      if (!matrix.has(entry.choice_id)) matrix.set(entry.choice_id, new Map());
      matrix.get(entry.choice_id)?.set(entry.other_choice_id, entry);
    }
  }
  return matrix;
}

/** Voters preferring the row over the column, and the reverse; a missing entry is read from its mirror, then 0–0. */
function pairwiseCounts(rowId: string, colId: string, matrix: Map<string, Map<string, CondorcetMatrixEntry>>): [number, number] {
  const entry = matrix.get(rowId)?.get(colId);
  if (entry) return [entry.choice_id_wins, entry.other_choice_id_wins];
  const mirror = matrix.get(colId)?.get(rowId);
  return mirror ? [mirror.other_choice_id_wins, mirror.choice_id_wins] : [0, 0];
}

function countHeadToHeadWins(choiceId: string, matrix: Map<string, Map<string, CondorcetMatrixEntry>>): number {
  return [...(matrix.get(choiceId)?.values() ?? [])].filter((entry) => entry.choice_id_wins > entry.other_choice_id_wins).length;
}

function buildPairwise(candidates: CondorcetCandidate[], matrix: Map<string, Map<string, CondorcetMatrixEntry>>): CondorcetPairwiseRow[] {
  return candidates.map((row) => ({
    candidate: row,
    cells: candidates.map((col): CondorcetPairwiseCell => {
      if (row.choiceId === col.choiceId) return { value: '—', result: 'self' };
      const [rowWins, colWins] = pairwiseCounts(row.choiceId, col.choiceId, matrix);
      let result: CondorcetPairwiseCell['result'] = 'neutral';
      if (rowWins > colWins) result = 'win';
      else if (rowWins < colWins) result = 'loss';
      else if (rowWins > 0) result = 'tie';
      return { value: `${rowWins}–${colWins}`, result };
    }),
  }));
}

/** Competition ranking ("1, 2, 2, 4") by head-to-head wins; mirrors PCC's condorcet-standings pipe. */
function buildCondorcetStandings(
  candidates: CondorcetCandidate[],
  winners: Set<string>,
  isTie: boolean,
  matrix: Map<string, Map<string, CondorcetMatrixEntry>>,
  winCounts: Map<string, number>,
  totalMatchups: number
): CondorcetStandingRow[] {
  if (matrix.size === 0) return [];
  const sorted = [...candidates].sort((a, b) => (winCounts.get(b.choiceId) ?? 0) - (winCounts.get(a.choiceId) ?? 0));
  let rank = 1;
  return sorted.map((candidate, index) => {
    const winCount = winCounts.get(candidate.choiceId) ?? 0;
    if (index > 0 && winCount < (winCounts.get(sorted[index - 1].choiceId) ?? 0)) rank = index + 1;
    return standingRow(candidate, rank, winners, isTie, null, winCounts, totalMatchups);
  });
}

/**
 * Instant-runoff standings; mirrors PCC's irv-standings pipe
 * @description Winners first at rank 1, then survivors by final-round votes with head-to-head as the tiebreaker, then
 * eliminated candidates, latest round first. Without round data the non-winners share the next rank. With no winner
 * (none returned, or every candidate returned) the service ordered none of the survivors, so they share rank 1 in
 * question order, as PCC ranks every returned candidate first.
 */
function buildIrvStandings(
  candidates: CondorcetCandidate[],
  winners: Set<string>,
  isTie: boolean,
  rounds: IrvRoundSummary[],
  matrix: Map<string, Map<string, CondorcetMatrixEntry>>,
  winCounts: Map<string, number>,
  totalMatchups: number
): CondorcetStandingRow[] {
  const winnerRows = candidates.filter((c) => winners.has(c.choiceId)).map((c) => standingRow(c, 1, winners, isTie, null, winCounts, totalMatchups));

  if (rounds.length === 0) {
    let nonWinnerRank = 2;
    if (winnerRows.length === 0) nonWinnerRank = 1;
    else if (isTie) nonWinnerRank = winnerRows.length + 1;
    const others = candidates.filter((c) => !winners.has(c.choiceId)).map((c) => standingRow(c, nonWinnerRank, winners, isTie, null, winCounts, totalMatchups));
    return [...winnerRows, ...others];
  }

  const eliminations = rounds
    .filter((round) => !!round.eliminated_choice_id && !winners.has(round.eliminated_choice_id))
    .sort((a, b) => b.round_number - a.round_number);
  const eliminatedIds = new Set(eliminations.map((round) => round.eliminated_choice_id));
  const finalRound = rounds.reduce((latest, round) => (round.round_number > latest.round_number ? round : latest), rounds[0]);
  const finalVotes = new Map((finalRound.votes ?? []).map((vote) => [vote.choice_id, vote.vote_count]));

  const survivorsShareRank = winnerRows.length === 0;
  const survivors = candidates.filter((c) => !winners.has(c.choiceId) && !eliminatedIds.has(c.choiceId));
  if (!survivorsShareRank) {
    survivors.sort((a, b) => {
      const byVotes = (finalVotes.get(b.choiceId) ?? 0) - (finalVotes.get(a.choiceId) ?? 0);
      if (byVotes !== 0) return byVotes;
      const [aOverB, bOverA] = pairwiseCounts(a.choiceId, b.choiceId, matrix);
      return bOverA - aOverB;
    });
  }

  const standings = [...winnerRows];
  let rank = winnerRows.length > 0 ? 2 : 1;
  if (isTie) rank = winnerRows.length + 1;
  for (const survivor of survivors) {
    standings.push(standingRow(survivor, rank, winners, isTie, null, winCounts, totalMatchups));
    if (!survivorsShareRank) rank++;
  }

  rank = standings.length + 1;
  const seen = new Set<string>();
  for (const round of eliminations) {
    const choiceId = round.eliminated_choice_id as string;
    if (seen.has(choiceId)) continue;
    seen.add(choiceId);
    const candidate = candidates.find((c) => c.choiceId === choiceId) ?? { choiceId, choiceText: choiceId };
    standings.push(standingRow(candidate, rank, winners, isTie, round.round_number, winCounts, totalMatchups));
    rank++;
  }
  return standings;
}

function standingRow(
  candidate: CondorcetCandidate,
  rank: number,
  winners: Set<string>,
  isTie: boolean,
  eliminatedInRound: number | null,
  winCounts: Map<string, number>,
  totalMatchups: number
): CondorcetStandingRow {
  const isWinner = winners.has(candidate.choiceId);
  return {
    rank,
    choiceId: candidate.choiceId,
    choiceText: candidate.choiceText,
    winCount: winCounts.get(candidate.choiceId) ?? 0,
    totalMatchups,
    isWinner,
    isTied: isWinner && isTie,
    eliminatedInRound,
  };
}

/** Counts identical rankings across submitted, non-abstained ballots, most common first; mirrors PCC's getPermutationsMatrix. */
function buildBallotPatterns(questionId: string, ballots: VoteVoter[], textById: Map<string, string>): CondorcetBallotPatternRow[] {
  const patterns = new Map<string, CondorcetBallotPatternRow>();
  for (const ballot of ballots) {
    if (ballot.status !== VoteVoterStatus.VOTED) continue;
    const ranked = [...(ballot.poll_answers?.find((answer) => answer.question_id === questionId)?.ranked_user_choice ?? [])].sort(
      (a, b) => (a.choice_rank ?? 0) - (b.choice_rank ?? 0)
    );
    if (!ranked.length) continue;
    const key = ranked.map((choice) => choice.choice_id).join('\u0000');
    const existing = patterns.get(key);
    if (existing) {
      existing.count++;
    } else {
      patterns.set(key, { key, count: 1, ranking: ranked.map((choice) => textById.get(choice.choice_id) ?? choice.choice_text ?? choice.choice_id) });
    }
  }
  return [...patterns.values()].sort((a, b) => b.count - a.count);
}
