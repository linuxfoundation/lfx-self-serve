// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { mktgPortraitMeasure, mktgPortraitMeasuresInText } from './mktg-measure.utils';

describe('the pages’ one measure format', () => {
  it('prints a figure with a space before its unit, and brings a record’s prose to the same format', () => {
    expect(mktgPortraitMeasure(32, 'px')).toBe('32 px');
    expect(mktgPortraitMeasure(10, 'mm')).toBe('10 mm');
    expect(mktgPortraitMeasuresInText('Never below 12px on screen, 10MM in print; 32 px stays.')).toBe(
      'Never below 12 px on screen, 10 mm in print; 32 px stays.'
    );
    // Words that only end in a unit's letters are not measures.
    expect(mktgPortraitMeasuresInText('The 3 pixels rule and the comma.')).toBe('The 3 pixels rule and the comma.');
  });
});
