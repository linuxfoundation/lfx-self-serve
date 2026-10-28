// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { CommentResponseInput, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import { codePointLength } from '@lfx-one/shared/utils/string.utils';

import { ServiceValidationError } from '../errors';

interface ValidationContext {
  readonly operation: string;
  readonly service: string;
}

/**
 * Validates `comment_responses` and rebuilds it from the validated fields only, so unexpected extra properties on a
 * client payload never cross the BFF boundary. Shared by the authenticated ballot submit and the public vote link submit.
 */
export function buildValidatedCommentResponses(raw: unknown, context: ValidationContext): CommentResponseInput[] {
  if (!Array.isArray(raw)) {
    throw ServiceValidationError.forField('comment_responses', 'comment_responses must be an array', context);
  }

  return raw.map((response: unknown, index) => {
    if (!response || typeof response !== 'object') {
      throw ServiceValidationError.forField(`comment_responses[${index}]`, 'Each comment response must be a non-null object', context);
    }
    const { prompt_id: promptId, comment_text: commentText } = response as Record<string, unknown>;

    if (!promptId || typeof promptId !== 'string') {
      throw ServiceValidationError.forField(`comment_responses[${index}].prompt_id`, 'prompt_id is required for each comment response', context);
    }
    if (typeof commentText !== 'string' || commentText.trim().length === 0) {
      throw ServiceValidationError.forField(`comment_responses[${index}].comment_text`, 'comment_text is required for each comment response', context);
    }
    // Count code points (not UTF-16 units) so emoji/non-BMP text isn't rejected at roughly half the real allowance.
    if (codePointLength(commentText) > VOTE_COMMENT_RESPONSE_MAX_LENGTH) {
      throw ServiceValidationError.forField(
        `comment_responses[${index}].comment_text`,
        `comment_text must be ${VOTE_COMMENT_RESPONSE_MAX_LENGTH} characters or fewer`,
        context
      );
    }

    return { prompt_id: promptId, comment_text: commentText };
  });
}

/** Validates `user_vote_content` (required when not abstaining) and rebuilds each answer from its validated fields only. */
export function buildValidatedVoteAnswers(raw: unknown, context: ValidationContext): VoteAnswerInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw ServiceValidationError.forField('user_vote_content', 'user_vote_content is required when not abstaining', context);
  }

  return raw.map((answer: unknown, index) => {
    if (!answer || typeof answer !== 'object') {
      throw ServiceValidationError.forField(`user_vote_content[${index}]`, 'Each answer must be a non-null object', context);
    }
    const { question_id: questionId, choice_ids: choiceIds, ranked_choices: rankedChoices } = answer as Record<string, unknown>;

    if (!questionId || typeof questionId !== 'string') {
      throw ServiceValidationError.forField(`user_vote_content[${index}].question_id`, 'question_id is required for each answer', context);
    }

    const hasChoiceIds = Array.isArray(choiceIds) && choiceIds.length > 0;
    const hasRankedChoices = Array.isArray(rankedChoices) && rankedChoices.length > 0;
    if (!hasChoiceIds && !hasRankedChoices) {
      throw ServiceValidationError.forField(`user_vote_content[${index}]`, 'Each answer must include either choice_ids or ranked_choices', context);
    }

    const rebuilt: VoteAnswerInput = { question_id: questionId };
    if (hasChoiceIds) {
      if (!(choiceIds as unknown[]).every((id) => typeof id === 'string' && id.length > 0)) {
        throw ServiceValidationError.forField(`user_vote_content[${index}].choice_ids`, 'choice_ids must contain only non-empty strings', context);
      }
      rebuilt.choice_ids = choiceIds as string[];
    }
    if (hasRankedChoices) {
      rebuilt.ranked_choices = (rankedChoices as unknown[]).map((choice, rank) => {
        const { choice_id: choiceId, choice_rank: choiceRank } = (choice ?? {}) as Record<string, unknown>;
        if (typeof choiceId !== 'string' || choiceId.length === 0 || typeof choiceRank !== 'number' || !Number.isInteger(choiceRank)) {
          throw ServiceValidationError.forField(
            `user_vote_content[${index}].ranked_choices[${rank}]`,
            'Each ranked choice needs a choice_id and an integer choice_rank',
            context
          );
        }
        return { choice_id: choiceId, choice_rank: choiceRank };
      });
    }
    return rebuilt;
  });
}
