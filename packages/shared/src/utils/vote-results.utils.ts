// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollType } from '../enums/poll.enum';
import type {
  RankedQuestionView,
  VoteParticipationStats,
  VoteResultsOption,
  VoteResultsQuestion,
  VoteResultsResponse,
  VoteResultsSummaryLine,
} from '../interfaces/poll.interface';
import { computeParticipationPercent } from './vote-participation.utils';

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
 * Builds the generic (plurality) per-question results view model from the results API payload
 * @description Choice percentages prefer the upstream value and fall back to `num_votes_cast` as the base. Winner and
 * tie markers are only set when `isClosed`; `isLeading` marks the top option(s) regardless of `isClosed`, and live
 * views use it for the highlight.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @param isClosed - Whether the vote is finalized (ended, or 100% participation)
 * @returns One VoteResultsQuestion per poll question, in API order
 */
export function buildVoteResultsQuestions(results: VoteResultsResponse | null, isClosed: boolean): VoteResultsQuestion[] {
  if (!results?.poll_results?.length) {
    return [];
  }

  return results.poll_results.map((pollResult) => {
    const choiceVotes = pollResult.generic_choice_votes || [];

    // Per-question choice-vote sum — drives the question model's totalVotes (zero-state detection), not percentages.
    const totalVotes = choiceVotes.reduce((sum, cv) => sum + cv.vote_count, 0);

    // Build options with vote counts from the results API
    const optionsWithCounts: VoteResultsOption[] = choiceVotes.map((cv) => ({
      choiceId: cv.choice_id,
      text: pollResult.question.choices.find((c) => c.choice_id === cv.choice_id)?.choice_text || cv.choice_id,
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
 * @description The round-summary payload is untyped upstream, so only its presence is surfaced (`hasRoundSummary`);
 * detailed round visualization is deferred to a placeholder banner.
 * @param results - VoteResultsResponse from the results API, or null when not yet loaded
 * @returns One RankedQuestionView per poll question, in API order
 */
export function buildRankedQuestionViews(results: VoteResultsResponse | null): RankedQuestionView[] {
  if (!results?.poll_results?.length) return [];

  return results.poll_results.map((pr) => {
    // Choice text: prefer winner_info.poll_choices, fall back to question.choices.
    const choiceTextById = new Map((pr.ranked_choice_winner_info?.poll_choices ?? pr.question.choices ?? []).map((c) => [c.choice_id, c.choice_text]));

    const choiceDistributions = (pr.ranked_choice_votes ?? []).map((rcv) => {
      const totalRanked = rcv.rank_counts.reduce((sum, rc) => sum + rc.count, 0);
      const rankCounts = rcv.rank_counts.map((rc) => ({
        rank: rc.rank,
        count: rc.count,
        percentage: totalRanked > 0 ? Math.round((rc.count / totalRanked) * 100) : 0,
      }));
      return {
        choiceId: rcv.choice_id,
        choiceText: choiceTextById.get(rcv.choice_id) ?? rcv.choice_id,
        totalRanked,
        rankCounts,
      };
    });

    return {
      questionId: pr.question.question_id,
      prompt: pr.question.prompt,
      choiceDistributions,
      hasRoundSummary: !!pr.irv_round_summary || !!pr.meek_stv_round_summary,
    };
  });
}

/**
 * Joins names as "a", "a and b" or "a, b and c"
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Builds the one-line-per-question results summary shown on the vote detail Overview
 * @description Generic and majority votes read the leader/tie markers from `questions` without declaring an elected
 * winner or inferring quorum/threshold rules. Ranked votes use the choice(s) with the most rank-1 votes. Abstentions are not part of the summary.
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
