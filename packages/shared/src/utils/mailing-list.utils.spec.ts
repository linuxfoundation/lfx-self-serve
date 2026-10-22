// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MAILING_LIST_NAME_PATTERN } from '../constants/mailing-list.constants';
import { normalizeServicePrefix } from './mailing-list.utils';

describe('normalizeServicePrefix', () => {
  it.each([
    ['example-project-', 'example-project'],
    ['example-project--', 'example-project'],
    ['example-project', 'example-project'],
    ['a-b-c-', 'a-b-c'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeServicePrefix(input)).toBe(expected);
  });

  it.each([[''], [null], [undefined]])('returns an empty string for %j', (input) => {
    expect(normalizeServicePrefix(input)).toBe('');
  });

  it('returns an empty string when the prefix is only hyphens', () => {
    expect(normalizeServicePrefix('---')).toBe('');
  });

  it('only trims the end, leaving hyphens elsewhere untouched', () => {
    expect(normalizeServicePrefix('-a--b-')).toBe('-a--b');
  });

  it('handles a very long run of hyphens quickly', () => {
    const input = `${'-'.repeat(100_000)}x`;
    const start = Date.now();

    expect(normalizeServicePrefix(input)).toBe(input);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('never produces a double hyphen when joined with a list name', () => {
    expect(`${normalizeServicePrefix('example-project-')}-dev`).toBe('example-project-dev');
    expect(`${normalizeServicePrefix('example-project')}-dev`).toBe('example-project-dev');
  });
});

describe('MAILING_LIST_NAME_PATTERN', () => {
  it.each(['dev', 'a1', 'Ab-c1', 'my-list', 'x1-TSC-private'])('accepts %j', (name) => {
    expect(MAILING_LIST_NAME_PATTERN.test(name)).toBe(true);
  });

  it.each(['a--b', '-a', 'a-', 'a_b', 'a.b', 'a b', ''])('rejects %j', (name) => {
    expect(MAILING_LIST_NAME_PATTERN.test(name)).toBe(false);
  });
});
