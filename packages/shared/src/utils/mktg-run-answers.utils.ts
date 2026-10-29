// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_NON_ANSWER_REGEX } from '../constants/foundation-message.constants';
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '../constants/mktg-run.constants';
import type { MktgAnswerProblemOptions } from '../interfaces/mktg-run.interface';

/** A substantive answer is required; only a caller-verified question may use literal "none". */
export function mktgAnswerProblem(text: unknown, { allowNone = false }: MktgAnswerProblemOptions = {}): string | null {
  if (typeof text !== 'string' || !text.trim()) return MKTG_ANSWERS_INCOMPLETE_MESSAGE;
  const answer = text.trim();
  if (allowNone && answer.toLowerCase() === 'none') return null;
  return FOUNDATION_MESSAGE_NON_ANSWER_REGEX.test(answer) ? MKTG_ANSWERS_INCOMPLETE_MESSAGE : null;
}
