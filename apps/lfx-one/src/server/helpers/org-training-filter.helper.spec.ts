// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { assertWellFormedOrgTrainingFilterValue, isWellFormedOrgTrainingFilterValue } from './org-training-filter.helper';

const MAX = MAX_ORG_TRAINING_FILTER_VALUE_LENGTH;

describe('assertWellFormedOrgTrainingFilterValue', () => {
  const check = (value: unknown, trim: boolean): void =>
    assertWellFormedOrgTrainingFilterValue(value, 'course', 'test_operation', trim ? 'filter' : 'groupKey');

  it('accepts a value at the cap and any value the organization might not carry', () => {
    expect(() => check('x'.repeat(MAX), true)).not.toThrow();
    expect(() => check("Unknown ' OR 1=1 --", true)).not.toThrow();
    expect(() => check('', false)).not.toThrow();
  });

  it('measures a filter value after trimming, but a group key verbatim', () => {
    const padded = `  ${'x'.repeat(MAX)}  `;

    expect(() => check(padded, true)).not.toThrow();
    expect(() => check(padded, false)).toThrow(ServiceValidationError);
  });

  it('accepts a tab (kept by the SQL trim, the option builders and the URL parser) and rejects every other control character', () => {
    expect(() => check('\tTabbed', true)).not.toThrow();
    expect(() => check('a\tb\t', true)).not.toThrow();
    for (let code = 0; code <= 0x1f; code++) {
      if (code === 9) continue;
      expect(() => check(`a${String.fromCharCode(code)}b`, true), `U+${code.toString(16)}`).toThrow(ServiceValidationError);
    }
    expect(() => check('a\u007fb', true)).toThrow(ServiceValidationError);
    expect(isWellFormedOrgTrainingFilterValue('\tTabbed')).toBe(true);
    expect(isWellFormedOrgTrainingFilterValue('Line\nBreak')).toBe(false);
  });

  it('checks a group key for type and length only: it is matched against the cached group keys, never used as a filter', () => {
    expect(() => check('\tTabbed', false)).not.toThrow();
    expect(() => check('Line\nBreak', false)).not.toThrow();
    expect(() => check('x'.repeat(MAX + 1), false)).toThrow(ServiceValidationError);
    expect(() => check(['a'], false)).toThrow(ServiceValidationError);
  });

  it.each([
    ['over the cap', 'x'.repeat(MAX + 1)],
    ['a control character', 'a\u0000b'],
    ['a newline inside', 'a\nb'],
    ['a delete character', 'a\u007fb'],
    ['an array', ['a', 'b']],
    ['an object', { a: 'b' }],
    ['a number', 7],
  ])('rejects %s', (_name, value) => {
    expect(() => check(value, true)).toThrow(ServiceValidationError);
  });
});
