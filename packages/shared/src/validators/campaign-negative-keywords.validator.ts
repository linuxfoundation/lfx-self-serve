// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { MAX_NEGATIVE_KEYWORD_TEXT_LENGTH, MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '../constants/campaign.constants';
import { parseNegativeKeywordInput } from '../utils/campaign.utils';

/**
 * The negative-keyword editor's text: 1 to `maxKeywords` keywords (default
 * `MAX_NEGATIVE_KEYWORDS_PER_REQUEST`), one per line, each one campaign-service would accept (see
 * `parseNegativeKeywordInput`) and no longer than `maxTextLength` characters (default
 * `MAX_NEGATIVE_KEYWORD_TEXT_LENGTH`). Both may be getters, read on every validation, because both
 * depend on the campaign's platform (X takes 20 keywords; Google caps a keyword's text at 80),
 * which an editor learns after building its form.
 *
 * Returns `{ negativeKeywordsRequired }` when no line holds a keyword,
 * `{ negativeKeywordsInvalid: { problems } }` when any line cannot be sent (the whole batch is held
 * back, so nothing is sent with a line silently dropped), and
 * `{ negativeKeywordsTooMany: { max, count } }` when there are too many.
 */
export function campaignNegativeKeywordsValidator(
  maxKeywords: number | (() => number) = MAX_NEGATIVE_KEYWORDS_PER_REQUEST,
  maxTextLength: number | (() => number) = MAX_NEGATIVE_KEYWORD_TEXT_LENGTH
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const max = typeof maxKeywords === 'function' ? maxKeywords() : maxKeywords;
    const maxText = typeof maxTextLength === 'function' ? maxTextLength() : maxTextLength;
    const { keywords, problems } = parseNegativeKeywordInput(control.value, maxText);
    if (problems.length > 0) {
      return { negativeKeywordsInvalid: { problems } };
    }
    if (keywords.length === 0) {
      return { negativeKeywordsRequired: true };
    }
    if (keywords.length > max) {
      return { negativeKeywordsTooMany: { max, count: keywords.length } };
    }
    return null;
  };
}
