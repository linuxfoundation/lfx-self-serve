// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '../constants/campaign.constants';
import { parseNegativeKeywordInput } from '../utils/campaign.utils';

/**
 * The negative-keyword editor's text: 1 to `MAX_NEGATIVE_KEYWORDS_PER_REQUEST` keywords, one per
 * line, each one campaign-service would accept (see `parseNegativeKeywordInput`).
 *
 * Returns `{ negativeKeywordsRequired }` when no line holds a keyword,
 * `{ negativeKeywordsInvalid: { problems } }` when any line cannot be sent (the whole batch is held
 * back, so nothing is sent with a line silently dropped), and
 * `{ negativeKeywordsTooMany: { max, count } }` when there are too many.
 */
export function campaignNegativeKeywordsValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const { keywords, problems } = parseNegativeKeywordInput(control.value);
    if (problems.length > 0) {
      return { negativeKeywordsInvalid: { problems } };
    }
    if (keywords.length === 0) {
      return { negativeKeywordsRequired: true };
    }
    if (keywords.length > MAX_NEGATIVE_KEYWORDS_PER_REQUEST) {
      return { negativeKeywordsTooMany: { max: MAX_NEGATIVE_KEYWORDS_PER_REQUEST, count: keywords.length } };
    }
    return null;
  };
}
