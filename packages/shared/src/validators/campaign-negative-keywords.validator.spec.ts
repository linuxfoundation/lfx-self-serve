// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { MAX_NEGATIVE_KEYWORDS_PER_REQUEST } from '../constants/campaign.constants';
import { campaignNegativeKeywordsValidator } from './campaign-negative-keywords.validator';

const control = (value: unknown): AbstractControl => ({ value }) as AbstractControl;
const validate = (value: unknown): ValidationErrors | null => campaignNegativeKeywordsValidator()(control(value));
const lines = (count: number): string => Array.from({ length: count }, (_, i) => `keyword ${i}`).join('\n');

describe('campaignNegativeKeywordsValidator', () => {
  it.each(['', '   \n  \n', null])('requires at least one keyword (%s)', (value) => {
    expect(validate(value)).toEqual({ negativeKeywordsRequired: true });
  });

  it(`accepts 1 and ${MAX_NEGATIVE_KEYWORDS_PER_REQUEST} keywords`, () => {
    expect(validate('one')).toBeNull();
    expect(validate(lines(MAX_NEGATIVE_KEYWORDS_PER_REQUEST))).toBeNull();
  });

  it(`refuses more than ${MAX_NEGATIVE_KEYWORDS_PER_REQUEST} keywords`, () => {
    expect(validate(lines(MAX_NEGATIVE_KEYWORDS_PER_REQUEST + 1))).toEqual({
      negativeKeywordsTooMany: { max: MAX_NEGATIVE_KEYWORDS_PER_REQUEST, count: MAX_NEGATIVE_KEYWORDS_PER_REQUEST + 1 },
    });
  });

  // The whole batch is held back: sending the good lines alone would silently drop the bad ones.
  it('refuses the batch when any line cannot be sent, naming the line', () => {
    const errors = validate('fine\nnot ok!');
    expect(errors?.['negativeKeywordsInvalid'].problems).toEqual([{ line: 2, text: 'not ok!', reason: expect.any(String) }]);
  });
});
