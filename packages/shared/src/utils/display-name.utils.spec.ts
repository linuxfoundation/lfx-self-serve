// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildDisplayName, cleanNamePart, isPlaceholderName } from './display-name.utils';

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

  it('drops a placeholder part', () => {
    expect(buildDisplayName('Ada', '[[unknown]]')).toBe('Ada');
    expect(buildDisplayName('[[unknown]]', '[[unknown]]')).toBe('');
  });
});

describe('isPlaceholderName', () => {
  it.each(['[[unknown]]', '[[Unknown]]', ' [[unknown]] ', '[[]]', '[[Unknown]] [[unknown]]'])('treats %j as a placeholder', (value) => {
    expect(isPlaceholderName(value)).toBe(true);
  });

  it.each(['Ada', '', null, undefined, '[unknown]', 'Ada [x]', 'unknown'])('treats %j as not a placeholder', (value) => {
    expect(isPlaceholderName(value)).toBe(false);
  });
});

describe('cleanNamePart', () => {
  it('trims a real name', () => {
    expect(cleanNamePart('  Ada ')).toBe('Ada');
  });

  it('returns an empty string for a missing, blank or placeholder part', () => {
    expect(cleanNamePart(null)).toBe('');
    expect(cleanNamePart(undefined)).toBe('');
    expect(cleanNamePart('   ')).toBe('');
    expect(cleanNamePart('[[unknown]]')).toBe('');
    expect(cleanNamePart(' [[Unknown]] ')).toBe('');
  });
});
