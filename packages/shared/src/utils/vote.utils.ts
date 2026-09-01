// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { addDays } from 'date-fns';
import { FormControl, type FormGroup } from '@angular/forms';
import { DRAFT_VOTE_DEFAULT_DURATION_DAYS, DRAFT_VOTE_PLACEHOLDER_QUESTION, VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '../constants/poll.constants';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { maxCodePointsValidator } from '../validators/max-code-points.validator';
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
  PollCommentPrompt,
  PollQuestion,
  QuestionFormValue,
  UpdateVoteRequest,
  Vote,
  VoteFormValue,
  VoteParticipationStats,
  VoteResultsResponse,
} from '../interfaces/poll.interface';

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

  return {
    title: vote.name,
    description: vote.description || '',
    committee,
    eligible_participants: mapFiltersToEligibility(vote.committee_filters),
    close_date: vote.end_time ? new Date(vote.end_time) : null,
    allow_abstain: vote.allow_abstain ?? false,
    questions: (vote.poll_questions?.filter((question) => !isDraftPlaceholderPollQuestion(question)) ?? []).map(mapApiQuestionToFormValue),
    commentPrompts: (vote.poll_comment_prompts ?? []).map(mapApiCommentPromptToFormValue),
  };
}

/**
 * Computes participation stats for the results drawer from the results API payload
 * @description Upstream (itx-service-voting) counts abstentions in `num_votes_cast` but excludes
 * them from per-choice tallies, so `abstainedVoters` is always a subset of `totalResponses` and
 * `abstainedRate` is their share of all responses cast (choice percentages use a different base).
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
  const participationRate = eligibleVoters > 0 ? Math.round((totalResponses / eligibleVoters) * 100) : 0;
  const abstainedRate = totalResponses > 0 ? Math.round((abstainedVoters / totalResponses) * 100) : 0;

  return { eligibleVoters, totalResponses, participationRate, abstainedVoters, abstainedRate };
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
    end_time: formValue.close_date ? formValue.close_date.toISOString() : '',
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
    end_time: formValue.close_date?.toISOString() ?? addDays(new Date(), DRAFT_VOTE_DEFAULT_DURATION_DAYS).toISOString(),
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
    end_time: formValue.close_date ? formValue.close_date.toISOString() : '',
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
    end_time: formValue.close_date?.toISOString() ?? addDays(new Date(), DRAFT_VOTE_DEFAULT_DURATION_DAYS).toISOString(),
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
