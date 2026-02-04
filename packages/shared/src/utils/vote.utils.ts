// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatePollQuestion, CreateVoteRequest, QuestionFormValue, VoteFormValue } from '../interfaces/poll.interface';

/**
 * Maps UI eligibility value to API committee_filters
 * @param eligibility - The eligibility value from the form (e.g., 'voting_rep', 'voting_rep,alternate_voting_rep', 'all')
 * @returns Array of committee filter strings for the API (snake_case format)
 */
export function mapEligibilityToFilters(eligibility: string): string[] {
  switch (eligibility) {
    case 'voting_rep':
      return ['voting_rep'];
    case 'voting_rep,alternate_voting_rep':
      return ['voting_rep', 'alternate_voting_rep'];
    case 'all':
      return ['voting_rep', 'alternate_voting_rep', 'observer', 'emeritus'];
    default:
      return ['voting_rep'];
  }
}

/**
 * Maps form question to API poll question format
 * @param question - The question form value
 * @returns CreatePollQuestion for the API request
 */
export function mapQuestionToApiFormat(question: QuestionFormValue): CreatePollQuestion {
  return {
    prompt: question.question,
    type: question.response_type === 'single' ? 'single_choice' : 'multiple_choice',
    choices: question.options.filter((option) => option.trim() !== '').map((option) => ({ choice_text: option })),
  };
}

/**
 * Builds a CreateVoteRequest from form values
 * @param formValue - The vote form values
 * @param projectUid - The project UID from context
 * @returns CreateVoteRequest for the API
 */
export function buildCreateVoteRequest(formValue: VoteFormValue, projectUid: string): CreateVoteRequest {
  return {
    name: formValue.title,
    description: formValue.description || undefined,
    end_time: formValue.close_date ? formValue.close_date.toISOString() : '',
    project_uid: projectUid,
    committee_uid: formValue.committee?.uid || '',
    committee_filters: mapEligibilityToFilters(formValue.eligible_participants),
    poll_questions: formValue.questions.map(mapQuestionToApiFormat),
  };
}
