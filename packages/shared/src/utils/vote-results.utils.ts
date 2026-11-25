// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_OVERVIEW_STANDINGS_LIMIT, VOTE_RANKED_OUTCOME_EXPLANATIONS } from '../constants/vote.constants';
import { CondorcetOutcome, PollType } from '../enums/poll.enum';
import type {
  IndexedPollAnswer,
  IrvRoundSummary,
  MeekStvRoundSummary,
  CondorcetMatrixEntry,
  PollQuestionResult,
  RankedChoiceVoteResult,
  RankedOutcome,
  RankedQuestionView,
  RankedStanding,
  UserChoice,
  VoteOverviewOutcome,
  VoteOverviewStanding,
  VoteParticipationStats,
  VoteResultsOption,
  VoteResultsQuestion,
  VoteResultsResponse,
  VoteResultsSummaryLine,
} from '../interfaces/poll.interface';
import { computeParticipationPercent } from './vote-participation.utils';

/** Interprets the service's Condorcet winners: one winner, a partial tie, or no winner (none or every candidate). */
export function resolveCondorcetOutcome(winnerCount: number, candidateCount: number, usedIrv: boolean): CondorcetOutcome {
  if (winnerCount === 1) return usedIrv ? CondorcetOutcome.IRV_WINNER : CondorcetOutcome.CONDORCET_WINNER;
  if (winnerCount > 1 && winnerCount < candidateCount) return CondorcetOutcome.TIE;
  return CondorcetOutcome.NO_WINNER;
}

/** Shared Condorcet IRV survivor tiebreaker; reads a missing pair from its mirror, then treats it as 0–0. */
export function buildCondorcetSurvivorTiebreaker(rankedVotes: RankedChoiceVoteResult[]): (a: string, b: string) => number {
  const matrix = new Map<string, CondorcetMatrixEntry>();
  for (const rcv of rankedVotes) {
    for (const entry of rcv.condorcet_matrix ?? []) {
      matrix.set(JSON.stringify([entry.choice_id, entry.other_choice_id]), entry);
    }
  }
  return (a, b) => {
    const entry = matrix.get(JSON.stringify([a, b]));
    if (entry) return entry.other_choice_id_wins - entry.choice_id_wins;
    const mirror = matrix.get(JSON.stringify([b, a]));
    return mirror ? mirror.choice_id_wins - mirror.other_choice_id_wins : 0;
  };
}

/**
 * True when a poll type uses ranked-choice balloting (drag-to-reorder UI, `ranked_choices` wire shape).
 * @description Implemented as an allowlist, not a negation of GENERIC — upstream ITX can emit poll_type
 * values with no corresponding ranked UI (e.g. `majority`, #4075), and PollType may grow more non-ranked
 * members later. An unrecognized or missing value defaults to false (single/multi-choice), never to ranked.
 */
export function isRankedPollType(pollType: PollType | string | null | undefined): boolean {
  return pollType === PollType.CONDORCET_IRV || pollType === PollType.INSTANT_RUNOFF_VOTE || pollType === PollType.MEEK_STV;
}

/**
 * Computes participation stats for the vote detail page from the results API payload
 * @description Upstream (itx-service-voting) counts abstentions in `num_votes_cast` but excludes them from
 * per-choice tallies, so `abstainedVoters` is a subset of `totalResponses`; `abstainedRate` is their share of all
 * responses cast — the same `num_votes_cast` base upstream uses for per-choice percentages, so the two always agree.
 * Participation uses the same completion-aware rounding as the table: incomplete counts cap at 99%, complete/excess counts at 100%.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @returns VoteParticipationStats for the participation card and abstain row
 */
export function computeVoteParticipationStats(results: VoteResultsResponse | null): VoteParticipationStats {
  if (!results) {
    return { eligibleVoters: 0, totalResponses: 0, participationRate: 0, abstainedVoters: 0, abstainedRate: 0 };
  }

  const eligibleVoters = results.num_recipients || 0;
  const totalResponses = results.num_votes_cast || 0;
  const abstainedVoters = results.num_abstained || 0;
  const participationRate = eligibleVoters > 0 ? computeParticipationPercent(totalResponses, eligibleVoters) : 0;
  const abstainedRate = totalResponses > 0 ? Math.round((abstainedVoters / totalResponses) * 100) : 0;

  return { eligibleVoters, totalResponses, participationRate, abstainedVoters, abstainedRate };
}

/**
 * Splits participation into progress-bar segments, as percentages of eligible voters
 * @description `voted` is the share that cast a substantive ballot (responses minus abstentions); `abstained` is the
 * share that abstained. Together they represent overall participation, capped at 100%. Zero eligible voters yields zeros;
 * abstentions are bounded by total participation so inconsistent upstream counts cannot overflow the bar.
 * @param stats - VoteParticipationStats from computeVoteParticipationStats
 * @param abstained - Abstention count to show; pass 0 when the payload withholds it
 * @returns Percentages for the voted and abstained segments
 */
export function computeParticipationSegments(stats: VoteParticipationStats, abstained: number): { voted: number; abstained: number } {
  if (stats.eligibleVoters <= 0) {
    return { voted: 0, abstained: 0 };
  }

  const clamp = (value: number): number => Math.min(100, Math.max(0, value));
  const totalPercent = clamp((stats.totalResponses / stats.eligibleVoters) * 100);
  const abstainedPercent = Math.min(totalPercent, clamp((abstained / stats.eligibleVoters) * 100));

  return { voted: totalPercent - abstainedPercent, abstained: abstainedPercent };
}

/**
 * Builds the generic (plurality) per-question results view model from the results API payload
 * @description Choice percentages prefer the upstream value and fall back to `num_votes_cast` as the base. Winner and
 * tie markers are only set when `isClosed`; `isLeading` marks the top option(s) regardless of `isClosed`, and live
 * views use it for the highlight. Options follow the question's configured choice order rather than the tally rows'
 * order, which upstream does not keep stable between reads (#5021); tally rows for choice ids the question does not
 * list follow, in their payload order. Only the supplied tally rows are projected — no zero rows are added for
 * configured choices without one.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @param isClosed - Whether the vote is finalized (ended, or 100% participation)
 * @returns One VoteResultsQuestion per poll question, in API order
 */
export function buildVoteResultsQuestions(results: VoteResultsResponse | null, isClosed: boolean): VoteResultsQuestion[] {
  if (!results?.poll_results?.length) {
    return [];
  }

  return results.poll_results.map((pollResult) => {
    // Sort a copy by configured position; unknown ids share the position after the last choice, so the stable sort
    // keeps them in payload order.
    const choices = pollResult.question.choices ?? [];
    const choiceById = new Map(choices.map((choice, index) => [choice.choice_id, { index, text: choice.choice_text }]));
    const choicePosition = (choiceId: string): number => choiceById.get(choiceId)?.index ?? choices.length;
    const choiceVotes = [...(pollResult.generic_choice_votes || [])].sort((a, b) => choicePosition(a.choice_id) - choicePosition(b.choice_id));

    // Per-question choice-vote sum — drives the question model's totalVotes (zero-state detection), not percentages.
    const totalVotes = choiceVotes.reduce((sum, cv) => sum + cv.vote_count, 0);

    // Build options with vote counts from the results API
    const optionsWithCounts: VoteResultsOption[] = choiceVotes.map((cv) => ({
      choiceId: cv.choice_id,
      text: choiceById.get(cv.choice_id)?.text || cv.choice_id,
      voteCount: cv.vote_count,
      percentage: computeResultPercentage(cv.percentage, cv.vote_count, results.num_votes_cast || 0),
      isWinner: false,
      isTied: false,
      isLeading: false,
    }));

    // Determine winner/ties based on max votes
    const maxVotes = Math.max(...optionsWithCounts.map((o) => o.voteCount), 0);
    const optionsWithMaxVotes = optionsWithCounts.filter((o) => o.voteCount === maxVotes);
    const isTied = optionsWithMaxVotes.length > 1 && maxVotes > 0;

    const processedOptions = optionsWithCounts.map((option) => ({
      ...option,
      isWinner: isClosed && !isTied && option.voteCount === maxVotes && maxVotes > 0,
      isTied: isClosed && isTied && option.voteCount === maxVotes,
      isLeading: option.voteCount === maxVotes && maxVotes > 0,
    }));

    return {
      questionId: pollResult.question.question_id,
      question: pollResult.question.prompt,
      options: processedOptions,
      totalVotes,
    };
  });
}

/**
 * Builds the ranked-choice per-question view model from the results API payload
 * @description Choice text comes from the question's own choices. `ranked_choice_winner_info.poll_choices` holds only
 * the winning choices, so it only fills ids the question does not list, and the id is the last resort. The outcome and
 * winner labels follow the server-computed winners; Condorcet returning every candidate means no winner. Condorcet standings are ordered
 * by matrix head-to-head wins; runoff and Meek STV standings put server winners first and use round summaries for
 * elimination and election order. An unrecognized `pollType` yields no outcome.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @param pollType - The vote's poll type, which selects the counting method's outcome and standings rules
 * @returns One RankedQuestionView per poll question, in API order
 */
export function buildRankedQuestionViews(results: VoteResultsResponse | null, pollType: PollType | string | null | undefined): RankedQuestionView[] {
  if (!results?.poll_results?.length) return [];

  return results.poll_results.map((pr) => {
    const questionChoices = pr.question.choices ?? [];
    const winnerChoices = pr.ranked_choice_winner_info?.poll_choices ?? [];
    const choiceTextById = new Map(questionChoices.map((c) => [c.choice_id, c.choice_text]));
    for (const choice of winnerChoices) {
      if (!choiceTextById.has(choice.choice_id)) choiceTextById.set(choice.choice_id, choice.choice_text);
    }
    const textOf = (choiceId: string): string => choiceTextById.get(choiceId) || choiceId;

    const rankedVotes = pr.ranked_choice_votes ?? [];
    const choiceDistributions = rankedVotes.map((rcv) => {
      const totalRanked = rcv.rank_counts.reduce((sum, rc) => sum + rc.count, 0);
      const rankCounts = rcv.rank_counts.map((rc) => ({
        rank: rc.rank,
        count: rc.count,
        percentage: totalRanked > 0 ? Math.round((rc.count / totalRanked) * 100) : 0,
      }));
      return {
        choiceId: rcv.choice_id,
        choiceText: textOf(rcv.choice_id),
        totalRanked,
        rankCounts,
      };
    });

    const view = { questionId: pr.question.question_id, prompt: pr.question.prompt, choiceDistributions };
    const outcome = rankedVotes.length > 0 ? buildRankedOutcome(pr, pollType, textOf) : null;
    if (!outcome) return { ...view, outcome: null, standings: [] };

    // Candidates in ballot order (the question's configured order; unlisted ids keep payload order), plus any winner
    // the ranked votes do not carry, so a winner always gets a row.
    const position = new Map(questionChoices.map((c, index) => [c.choice_id, index]));
    const isCondorcet = pollType === PollType.CONDORCET_IRV;
    const configuredIds = isCondorcet ? questionChoices.map((choice) => choice.choice_id) : [];
    const candidateIds = [...new Set([...configuredIds, ...rankedVotes.map((rcv) => rcv.choice_id), ...winnerChoices.map((c) => c.choice_id)])].sort(
      (a, b) => (position.get(a) ?? questionChoices.length) - (position.get(b) ?? questionChoices.length)
    );
    const winnerIds = isCondorcet && outcome.result === 'none' ? [] : [...new Set(winnerChoices.map((c) => c.choice_id))];

    let standings: RankedStanding[];
    if (outcome.kind === 'meek_stv') {
      standings = buildMeekStvStandings(candidateIds, winnerIds, pr.meek_stv_round_summary ?? [], textOf);
    } else {
      const headToHead = isCondorcet ? { wins: countCondorcetWins(rankedVotes), total: candidateIds.length - 1 } : null;
      standings =
        outcome.kind === 'condorcet' && headToHead
          ? buildCondorcetStandings(candidateIds, winnerIds, headToHead, textOf)
          : buildIrvStandings(
              candidateIds,
              winnerIds,
              pr.irv_round_summary ?? [],
              headToHead,
              textOf,
              isCondorcet && outcome.result === 'none',
              isCondorcet ? buildCondorcetSurvivorTiebreaker(rankedVotes) : null
            );
    }

    return { ...view, outcome, standings };
  });
}

/**
 * Credits each matrix row's own choice with one head-to-head win per strictly winning pairing
 * @description Mirrors legacy PCC: only the row side is credited, so a matrix missing a pair's reverse entry undercounts
 * the opponent rather than double-counting.
 */
function countCondorcetWins(rankedVotes: RankedChoiceVoteResult[]): Map<string, number> {
  const wins = new Map<string, number>();
  for (const rcv of rankedVotes) {
    for (const entry of rcv.condorcet_matrix ?? []) {
      if (entry.choice_id_wins > entry.other_choice_id_wins) {
        wins.set(entry.choice_id, (wins.get(entry.choice_id) ?? 0) + 1);
      }
    }
  }
  return wins;
}

/** Winner, Tied or no label for a choice, from the server-computed winners. */
function winnerLabel(choiceId: string, winnerIds: string[]): RankedStanding['label'] {
  if (!winnerIds.includes(choiceId)) return null;
  return winnerIds.length > 1 ? 'tied' : 'winner';
}

/**
 * Condorcet standings: head-to-head wins descending with competition ranking (1, 1, 3); equal wins keep ballot order.
 */
function buildCondorcetStandings(
  candidateIds: string[],
  winnerIds: string[],
  headToHead: { wins: Map<string, number>; total: number },
  textOf: (choiceId: string) => string
): RankedStanding[] {
  const winsOf = (choiceId: string): number => headToHead.wins.get(choiceId) ?? 0;
  const sorted = [...candidateIds].sort((a, b) => winsOf(b) - winsOf(a));

  let rank = 1;
  return sorted.map((choiceId, index) => {
    if (index > 0 && winsOf(choiceId) < winsOf(sorted[index - 1])) rank = index + 1;
    return {
      choiceId,
      choiceText: textOf(choiceId),
      rank,
      label: winnerLabel(choiceId, winnerIds),
      round: null,
      headToHeadWins: winsOf(choiceId),
      headToHeadTotal: headToHead.total,
    };
  });
}

/** A ranked answer's preferences in rank order — nonempty `ranked_user_choice`, else `user_choice`; unranked entries keep their order. */
export function rankedAnswerChoices(answer: IndexedPollAnswer): UserChoice[] {
  const choices = answer.ranked_user_choice?.length ? answer.ranked_user_choice : (answer.user_choice ?? []);
  return choices
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => (a.choice.choice_rank ?? a.index + 1) - (b.choice.choice_rank ?? b.index + 1))
    .map(({ choice }) => choice);
}

/**
 * Instant-runoff standings, mirroring legacy PCC: winners at rank 1, then survivors by final-round votes with sequential
 * ranks, then eliminated choices in reverse elimination order. Without rounds, winners take rank 1 and the rest share
 * the next rank. Condorcet-IRV adds head-to-head counts and a pairwise survivor tiebreaker; its no-winner survivors share first place.
 */
function buildIrvStandings(
  candidateIds: string[],
  winnerIds: string[],
  rounds: IrvRoundSummary[],
  headToHead: { wins: Map<string, number>; total: number } | null,
  textOf: (choiceId: string) => string,
  shareSurvivorRank = false,
  survivorTiebreaker: ((a: string, b: string) => number) | null = null
): RankedStanding[] {
  const row = (choiceId: string, rank: number, label: RankedStanding['label'], round: number | null): RankedStanding => ({
    choiceId,
    choiceText: textOf(choiceId),
    rank,
    label,
    round,
    headToHeadWins: headToHead ? (headToHead.wins.get(choiceId) ?? 0) : null,
    headToHeadTotal: headToHead ? headToHead.total : null,
  });

  const winners = candidateIds.filter((choiceId) => winnerIds.includes(choiceId));
  const winnerRows = winners.map((choiceId) => row(choiceId, 1, winnerLabel(choiceId, winnerIds), null));
  const others = candidateIds.filter((choiceId) => !winnerIds.includes(choiceId));

  const orderedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);
  if (orderedRounds.length === 0) {
    const sharedRank = winners.length + 1;
    return [...winnerRows, ...others.map((choiceId) => row(choiceId, sharedRank, null, null))];
  }

  // First round each choice was eliminated in.
  const eliminatedRound = new Map<string, number>();
  for (const round of orderedRounds) {
    if (round.eliminated_choice_id && !eliminatedRound.has(round.eliminated_choice_id)) {
      eliminatedRound.set(round.eliminated_choice_id, round.round_number);
    }
  }

  const finalVotes = new Map(orderedRounds[orderedRounds.length - 1].votes.map((v) => [v.choice_id, v.vote_count]));
  const survivors = others.filter((choiceId) => !eliminatedRound.has(choiceId));
  if (!shareSurvivorRank) {
    survivors.sort((a, b) => {
      const byVotes = (finalVotes.get(b) ?? 0) - (finalVotes.get(a) ?? 0);
      return byVotes || survivorTiebreaker?.(a, b) || 0;
    });
  }
  const eliminated = others.filter((choiceId) => eliminatedRound.has(choiceId)).sort((a, b) => (eliminatedRound.get(b) ?? 0) - (eliminatedRound.get(a) ?? 0));

  const startRank = winners.length + 1;
  return [
    ...winnerRows,
    ...survivors.map((choiceId, index) => row(choiceId, startRank + (shareSurvivorRank ? 0 : index), shareSurvivorRank ? null : 'survivor', null)),
    ...eliminated.map((choiceId, index) => row(choiceId, startRank + survivors.length + index, 'eliminated', eliminatedRound.get(choiceId) ?? null)),
  ];
}

/**
 * Meek STV standings: elected seats ranked 1..k in the round each was first elected (unknown rounds last, in winner
 * order), then every other choice in ballot order, sharing rank k+1.
 */
function buildMeekStvStandings(
  candidateIds: string[],
  winnerIds: string[],
  rounds: MeekStvRoundSummary[],
  textOf: (choiceId: string) => string
): RankedStanding[] {
  const electedRound = new Map<string, number>();
  for (const round of [...rounds].sort((a, b) => a.round_number - b.round_number)) {
    for (const elected of round.elected_choices ?? []) {
      if (!electedRound.has(elected.choice_id)) electedRound.set(elected.choice_id, round.round_number);
    }
  }

  const roundOf = (choiceId: string): number => electedRound.get(choiceId) ?? Number.POSITIVE_INFINITY;
  const elected = [...winnerIds].sort((a, b) => roundOf(a) - roundOf(b));
  const notElectedRank = elected.length + 1;
  const base = { headToHeadWins: null, headToHeadTotal: null };

  return [
    ...elected.map((choiceId, index) => ({
      ...base,
      choiceId,
      choiceText: textOf(choiceId),
      rank: index + 1,
      label: 'elected' as const,
      round: electedRound.get(choiceId) ?? null,
    })),
    ...candidateIds
      .filter((choiceId) => !winnerIds.includes(choiceId))
      .map((choiceId) => ({ ...base, choiceId, choiceText: textOf(choiceId), rank: notElectedRank, label: 'not_elected' as const, round: null })),
  ];
}

/**
 * Final outcome of a ranked question from the server-computed winners
 * @description Condorcet-IRV is a `condorcet` outcome unless it fell back to eliminations, which makes it `irv`. One
 * winner is `winner`, a partial Condorcet set is a `tie`, every candidate is `none`; other methods keep their winner rules. Returns null for a
 * poll type that is not ranked.
 */
function buildRankedOutcome(
  pr: PollQuestionResult,
  pollType: PollType | string | null | undefined,
  textOf: (choiceId: string) => string
): RankedOutcome | null {
  const winnerIds = [...new Set((pr.ranked_choice_winner_info?.poll_choices ?? []).map((c) => c.choice_id))];
  const winnerTexts = winnerIds.map(textOf);

  if (pollType === PollType.MEEK_STV) {
    const roundCount = pr.meek_stv_round_summary?.length ?? 0;
    return { kind: 'meek_stv', result: winnerIds.length > 0 ? 'winner' : 'none', winnerTexts, roundCount, condorcetFallback: false };
  }

  let result: RankedOutcome['result'] = 'none';
  if (winnerIds.length === 1) result = 'winner';
  else if (winnerIds.length > 1) result = 'tie';
  const roundCount = pr.irv_round_summary?.length ?? 0;

  if (pollType === PollType.INSTANT_RUNOFF_VOTE) {
    return { kind: 'irv', result, winnerTexts, roundCount, condorcetFallback: false };
  }
  if (pollType === PollType.CONDORCET_IRV) {
    const usedEliminations = pr.ranked_choice_winner_info?.condorcet_irv_used_for_eliminations === true;
    const candidateCount = new Set([
      ...(pr.question.choices ?? []).map((choice) => choice.choice_id),
      ...(pr.ranked_choice_votes ?? []).map((choice) => choice.choice_id),
      ...winnerIds,
    ]).size;
    const outcome = resolveCondorcetOutcome(winnerIds.length, candidateCount, usedEliminations);
    if (outcome === CondorcetOutcome.NO_WINNER) result = 'none';
    else if (outcome === CondorcetOutcome.TIE) result = 'tie';
    else result = 'winner';
    const names = result === 'none' ? [] : winnerTexts;
    return usedEliminations
      ? { kind: 'irv', result, winnerTexts: names, roundCount, condorcetFallback: true }
      : { kind: 'condorcet', result, winnerTexts: names, roundCount: 0, condorcetFallback: false };
  }
  return null;
}

/**
 * Joins names as "a", "a and b" or "a, b and c"
 */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Builds the vote detail Overview outcome for an IRV or Meek STV question (#6124)
 * @description Mirrors the Results tab banner of `lfx-vote-ranked-question-results`, without repeating the names the Overview shows above. Standings
 * keep only the rows after the winners, capped to `VOTE_OVERVIEW_STANDINGS_LIMIT`.
 * @param view - A view from `buildRankedQuestionViews`
 * @returns The outcome, or null when the question has no final outcome
 */
export function buildRankedOverviewOutcome(view: RankedQuestionView): VoteOverviewOutcome | null {
  if (!view.outcome) return null;
  const runnersUp = view.standings
    .filter((row) => row.label !== 'winner' && row.label !== 'tied' && row.label !== 'elected')
    .map((row) => ({
      choiceId: row.choiceId,
      choiceText: row.choiceText,
      rank: row.rank,
      detail:
        row.label === 'not_elected'
          ? 'Not elected'
          : overviewStandingDetail(row.label === 'eliminated', row.round, row.headToHeadWins ?? 0, row.headToHeadTotal ?? 0),
    }));
  return buildOverviewOutcome(view.questionId, view.prompt, view.outcome, runnersUp);
}

/**
 * Assembles a vote detail Overview outcome (#6124) from a ranked outcome and its runner-up rows; shared by the ranked
 * and Condorcet IRV adapters so both use the same labels, explanations and standings cap.
 */
export function buildOverviewOutcome(questionId: string, prompt: string, outcome: RankedOutcome, runnersUp: VoteOverviewStanding[]): VoteOverviewOutcome {
  const standings = runnersUp.slice(0, VOTE_OVERVIEW_STANDINGS_LIMIT);
  return {
    questionId,
    prompt,
    result: outcome.result,
    label: overviewLabel(outcome),
    winnerTexts: outcome.result === 'none' ? [] : outcome.winnerTexts,
    explanation: overviewExplanation(outcome),
    standings,
    hiddenCount: runnersUp.length - standings.length,
  };
}

/**
 * Overview standings detail (#6124): "Eliminated in round N" (or "Eliminated") for an eliminated option, otherwise
 * "Won X out of Y possible head-to-head matchups" (the Results tab's wording) when head-to-head data exists, otherwise null.
 */
export function overviewStandingDetail(eliminated: boolean, round: number | null, headToHeadWins: number, headToHeadTotal: number): string | null {
  if (eliminated) return round !== null ? `Eliminated in round ${round}` : 'Eliminated';
  if (headToHeadTotal > 0) return `Won ${headToHeadWins} out of ${headToHeadTotal} possible head-to-head ${headToHeadTotal === 1 ? 'matchup' : 'matchups'}`;
  return null;
}

function overviewLabel(outcome: RankedOutcome): VoteOverviewOutcome['label'] {
  if (outcome.result === 'none') return 'No winner';
  if (outcome.kind === 'meek_stv') return 'Elected';
  if (outcome.result === 'tie') return 'Tied';
  return 'Winner';
}

/** How the outcome was decided, in the Results tab's words; null for no winner, whose names line already says so. */
function overviewExplanation(outcome: RankedOutcome): string | null {
  if (outcome.result === 'none') return null;
  if (outcome.kind === 'meek_stv') return `Elected ${VOTE_RANKED_OUTCOME_EXPLANATIONS.meekStv}`;
  if (outcome.result === 'tie') return VOTE_RANKED_OUTCOME_EXPLANATIONS.tie;
  if (outcome.kind === 'condorcet') return VOTE_RANKED_OUTCOME_EXPLANATIONS.condorcetWinner;
  if (outcome.condorcetFallback) return VOTE_RANKED_OUTCOME_EXPLANATIONS.condorcetIrvFallback;
  const majority =
    outcome.roundCount > 0
      ? VOTE_RANKED_OUTCOME_EXPLANATIONS.irvMajorityRound.replace('{round}', String(outcome.roundCount))
      : VOTE_RANKED_OUTCOME_EXPLANATIONS.irvMajority;
  return `Won ${majority}`;
}

/**
 * Builds the one-line-per-question results summary shown on the vote detail Overview
 * @description Generic and majority votes read the leader/tie markers from `questions` without declaring an elected
 * winner or inferring quorum/threshold rules. Ranked votes use the choice(s) with the most rank-1 votes; once a ranked
 * vote has ended with final results, the Overview shows its outcome from `buildRankedOverviewOutcome` or
 * `buildCondorcetOverviewOutcome` instead of this line (#6124). Abstentions are not part of the summary.
 * @param questions - Processed plurality questions from `buildVoteResultsQuestions`
 * @param rankedQuestions - Ranked views from `buildRankedQuestionViews`
 * @param isGeneric - Whether the vote renders the plurality layout (otherwise the ranked views are summarised)
 * @param isClosed - Whether the vote is finalized
 * @returns One VoteResultsSummaryLine per question, in API order
 */
export function buildVoteResultsSummary(
  questions: VoteResultsQuestion[],
  rankedQuestions: RankedQuestionView[],
  isGeneric: boolean,
  isClosed: boolean
): VoteResultsSummaryLine[] {
  if (!isGeneric) {
    return rankedQuestions.map((question) => {
      const firstChoiceCounts = question.choiceDistributions.map((row) => ({
        text: row.choiceText,
        count: row.rankCounts.find((rc) => rc.rank === 1)?.count ?? 0,
      }));
      const topCount = Math.max(...firstChoiceCounts.map((row) => row.count), 0);
      const leaders = firstChoiceCounts.filter((row) => row.count === topCount);

      let text = isClosed ? 'No rankings recorded' : 'No rankings recorded yet';
      if (topCount > 0 && leaders.length > 1) {
        text = `Most first choices: ${joinNames(leaders.map((row) => row.text))} (${topCount} ${topCount === 1 ? 'voter' : 'voters'} each)`;
      } else if (topCount > 0) {
        text = `Most first choices: ${leaders[0].text} (${topCount} ${topCount === 1 ? 'voter' : 'voters'})`;
      }

      return { questionId: question.questionId, question: question.prompt, text };
    });
  }

  return questions.map((question) => {
    const leaders = question.options.filter((option) => (isClosed ? option.isWinner || option.isTied : option.isLeading));
    const percentage = leaders.length > 0 ? Math.round(leaders[0].percentage) : 0;

    let text = 'No choices selected';
    if (question.totalVotes > 0 && leaders.length > 1) {
      text = `Tied: ${joinNames(leaders.map((option) => option.text))} (${percentage}% each)`;
    } else if (question.totalVotes > 0 && leaders.length === 1) {
      text = `${leaders[0].text} ${isClosed ? 'received the most votes' : 'leads'} with ${percentage}%`;
    }

    return { questionId: question.questionId, question: question.question, text };
  });
}

/** Fallback base is num_votes_cast (all responses cast) so a missing upstream percentage stays on the same denominator upstream uses — not the per-question choice-vote sum. */
export function computeResultPercentage(apiPercentage: number, voteCount: number, totalResponses: number): number {
  if (apiPercentage > 0) return apiPercentage;
  if (totalResponses <= 0) return 0;
  return Math.round((voteCount / totalResponses) * 100);
}

/**
 * Builds the relative path to a vote's canonical, lens-independent permalink page
 * (the vote detail page, `VoteDetailComponent`, mounted at `/votes/:id`).
 * Combine with `toAbsoluteUrl` for a shareable/copyable absolute URL.
 * @param voteUid - The vote uid
 * @returns The relative permalink path, e.g. `/votes/abc123`
 */
export function votePermalinkPath(voteUid: string): string {
  return `/votes/${encodeURIComponent(voteUid)}`;
}
