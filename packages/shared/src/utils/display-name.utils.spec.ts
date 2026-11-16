// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildDisplayName } from './display-name.utils';

describe('buildDisplayName', () => {
  it('joins first and last name with a single space', () => {
    expect(buildDisplayName('Ada', 'Byron')).toBe('Ada Byron');
  });

  it('trims each part', () => {
    expect(buildDisplayName('  Ada ', ' Byron  ')).toBe('Ada Byron');
  });

  it('drops a missing or blank part', () => {
    expect(buildDisplayName('Ada', null)).toBe('Ada');
    expect(buildDisplayName(undefined, 'Byron')).toBe('Byron');
    expect(buildDisplayName('Ada', '   ')).toBe('Ada');
  });

  it('returns an empty string when both parts are empty', () => {
    expect(buildDisplayName('', undefined)).toBe('');
    expect(buildDisplayName(null, null)).toBe('');
  });
});
