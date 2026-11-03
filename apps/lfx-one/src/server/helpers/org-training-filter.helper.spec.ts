// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { assertWellFormedOrgTrainingFilterValue, normalizeOrgTrainingFilterValue } from './org-training-filter.helper';

const MAX = MAX_ORG_TRAINING_FILTER_VALUE_LENGTH;

describe('normalizeOrgTrainingFilterValue', () => {
  it('trims, caps and maps blank or non-string values to null', () => {
    expect(normalizeOrgTrainingFilterValue('  Course A  ')).toBe('Course A');
    expect(normalizeOrgTrainingFilterValue('x'.repeat(MAX + 10))).toBe('x'.repeat(MAX));
    expect(normalizeOrgTrainingFilterValue('   ')).toBeNull();
    expect(normalizeOrgTrainingFilterValue(null)).toBeNull();
    expect(normalizeOrgTrainingFilterValue(undefined)).toBeNull();
  });
});

describe('assertWellFormedOrgTrainingFilterValue', () => {
  const check = (value: unknown, trim: boolean): void => assertWellFormedOrgTrainingFilterValue(value, 'course', 'test_operation', trim);

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
