// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { addDays } from 'date-fns';
import { DRAFT_VOTE_DEFAULT_DURATION_DAYS, DRAFT_VOTE_PLACEHOLDER_QUESTION } from '../constants/poll.constants';
import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { CommitteeReference } from '../interfaces/committee.interface';
import { CreatePollQuestion, CreateVoteRequest, PollQuestion, QuestionFormValue, UpdateVoteRequest, Vote, VoteFormValue } from '../interfaces/poll.interface';

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
    questions: (vote.poll_questions?.filter((question) => !isDraftPlaceholderPollQuestion(question)) ?? []).map(mapApiQuestionToFormValue),
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
    poll_questions: formValue.questions.map(mapQuestionToApiFormat),
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
    poll_questions,
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
    poll_questions: formValue.questions.map(mapQuestionToApiFormat),
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
    poll_questions,
  };
}
