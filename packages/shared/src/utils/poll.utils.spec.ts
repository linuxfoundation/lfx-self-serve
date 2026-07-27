// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for poll.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

import { describe, expect, it } from 'vitest';

import { PollStatus } from '../enums';
import { normalizePollStatus } from './poll.utils';

describe('normalizePollStatus', () => {
  it('lowercases an already-lowercase status', () => {
    expect(normalizePollStatus(PollStatus.ACTIVE)).toBe('active');
  });

  it('lowercases an uppercase/mixed-case status', () => {
    expect(normalizePollStatus('ACTIVE')).toBe('active');
    expect(normalizePollStatus('Ended')).toBe('ended');
  });

  it('returns an empty string for a nullish status instead of throwing', () => {
    expect(normalizePollStatus(null)).toBe('');
    expect(normalizePollStatus(undefined)).toBe('');
  });
});
