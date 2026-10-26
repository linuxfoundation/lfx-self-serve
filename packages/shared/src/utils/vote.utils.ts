// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { addDays } from 'date-fns';
import { FormControl, type FormGroup } from '@angular/forms';
import {
  CLONE_VOTE_DEFAULT_DURATION_DAYS,
  CLONE_VOTE_TITLE_PREFIX,
  DRAFT_VOTE_DEFAULT_DURATION_DAYS,
  DRAFT_VOTE_PLACEHOLDER_QUESTION,
  VOTE_COMMENT_RESPONSE_MAX_LENGTH,
  VOTE_DEFAULT_CLOSE_TIME,
  VOTE_TITLE_MAX_LENGTH,
} from '../constants/poll.constants';
import { LEGACY_VOTE_TIMEZONE } from '../constants/timezones.constants';
import {
  VOTE_VOTER_MAX_CHOICE_CHIPS,
  VOTE_VOTER_NOT_VOTED_LABELS,
  VOTE_VOTER_STATUS_FILTER_LABELS,
  VOTES_STATS_WINDOW_DAYS,
} from '../constants/vote.constants';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { IndexedVoteResponseStatus, PollStatus, PollType, VoteResponseStatus, VoteRowParticipationState, VoteVoterStatus } from '../enums/poll.enum';
import { maxCodePointsValidator } from '../validators/max-code-points.validator';
import { combineDateTime, formatTo12HourInTimezone, getUserTimezone, parseTime12Hour, toZonedDateCarrier, wallTimeExistsInTimezone } from './date-time.utils';
import { normalizePollStatus, sortCommentResponsesByRecency } from './poll.utils';
import { truncateToUtf16Units } from './string.utils';
import type { PaginatedResponse } from '../interfaces/api.interface';
import type { CommitteeReference } from '../interfaces/committee.interface';
import type {
  CommentPromptFormValue,
  CommentResponseFormData,
  CommentResponseInput,
  CreatePollCommentPrompt,
  CreatePollQuestion,
  CreateVoteRequest,
  CursorWalkOutcome,
  MyVoteResponse,
  MyVotesQuickFilter,
  PollAnswer,
  PollCommentPrompt,
  PollCommentResult,
  PollQuestion,
  QuestionFormValue,
  RankedQuestionView,
  UpdateVoteRequest,
  UserChoice,
  Vote,
  VoteBallotQuestionView,
  VoteFormValue,
  VoteParticipationStats,
  VoteResultsOption,
  VoteResultsQuestion,
  VoteResultsResponse,
  VoteRowParticipation,
  VoterResultsState,
  VoteVoter,
  VoteVoterChoiceFilterOption,
  VoteVoterChoiceSummary,
  VoteVoterRowView,
  VoteVoterStatusCounts,
} from '../interfaces/poll.interface';

/** Active votes with a deadline strictly after now and within the rolling seven-day window. */
export function isVoteClosingSoon(vote: Vote, nowMs: number): boolean {
  if (normalizePollStatus(vote.status) !== PollStatus.ACTIVE) return false;
  const endMs = Date.parse(vote.end_time);
  return Number.isFinite(endMs) && nowMs < endMs && endMs <= nowMs + VOTES_STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Matches the personal summary's status/response semantics at a shared time snapshot. */
export function matchesMyVotesQuickFilter(vote: Vote, filter: MyVotesQuickFilter, nowMs: number): boolean {
  if (filter === 'closing-soon') return isVoteClosingSoon(vote, nowMs);
  return normalizePollStatus(vote.status) === PollStatus.ACTIVE && vote.response_status === VoteResponseStatus.AWAITING_RESPONSE;
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
 * Maps UI eligibility value to API committee_filters
 * @param eligibility - The eligibility value from the form (e.g., 'voting_rep', 'voting_rep,alternate_voting_rep', 'all')
 * @returns Array of committee filter strings matching the API's expected title-case format
 */
export function mapEligibilityToFilters(eligibility: string): string[] {
  switch (eligibility) {
    case 'voting_rep':
      return [CommitteeMemberVotingStatus.VOTING_REP];
    case 'voting_rep,alternate_voting_rep':
      return [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP];
    case 'all':
      return [
        CommitteeMemberVotingStatus.VOTING_REP,
        CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP,
        CommitteeMemberVotingStatus.OBSERVER,
        CommitteeMemberVotingStatus.EMERITUS,
      ];
    default:
      return [CommitteeMemberVotingStatus.VOTING_REP];
  }
}

/**
 * Maps API committee_filters back to the form's eligible_participants value
 * @param filters - Array of committee filter strings from the API (title-case format)
 * @returns Form eligibility value ('voting_rep', 'voting_rep,alternate_voting_rep', or 'all')
 */
export function mapFiltersToEligibility(filters: string[] | undefined): string {
  if (!filters || filters.length === 0) {
    return 'voting_rep';
  }

  const hasObserver = filters.includes(CommitteeMemberVotingStatus.OBSERVER);
  const hasEmeritus = filters.includes(CommitteeMemberVotingStatus.EMERITUS);
  const hasAlternate = filters.includes(CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP);

  if (hasObserver || hasEmeritus) {
    return 'all';
  }
  if (hasAlternate) {
    return 'voting_rep,alternate_voting_rep';
  }
  return 'voting_rep';
}

// Exact match only — user content identical to our placeholder is treated as empty on re-open.
function isDraftPlaceholderPollQuestion(question: PollQuestion): boolean {
  const placeholder = DRAFT_VOTE_PLACEHOLDER_QUESTION;
  if (question.prompt.trim() !== placeholder.prompt || question.type !== placeholder.type) {
    return false;
  }

  const choiceTexts = question.choices.map((choice) => choice.choice_text.trim());
  const placeholderTexts = placeholder.choices.map((choice) => choice.choice_text);
  return choiceTexts.length === placeholderTexts.length && placeholderTexts.every((text, index) => choiceTexts[index] === text);
}

/**
 * Maps an API PollQuestion back to the form's QuestionFormValue
 * @param question - PollQuestion from the API response
 * @returns QuestionFormValue for the form
 */
export function mapApiQuestionToFormValue(question: PollQuestion): QuestionFormValue {
  return {
    question: question.prompt,
    response_type: question.type === 'single_choice' ? 'single' : 'multiple',
    options: question.choices.map((choice) => choice.choice_text),
  };
}

/**
 * Maps an API PollCommentPrompt back to the form's CommentPromptFormValue
 * @param prompt - PollCommentPrompt from the API response
 * @returns CommentPromptFormValue for the form
 */
export function mapApiCommentPromptToFormValue(prompt: PollCommentPrompt): CommentPromptFormValue {
  return {
    prompt: prompt.prompt,
  };
}

/**
 * Maps a Vote API response to a VoteFormValue for populating the edit form
 * @param vote - Vote entity from the API
 * @returns VoteFormValue to patch into the form
 */
export function mapVoteToFormValue(vote: Vote): VoteFormValue {
  const committee: CommitteeReference | null = vote.committee_uid ? { uid: vote.committee_uid, name: vote.committee_name } : null;
  // Legacy votes carry no stored zone — hydrate in Pacific, the canonical reading of their end_time.
  const zone = vote.end_time_timezone || LEGACY_VOTE_TIMEZONE;
  const endDate = vote.end_time ? new Date(vote.end_time) : null;

  return {
    title: vote.name,
    description: vote.description || '',
    committee,
    eligible_participants: mapFiltersToEligibility(vote.committee_filters),
    close_date: endDate ? toZonedDateCarrier(endDate, zone) : null,
    close_time: endDate ? formatTo12HourInTimezone(endDate, zone) : VOTE_DEFAULT_CLOSE_TIME,
    timezone: zone,
    allow_abstain: vote.allow_abstain ?? false,
    questions: (vote.poll_questions?.filter((question) => !isDraftPlaceholderPollQuestion(question)) ?? []).map(mapApiQuestionToFormValue),
    commentPrompts: (vote.poll_comment_prompts ?? []).map(mapApiCommentPromptToFormValue),
  };
}

/** Rounds participation against a positive electorate, capping incomplete counts at 99% and complete/excess counts at 100%. */
function computeParticipationPercent(responses: number, invited: number): number {
  return Math.min(responses < invited ? 99 : 100, Math.round((responses / invited) * 100));
}

/**
 * Maps a Vote API response to a VoteFormValue for prefilling the create form when cloning a vote
 * @description Same field set as {@link mapVoteToFormValue} (committee, eligibility, questions, comment
 * prompts, abstain) — cast ballots, results, and the source vote's status/uid are never part of a form
 * value, so there is nothing to strip there. Eligibility is lossy in the same direction it already is for
 * edit: {@link mapFiltersToEligibility} widens to 'all' whenever the filter set contains Observer or
 * Emeritus, so a clone can re-expand to a broader electorate than the source actually had. This is a
 * known, accepted tradeoff (not yet surfaced to the organizer) rather than an oversight — unlike the
 * poll-type/pseudo-anonymity guard below, which refuses to clone a source it can't faithfully represent,
 * electorate widening degrades silently. Revisit if this needs its own warning (GH-3781 review 3).
 * Two fields are deliberately mutated: the title gets a "Copy of " prefix (skipped if already present, and
 * clamped to VOTE_TITLE_MAX_LENGTH) so the organizer can tell the draft apart from the source vote, and a
 * deadline that has already elapsed resets to CLONE_VOTE_DEFAULT_DURATION_DAYS out in the organizer's own
 * timezone rather than the source's stored zone (a still-future deadline is reused as-is, in its own zone).
 * @param vote - The source Vote entity to clone
 * @param nowMs - Current time in epoch ms, injectable for deterministic tests (defaults to Date.now())
 * @param fallbackTimezone - Zone to reset an elapsed deadline into; defaults to `getUserTimezone()` for
 * non-Angular callers (e.g. tests), but an Angular caller that may run this during SSR must pass an
 * SSR-safe value explicitly (e.g. `isPlatformBrowser(platformId) ? getUserTimezone() : 'UTC'`), matching
 * the same pattern already used elsewhere in this app (votes-table, vote-cast-drawer, vote-results-drawer,
 * newsletter-list): the reset falls back to UTC on the server and is replaced by the real zone on client
 * hydration — this does not prevent a server/client difference, it just makes the server side
 * deterministic instead of resolving a second, possibly different, non-UTC zone there (GH-3781)
 * @returns VoteFormValue to patch into the create form
 */
export function mapVoteToCloneFormValue(vote: Vote, nowMs: number = Date.now(), fallbackTimezone: string = getUserTimezone()): VoteFormValue {
  const base = mapVoteToFormValue(vote);
  const title = base.title.startsWith(CLONE_VOTE_TITLE_PREFIX)
    ? base.title
    : truncateToUtf16Units(`${CLONE_VOTE_TITLE_PREFIX}${base.title}`, VOTE_TITLE_MAX_LENGTH);

  const endMs = vote.end_time ? Date.parse(vote.end_time) : NaN;
  const deadlineInFuture = Number.isFinite(endMs) && endMs > nowMs;
  if (deadlineInFuture) {
    return { ...base, title };
  }

  const timezone = fallbackTimezone;
  const resetDate = addDays(new Date(nowMs), CLONE_VOTE_DEFAULT_DURATION_DAYS);
  return {
    ...base,
    title,
    timezone,
    close_date: toZonedDateCarrier(resetDate, timezone),
    close_time: VOTE_DEFAULT_CLOSE_TIME,
  };
}

/**
 * Computes participation stats for the results drawer from the results API payload
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
 * Merges the vote detail's comment prompts with the results payload's comment responses
 * @description Prompts come from the vote detail (`poll_comment_prompts`), not the results payload — the results
 * endpoint only reports prompts that have responses, which would hide prompts on zero-response votes. Responses
 * left-join in by `prompt_id` when present, sorted newest-first (pagination slices the already-sorted list, so page 1
 * always shows the most recent comments). If the detail supplied no prompts (e.g. it failed and the list-vote
 * fallback lacks them), degrade to the results payload's prompts that have responses.
 * @param commentResults - `comment_results` from the results API
 * @param detailPrompts - `poll_comment_prompts` from the vote detail, when available
 * @returns One PollCommentResult per prompt, with responses sorted newest-first
 */
export function mergeCommentResults(commentResults: PollCommentResult[], detailPrompts: PollCommentPrompt[] | undefined): PollCommentResult[] {
  if (!detailPrompts?.length) {
    return commentResults.flatMap((cr) => (cr.responses.length > 0 ? [{ ...cr, responses: sortCommentResponsesByRecency(cr.responses) }] : []));
  }

  const resultsByPromptId = new Map(commentResults.map((cr) => [cr.prompt.prompt_id, cr]));

  return detailPrompts.map((prompt) => {
    const result = resultsByPromptId.get(prompt.prompt_id);
    return {
      prompt,
      responses: sortCommentResponsesByRecency(result?.responses ?? []),
      total_responses: result?.total_responses,
    };
  });
}

/** Fallback base is num_votes_cast (all responses cast) so a missing upstream percentage stays on the same denominator upstream uses — not the per-question choice-vote sum. */
function computeResultPercentage(apiPercentage: number, voteCount: number, totalResponses: number): number {
  if (apiPercentage > 0) return apiPercentage;
  if (totalResponses <= 0) return 0;
  return Math.round((voteCount / totalResponses) * 100);
}

/** A count is usable only when upstream sent a real non-negative number — strings/null/NaN are never coerced to 0. */
function isParticipationCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Computes the votes-table participation summary for one vote row
 * @description The denominator is the invited electorate (`total_voting_request_invitations`), not current group
 * membership. Upstream counts abstentions in `num_response_received`, matching `num_votes_cast` in the results drawer.
 * Drafts never show counts; missing counts degrade to UNAVAILABLE/COUNT_ONLY instead of a false zero; a zero electorate
 * never yields a percent. Use the same completion-aware rounding as the results drawer: incomplete counts cap at 99%,
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

/**
 * Maps form question to API poll question format
 * @param question - The question form value
 * @returns CreatePollQuestion for the API request
 */
export function mapQuestionToApiFormat(question: QuestionFormValue): CreatePollQuestion {
  return {
    prompt: question.question.trim(),
    type: question.response_type === 'single' ? 'single_choice' : 'multiple_choice',
    choices: question.options
      .map((option) => option.trim())
      .filter((option) => option !== '')
      .map((option) => ({ choice_text: option })),
  };
}

/**
 * Returns true when comment-prompt text is non-blank after trimming.
 * Shared by the submit-side mapper and the review-step display so the two cannot drift.
 */
export function isNonBlankCommentPrompt(text?: string | null): boolean {
  return (text?.trim().length ?? 0) > 0;
}

/**
 * Maps the form's comment-prompt array to the API's poll_comment_prompts, dropping blanks
 * @param commentPrompts - Comment prompt form values
 * @returns poll_comment_prompts for the API request, or undefined when there are none to send
 */
export function mapCommentPromptsToApiFormat(commentPrompts: CommentPromptFormValue[]): CreatePollCommentPrompt[] | undefined {
  const nonBlank: CreatePollCommentPrompt[] = (commentPrompts ?? [])
    .filter((commentPrompt) => isNonBlankCommentPrompt(commentPrompt.prompt))
    .map((commentPrompt) => ({ prompt: commentPrompt.prompt.trim() }));

  return nonBlank.length > 0 ? nonBlank : undefined;
}

/** Reconciles a ballot comment form against the vote's prompts, keyed by prompt_id.
 *  Uses { emitEvent: false } — callers bump their form-version signal after calling. */
export function reconcileCommentFormControls(commentForm: FormGroup, prompts: PollCommentPrompt[]): void {
  const desiredIds = new Set(prompts.map((prompt) => prompt.prompt_id));
  for (const existingId of Object.keys(commentForm.controls)) {
    if (!desiredIds.has(existingId)) commentForm.removeControl(existingId, { emitEvent: false });
  }
  for (const prompt of prompts) {
    if (commentForm.contains(prompt.prompt_id)) continue;
    commentForm.addControl(
      prompt.prompt_id,
      new FormControl('', { nonNullable: true, validators: [maxCodePointsValidator(VOTE_COMMENT_RESPONSE_MAX_LENGTH)] }),
      { emitEvent: false }
    );
  }
}

/** Pairs each prompt with its response control for template iteration, dropping prompts whose
 *  control is missing — a computed can evaluate before the reconcile pass adds controls. */
export function getCommentPromptsData(commentForm: FormGroup, prompts: PollCommentPrompt[]): CommentResponseFormData[] {
  return prompts
    .map((prompt) => ({ prompt, control: commentForm.get(prompt.prompt_id) as FormControl<string> | null }))
    .filter((data): data is CommentResponseFormData => data.control !== null);
}

/** Builds comment_responses from ballot form data, omitting empty/whitespace-only responses so a skipped optional prompt sends nothing. */
export function buildCommentResponses(commentPromptsData: CommentResponseFormData[]): CommentResponseInput[] | undefined {
  const responses = commentPromptsData
    .map((data) => ({ prompt_id: data.prompt.prompt_id, comment_text: (data.control.value ?? '').trim() }))
    .filter((response) => response.comment_text.length > 0);
  return responses.length > 0 ? responses : undefined;
}

const DRAFT_OPTION_PAD_LABELS = DRAFT_VOTE_PLACEHOLDER_QUESTION.choices.map((choice) => choice.choice_text);

function hasDraftQuestionInput(question: QuestionFormValue): boolean {
  const hasPrompt = (question.question?.trim().length ?? 0) > 0;
  const hasOption = (question.options ?? []).some((option) => (option?.trim().length ?? 0) > 0);
  return hasPrompt || hasOption;
}

/** Preserves in-progress draft work by padding missing prompt/options instead of dropping partial questions. */
function normalizeDraftQuestion(question: QuestionFormValue): CreatePollQuestion {
  const trimmedPrompt = question.question?.trim() ?? '';
  const nonEmptyOptions = (question.options ?? []).map((option) => option?.trim() ?? '').filter((option) => option !== '');
  const paddedOptions = [...nonEmptyOptions];

  while (paddedOptions.length < 2) {
    const nextPad = DRAFT_OPTION_PAD_LABELS.find((label) => !paddedOptions.includes(label))!;
    paddedOptions.push(nextPad);
  }

  return {
    prompt: trimmedPrompt.length > 0 ? trimmedPrompt : DRAFT_VOTE_PLACEHOLDER_QUESTION.prompt,
    type: question.response_type === 'single' ? 'single_choice' : 'multiple_choice',
    choices: paddedOptions.map((option) => ({ choice_text: option })),
  };
}

function prepareDraftQuestions(questions: QuestionFormValue[]): CreatePollQuestion[] {
  return questions.filter(hasDraftQuestionInput).map(normalizeDraftQuestion);
}

/** Draft end_time: the combined deadline when date+time combine cleanly, else the default-duration fallback — never an empty required field. */
function resolveDraftEndTime(formValue: VoteFormValue): string {
  // Drafts bypass form validators, so re-check what validTimeFormat() enforces before combining:
  // an out-of-range time like '25:99 PM' would be Date-normalized rather than rejected, and an empty
  // zone would be combined as browser-local then reopened as legacy Pacific (end_time_timezone omitted).
  // wallTimeExistsInTimezone mirrors voteDeadlineValidator: a spring-forward gap wall time would
  // otherwise be normalized ~1h off the organizer's selection and persisted silently.
  const { close_date: closeDate, close_time: closeTime, timezone } = formValue;
  const canCombine = !!closeDate && !!timezone && parseTime12Hour(closeTime) !== null && wallTimeExistsInTimezone(closeDate, closeTime, timezone);
  const combined = canCombine ? combineDateTime(closeDate, closeTime, timezone) : '';
  return combined || addDays(new Date(), DRAFT_VOTE_DEFAULT_DURATION_DAYS).toISOString();
}

/** Draft end_time_timezone: the picked zone, else the legacy-zone fallback so the upstream-required field is never empty. */
function resolveDraftEndTimeTimezone(formValue: VoteFormValue): string {
  return formValue.timezone || LEGACY_VOTE_TIMEZONE;
}

/**
 * Builds a CreateVoteRequest from form values
 * @param formValue - The vote form values
 * @param projectUid - The project UID from context
 * @returns CreateVoteRequest for the API
 */
export function buildCreateVoteRequest(formValue: VoteFormValue, projectUid: string): CreateVoteRequest {
  return {
    name: formValue.title.trim(),
    description: formValue.description?.trim() || '',
    end_time: formValue.close_date ? combineDateTime(formValue.close_date, formValue.close_time, formValue.timezone) : '',
    end_time_timezone: formValue.timezone,
    project_uid: projectUid,
    committee_uid: formValue.committee?.uid || '',
    committee_filters: mapEligibilityToFilters(formValue.eligible_participants),
    allow_abstain: formValue.allow_abstain,
    poll_questions: formValue.questions.map(mapQuestionToApiFormat),
    poll_comment_prompts: mapCommentPromptsToApiFormat(formValue.commentPrompts),
  };
}

/** Fills upstream-required fields with sensible defaults so a partial form can be saved as a draft. */
export function buildDraftVoteRequest(formValue: VoteFormValue, projectUid: string): CreateVoteRequest {
  const preparedQuestions = prepareDraftQuestions(formValue.questions);
  const poll_questions: CreatePollQuestion[] = preparedQuestions.length > 0 ? preparedQuestions : [DRAFT_VOTE_PLACEHOLDER_QUESTION];

  return {
    name: formValue.title.trim(),
    description: formValue.description?.trim() || '',
    end_time: resolveDraftEndTime(formValue),
    end_time_timezone: resolveDraftEndTimeTimezone(formValue),
    project_uid: projectUid,
    committee_uid: formValue.committee?.uid || '',
    committee_filters: mapEligibilityToFilters(formValue.eligible_participants),
    allow_abstain: formValue.allow_abstain,
    poll_questions,
    poll_comment_prompts: mapCommentPromptsToApiFormat(formValue.commentPrompts),
  };
}

/**
 * Builds an UpdateVoteRequest from form values
 * @param formValue - The vote form values
 * @param projectUid - The project UID from context
 * @returns UpdateVoteRequest for the PUT API endpoint
 */
export function buildUpdateVoteRequest(formValue: VoteFormValue, projectUid: string): UpdateVoteRequest {
  return {
    name: formValue.title.trim(),
    description: formValue.description?.trim() || '',
    end_time: formValue.close_date ? combineDateTime(formValue.close_date, formValue.close_time, formValue.timezone) : '',
    end_time_timezone: formValue.timezone,
    project_uid: projectUid,
    committee_uid: formValue.committee?.uid || '',
    committee_filters: mapEligibilityToFilters(formValue.eligible_participants),
    allow_abstain: formValue.allow_abstain,
    poll_questions: formValue.questions.map(mapQuestionToApiFormat),
    poll_comment_prompts: mapCommentPromptsToApiFormat(formValue.commentPrompts),
  };
}

/** Update-mode counterpart to buildDraftVoteRequest — fills upstream-required fields when the user clears them while editing an existing draft. */
export function buildDraftUpdateVoteRequest(formValue: VoteFormValue, projectUid: string): UpdateVoteRequest {
  const preparedQuestions = prepareDraftQuestions(formValue.questions);
  const poll_questions: CreatePollQuestion[] = preparedQuestions.length > 0 ? preparedQuestions : [DRAFT_VOTE_PLACEHOLDER_QUESTION];

  return {
    name: formValue.title.trim(),
    description: formValue.description?.trim() || '',
    end_time: resolveDraftEndTime(formValue),
    end_time_timezone: resolveDraftEndTimeTimezone(formValue),
    project_uid: projectUid,
    committee_uid: formValue.committee?.uid || '',
    committee_filters: mapEligibilityToFilters(formValue.eligible_participants),
    allow_abstain: formValue.allow_abstain,
    poll_questions,
    poll_comment_prompts: mapCommentPromptsToApiFormat(formValue.commentPrompts),
  };
}

/**
 * Records a page's cursor in the token chain, preserving the invariant that index `i` holds the token for page `i + 1`
 * @description When the fetched page has a next token, stores it at `pageTokens[fetchedIndex]`; when the cursor is
 * exhausted (no next token), truncates the chain so stale tokens for pages beyond `fetchedIndex` are dropped.
 * Returns a new array rather than mutating in place.
 * @param pageTokens - Current cached cursor chain
 * @param fetchedIndex - Index of the page whose response produced (or lacked) the token
 * @param pageToken - Next-page cursor from the response, or undefined when the cursor is exhausted
 * @returns The updated token chain
 */
export function recordPageToken(pageTokens: readonly string[], fetchedIndex: number, pageToken: string | undefined): string[] {
  if (pageToken) {
    const next = pageTokens.slice();
    next[fetchedIndex] = pageToken;
    return next;
  }
  return pageTokens.slice(0, fetchedIndex);
}

/**
 * Finds the nearest page fetchable directly from the cached cursor chain
 * @description Cursor pagination only returns the *next* page's token, so page 0 needs no token and page `p`
 * needs `pageTokens[p - 1]` (index `i` holds the token for page `i + 1`). Scans back from the target and
 * returns the closest page whose token is cached, or 0 when none is.
 * @param pageTokens - Cached cursor chain (index `i` = token for page `i + 1`)
 * @param pageIndex - Target page the paginator wants
 * @returns Page index to start the forward walk from
 */
export function findCursorWalkStartIndex(pageTokens: readonly string[], pageIndex: number): number {
  for (let i = pageIndex; i > 0; i--) {
    if (pageTokens[i - 1]) {
      return i;
    }
  }
  return 0;
}

/**
 * Resolves the terminal action once a cursor walk stops (target reached, cursor exhausted, or request ceiling hit)
 * @description Pure decision for the page-jump walk: an empty target page with no next token or an exhausted cursor
 * both mean the data shrank after tokens were cached, so the walk restarts from page 1 with a fresh chain; a live
 * cursor short of the target means the ceiling truncated the walk, so the paginator clamps to the last fetched page.
 * @param response - Final page response emitted by the walk
 * @param fetchedIndex - Index of the last successfully fetched page
 * @param pageIndex - Target page the paginator wanted
 * @returns CursorWalkOutcome telling the caller to show, restart, or clamp
 */
export function resolveCursorWalkOutcome<T>(response: PaginatedResponse<T>, fetchedIndex: number, pageIndex: number): CursorWalkOutcome {
  const exhausted = !response.page_token;

  if (fetchedIndex === pageIndex) {
    if (pageIndex > 0 && exhausted && !response.data.length) {
      return { action: 'restart', refetch: true };
    }
    return { action: 'show' };
  }

  if (exhausted) {
    return { action: 'restart', refetch: fetchedIndex > 0 };
  }

  return { action: 'clamp', clampIndex: fetchedIndex };
}

/**
 * Canonical vote list ordering: active votes first, newest-created first within each tier
 * @description Shared by every vote list read (project/committee lists via the BFF's `getVotes`, and
 * Me-lens via `getMyVotes`) so all surfaces agree on one ordering (GH-1558). Tier 1: `status === ACTIVE`
 * before everything else (ended, disabled/draft) — normalized through `normalizePollStatus` first, since
 * `Vote.status` is not runtime-guaranteed to be canonically cased (poll.utils.ts). Tier 2: `creation_time`
 * descending — a missing or unparseable timestamp sorts as epoch 0, i.e. last within its tier. Remaining
 * ties break on `uid` ascending so offset pagination stays deterministic.
 * @param a - First vote
 * @param b - Second vote
 * @returns Negative when `a` sorts before `b`, positive when after, zero when equivalent
 */
export function compareVotesByRecency(a: Vote, b: Vote): number {
  // normalizePollStatus, not a raw comparison — Vote.status arrives with inconsistent casing
  // (poll.utils.ts's normalizePollStatus doc comment; committee-activity's mapVoteToEvent is the
  // prior catch). A case-variant 'ACTIVE' must not sink into the ended/draft tier.
  const tierA = normalizePollStatus(a.status) === PollStatus.ACTIVE ? 0 : 1;
  const tierB = normalizePollStatus(b.status) === PollStatus.ACTIVE ? 0 : 1;
  if (tierA !== tierB) {
    return tierA - tierB;
  }

  const createdA = a.creation_time ? Date.parse(a.creation_time) || 0 : 0;
  const createdB = b.creation_time ? Date.parse(b.creation_time) || 0 : 0;
  if (createdA !== createdB) {
    return createdB - createdA;
  }

  // Codepoint comparison, not localeCompare — this tiebreak exists to keep offset pagination
  // deterministic, and locale-aware collation is ICU-build-dependent, so two server instances on
  // different Node builds could order equal-timestamp votes differently mid-pagination
  // (committee-activity's compareEventsDesc precedent).
  if (a.uid === b.uid) return 0;
  return a.uid < b.uid ? -1 : 1;
}

/**
 * Builds the relative path to a vote's canonical, lens-independent permalink page
 * (`VotePermalinkComponent`, mounted at `/votes/:id`).
 * Combine with `toAbsoluteUrl` for a shareable/copyable absolute URL.
 * @param voteUid - The vote uid
 * @returns The relative permalink path, e.g. `/votes/abc123`
 */
export function votePermalinkPath(voteUid: string): string {
  return `/votes/${encodeURIComponent(voteUid)}`;
}

/**
 * Voter-side results panel for a viewer without write access — the single copy of the rules the results drawer and the
 * vote detail page share. A removed voter is `access_denied`; a settled, error-free, empty my-response is a viewer who was
 * never invited (`not_participant`), so a deep link to a closed vote can never route a stranger to final results. A failed
 * my-response call must not collapse into `not_participant` — callers render their error state for it instead.
 * @param vote - The loaded vote, or null while loading
 * @param myResponse - The viewer's vote_response row (null when absent or not loaded yet)
 * @param myResponseLoading - Whether the my-response request is still in flight
 * @param myResponseError - Whether the last my-response request failed (non-404)
 * @param listResponseStatus - `response_status` decorated on the list row the caller opened from, if any (wins over the vote's own)
 */
export function resolveVoterResultsState(
  vote: Vote | null,
  myResponse: MyVoteResponse | null,
  myResponseLoading: boolean,
  myResponseError: boolean,
  listResponseStatus?: VoteResponseStatus
): VoterResultsState {
  if (!vote) return 'not_voted';
  if (myResponse?.voter_removed) return 'access_denied';
  if (!myResponseLoading && !myResponseError && !myResponse) return 'not_participant';
  const decoratedResponseStatus = listResponseStatus ?? vote.response_status;
  const submitted = myResponse?.vote_status === IndexedVoteResponseStatus.RESPONDED || decoratedResponseStatus === VoteResponseStatus.RESPONDED;
  if (normalizePollStatus(vote.status) === PollStatus.ENDED) return 'closed';
  if (submitted) return 'submitted';
  return 'not_voted';
}

/**
 * Whether a viewer without write access may request a vote's results: only after it ended, and only with a settled,
 * successful my-response row for this same vote that wasn't removed. Every input is checked against `voteId` so a stale
 * vote or response from the previously opened vote can never authorize the next vote's request.
 * @param voteId - The vote the caller is about to fetch results for
 * @param vote - The loaded vote
 * @param myResponse - The viewer's vote_response row
 * @param myResponseLoading - Whether the my-response request is still in flight
 * @param myResponseError - Whether the last my-response request failed (non-404)
 */
export function canVoterFetchVoteResults(
  voteId: string,
  vote: Vote | null,
  myResponse: MyVoteResponse | null,
  myResponseLoading: boolean,
  myResponseError: boolean
): boolean {
  return (
    vote?.uid === voteId &&
    normalizePollStatus(vote.status) === PollStatus.ENDED &&
    myResponse?.vote_uid === voteId &&
    !myResponse.voter_removed &&
    !myResponseLoading &&
    !myResponseError
  );
}

/**
 * Copy for the vote detail page's "Visibility at a glance" card — describes who sees what today (managers see live
 * totals and comments; voters see their own response, and totals and comments only after close), never a new rule.
 * @param audience - `creator` for a project or committee writer, `voter` for everyone else
 * @param pseudoAnonymous - The vote's `pseudo_anonymity` setting; missing metadata never promises access to individual ballots
 * @param isClosed - Whether the vote has ended. A draft is not closed.
 * @param ballotsAvailable - Whether the vote is open or ended, so managers can use the Voters tab now
 */
export function getVoteVisibilityRules(
  audience: 'voter' | 'creator',
  pseudoAnonymous: boolean | null | undefined,
  isClosed: boolean,
  ballotsAvailable = true
): string[] {
  const rules: string[] = [];
  if (audience === 'creator') {
    rules.push(
      isClosed ? 'As a manager, you can see the final totals and comments.' : 'As a manager, you can follow live totals and comments until the vote closes.'
    );
    rules.push(isClosed ? 'Invited voters now see the final totals and comments.' : 'Voters see only their own response until the vote closes.');
  } else {
    rules.push(
      isClosed ? 'Invited voters see the final totals and comments.' : 'You see only your own response. Totals and comments stay hidden until the vote closes.'
    );
  }
  // Only explicitly named votes permit individual ballots; missing privacy metadata fails closed.
  if (pseudoAnonymous !== false) {
    rules.push('No one sees how another voter voted on this page.');
  } else if (audience === 'creator') {
    rules.push(
      ballotsAvailable
        ? "You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots."
        : "Once voting opens, you can see each voter's ballot on the Voters tab. Voters can't see each other's ballots."
    );
  } else {
    rules.push("Vote managers can see each voter's ballot. Other voters can't see yours.");
  }
  if (pseudoAnonymous === undefined || pseudoAnonymous === null) {
    rules.push('Ballot privacy information is unavailable.');
  } else {
    rules.push(
      pseudoAnonymous
        ? 'Pseudo-anonymous ballot: results are shown without voter names.'
        : 'Named ballot: each ballot is recorded against the voter who cast it.'
    );
  }
  return rules;
}

/** Splits a Voters tab choice key (`<question_id>:<choice_id>`) at its first colon; null when malformed. */
function parseVoteVoterChoiceKey(choiceKey: string): { questionId: string; choiceId: string } | null {
  const separator = choiceKey.indexOf(':');
  if (separator <= 0 || separator === choiceKey.length - 1) return null;
  return { questionId: choiceKey.slice(0, separator), choiceId: choiceKey.slice(separator + 1) };
}

/** A ranked answer's preferences in rank order — `ranked_user_choice` when present, else `user_choice`; unranked entries keep their order. */
function rankedAnswerChoices(answer: PollAnswer): UserChoice[] {
  const choices = answer.ranked_user_choice?.length ? answer.ranked_user_choice : (answer.user_choice ?? []);
  return choices
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => (a.choice.choice_rank ?? a.index + 1) - (b.choice.choice_rank ?? b.index + 1))
    .map(({ choice }) => choice);
}

/** The voter's choices for one answer, in display order: ranked preferences for a ranked vote, selections otherwise. */
function answerChoices(vote: Pick<Vote, 'poll_type'>, answer: PollAnswer): UserChoice[] {
  return isRankedPollType(vote.poll_type) ? rankedAnswerChoices(answer) : (answer.user_choice ?? []);
}

/** The vote's questions, falling back to the voter's answers when the vote detail carries none. */
function voteVoterQuestions(vote: Pick<Vote, 'poll_questions'>, voter: Pick<VoteVoter, 'poll_answers'>): PollQuestion[] {
  if (vote.poll_questions?.length) return vote.poll_questions;
  return (voter.poll_answers ?? []).map((answer) => ({ question_id: answer.question_id, prompt: answer.prompt, type: answer.type, choices: [] }));
}

/**
 * Participation status of an invited voter (#3914)
 * @description The voter list endpoint derives the status (#3911); an unrecognized value reads as not voted, so a
 * row never claims a ballot the list can't show.
 */
export function getVoteVoterStatus(voter: Pick<VoteVoter, 'status'>): VoteVoterStatus {
  return Object.values(VoteVoterStatus).includes(voter.status) ? voter.status : VoteVoterStatus.NOT_VOTED;
}

/**
 * Builds the Choice cell of a Voters tab row (#3914): one summary per question, in question order
 * @description Choice text comes from the vote's questions when the choice still exists there, else from the ballot.
 * Single and multiple choice show up to two chips, ranked questions `<rank> <choice>` chips; the rest count as `+N`.
 * A voter who abstained or hasn't voted gets no summaries — the row shows their status instead.
 */
export function buildVoteVoterChoiceSummaries(vote: Pick<Vote, 'poll_type' | 'poll_questions'>, voter: VoteVoter): VoteVoterChoiceSummary[] {
  if (getVoteVoterStatus(voter) !== VoteVoterStatus.VOTED) return [];

  const ranked = isRankedPollType(vote.poll_type);
  const questions = voteVoterQuestions(vote, voter);
  const answersById = new Map((voter.poll_answers ?? []).map((answer) => [answer.question_id, answer]));

  return questions.map((question, index) => {
    const textById = new Map((question.choices ?? []).map((choice) => [choice.choice_id, choice.choice_text]));
    const answer = answersById.get(question.question_id);
    const choices = answer ? answerChoices(vote, answer) : [];
    const labels = choices.map((choice, position) => {
      const text = textById.get(choice.choice_id) ?? choice.choice_text;
      return ranked ? `${position + 1} ${text}` : text;
    });

    return {
      questionId: question.question_id,
      ...(questions.length > 1 && { questionLabel: `Q${index + 1}` }),
      ranked,
      chips: labels.slice(0, VOTE_VOTER_MAX_CHOICE_CHIPS),
      overflow: Math.max(labels.length - VOTE_VOTER_MAX_CHOICE_CHIPS, 0),
    };
  });
}

/**
 * Builds the Voters tab's Choice filter options (#3914) from the vote's questions
 * @description Keys are `<question_id>:<choice_id>`. Generic labels are the choice text, prefixed `Q<n>: ` when the
 * vote has several questions; ranked questions filter on the voter's first choice and read `First choice: <choice>`.
 */
export function buildVoteVoterChoiceFilterOptions(vote: Pick<Vote, 'poll_type' | 'poll_questions'>): VoteVoterChoiceFilterOption[] {
  const questions = vote.poll_questions ?? [];
  const ranked = isRankedPollType(vote.poll_type);

  return questions.flatMap((question, index) => {
    const prefix = questions.length > 1 ? `Q${index + 1}: ` : '';
    return (question.choices ?? []).map((choice) => ({
      label: `${prefix}${ranked ? 'First choice: ' : ''}${choice.choice_text}`,
      value: `${question.question_id}:${choice.choice_id}`,
    }));
  });
}

/**
 * Whether a voter's current ballot matches a Voters tab choice key (#3914)
 * @description Generic questions match any selected choice; ranked questions match the voter's rank-1 choice — the
 * same count the results' "View N voters" link shows. Only voted ballots match; a malformed key matches no one.
 */
export function matchesVoteVoterChoice(voter: VoteVoter, choiceKey: string, vote: Pick<Vote, 'poll_type'>): boolean {
  const key = parseVoteVoterChoiceKey(choiceKey);
  if (!key || getVoteVoterStatus(voter) !== VoteVoterStatus.VOTED) return false;

  const answer = voter.poll_answers?.find((candidate) => candidate.question_id === key.questionId);
  if (!answer) return false;
  if (isRankedPollType(vote.poll_type)) return rankedAnswerChoices(answer)[0]?.choice_id === key.choiceId;
  return (answer.user_choice ?? []).some((choice) => choice.choice_id === key.choiceId);
}

/**
 * Maps a voter from GET /api/votes/:uid/voters to its Voters tab row (#3914)
 * @description Role is the voting eligibility (`user_voting_status`), which decides who may vote; the committee role is
 * secondary text. The not-voted label follows the vote: "Did not vote" once it has ended, "Not voted yet" otherwise.
 */
export function buildVoteVoterRowView(vote: Pick<Vote, 'status' | 'poll_type' | 'poll_questions'>, voter: VoteVoter): VoteVoterRowView {
  const status = getVoteVoterStatus(voter);
  const isClosed = normalizePollStatus(vote.status) === PollStatus.ENDED;
  const notVotedLabel = isClosed ? VOTE_VOTER_NOT_VOTED_LABELS.closed : VOTE_VOTER_NOT_VOTED_LABELS.active;
  const statusLabel = status === VoteVoterStatus.NOT_VOTED ? notVotedLabel : VOTE_VOTER_STATUS_FILTER_LABELS[status];

  return {
    uid: voter.uid,
    displayName: voter.user_name?.trim() || voter.username?.trim() || voter.user_email?.trim() || 'Unknown voter',
    organization: voter.user_org_name || undefined,
    role: voter.user_voting_status || undefined,
    committeeRole: voter.user_role || undefined,
    status,
    statusLabel,
    choiceSummaries: buildVoteVoterChoiceSummaries(vote, voter),
    submittedAt: status === VoteVoterStatus.NOT_VOTED ? undefined : voter.submitted_at,
    hasBallot: status !== VoteVoterStatus.NOT_VOTED,
    voter,
  };
}

/**
 * Orders Voters tab rows for display (#3914)
 * @description While the vote is open, voters who haven't voted come first so a manager sees who to remind. Otherwise
 * rows follow the first question's choice order (a ranked vote's first choice), then abstentions, then non-voters.
 * Ties break on name. Returns a new array.
 */
export function sortVoteVotersForDisplay(rows: readonly VoteVoterRowView[], vote: Pick<Vote, 'status' | 'poll_type' | 'poll_questions'>): VoteVoterRowView[] {
  const byName = (a: VoteVoterRowView, b: VoteVoterRowView): number => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });

  if (normalizePollStatus(vote.status) === PollStatus.ACTIVE) {
    const notVotedFirst = (row: VoteVoterRowView): number => (row.status === VoteVoterStatus.NOT_VOTED ? 0 : 1);
    return [...rows].sort((a, b) => notVotedFirst(a) - notVotedFirst(b) || byName(a, b));
  }

  const firstQuestion = vote.poll_questions?.[0];
  const choiceOrder = new Map((firstQuestion?.choices ?? []).map((choice, index) => [choice.choice_id, index]));
  const unknownChoice = choiceOrder.size;
  const rank = (row: VoteVoterRowView): number => {
    if (row.status === VoteVoterStatus.ABSTAINED) return unknownChoice + 1;
    if (row.status === VoteVoterStatus.NOT_VOTED) return unknownChoice + 2;
    const answer = firstQuestion ? row.voter.poll_answers?.find((candidate) => candidate.question_id === firstQuestion.question_id) : undefined;
    const first = answer ? answerChoices(vote, answer)[0] : undefined;
    return first ? (choiceOrder.get(first.choice_id) ?? unknownChoice) : unknownChoice;
  };

  return [...rows].sort((a, b) => rank(a) - rank(b) || byName(a, b));
}

/** Counts Voters tab rows per status pill (#3914); `all` is every row. */
export function countVoteVotersByStatus(rows: readonly Pick<VoteVoterRowView, 'status'>[]): VoteVoterStatusCounts {
  const counts: VoteVoterStatusCounts = { all: rows.length, [VoteVoterStatus.VOTED]: 0, [VoteVoterStatus.ABSTAINED]: 0, [VoteVoterStatus.NOT_VOTED]: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/**
 * Builds the read-only ballot dialog's questions for one voter (#3914)
 * @description Generic questions list every choice with its selected state (single choice radio-style, the rest
 * checkbox-style); ranked questions list the voter's preferences in order, then the choices they left unranked.
 * Selected choices missing from the vote's questions are still shown, so a renamed or removed choice never hides part
 * of the ballot.
 */
export function buildVoteBallotQuestions(vote: Pick<Vote, 'poll_type' | 'poll_questions'>, voter: VoteVoter): VoteBallotQuestionView[] {
  const ranked = isRankedPollType(vote.poll_type);
  const answersById = new Map((voter.poll_answers ?? []).map((answer) => [answer.question_id, answer]));

  return voteVoterQuestions(vote, voter).map((question, index) => {
    const answer = answersById.get(question.question_id);
    const picked = answer ? answerChoices(vote, answer) : [];
    const pickedIds = new Set(picked.map((choice) => choice.choice_id));
    const questionChoices = question.choices ?? [];
    const textById = new Map(questionChoices.map((choice) => [choice.choice_id, choice.choice_text]));
    const orphaned = picked.filter((choice) => !textById.has(choice.choice_id));
    const allChoices = [...questionChoices, ...orphaned];

    return {
      questionId: question.question_id,
      number: index + 1,
      prompt: question.prompt || answer?.prompt || '',
      ranked,
      multiple: (answer?.type ?? question.type) === 'multiple_choice',
      choices: ranked ? [] : allChoices.map((choice) => ({ choiceId: choice.choice_id, text: choice.choice_text, selected: pickedIds.has(choice.choice_id) })),
      rankedChoices: ranked
        ? picked.map((choice, position) => ({
            choiceId: choice.choice_id,
            text: textById.get(choice.choice_id) ?? choice.choice_text,
            selected: true,
            rank: position + 1,
          }))
        : [],
      unrankedChoices: ranked
        ? questionChoices
            .filter((choice) => !pickedIds.has(choice.choice_id))
            .map((choice) => ({ choiceId: choice.choice_id, text: choice.choice_text, selected: false }))
        : [],
    };
  });
}
