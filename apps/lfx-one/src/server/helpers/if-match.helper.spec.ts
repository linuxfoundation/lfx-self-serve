// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { parseIfMatch } from './if-match.helper';

function reqWithIfMatch(value: string | undefined): Request {
  return {
    header: (name: string) => (name === 'If-Match' ? (value ?? '') : ''),
    path: '/formations/p1/items/k1',
  } as unknown as Request;
}

describe('parseIfMatch', () => {
  it('rejects a missing header', () => {
    expect(() => parseIfMatch(reqWithIfMatch(undefined), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects an empty header', () => {
    expect(() => parseIfMatch(reqWithIfMatch(''), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects a quoted entity-tag', () => {
    expect(() => parseIfMatch(reqWithIfMatch('"5"'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects a weak entity-tag', () => {
    expect(() => parseIfMatch(reqWithIfMatch('W/"5"'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects a non-numeric value', () => {
    expect(() => parseIfMatch(reqWithIfMatch('not-a-number'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects zero', () => {
    expect(() => parseIfMatch(reqWithIfMatch('0'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects a negative value', () => {
    expect(() => parseIfMatch(reqWithIfMatch('-1'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('rejects a decimal value', () => {
    expect(() => parseIfMatch(reqWithIfMatch('4.5'), 'test_op')).toThrow(ServiceValidationError);
  });

  it('accepts a bare positive integer and returns it as a string', () => {
    expect(parseIfMatch(reqWithIfMatch('42'), 'test_op')).toBe('42');
  });

  it('accepts a large bare integer without precision loss', () => {
    expect(parseIfMatch(reqWithIfMatch('9007199254740993'), 'test_op')).toBe('9007199254740993');
  });
});
