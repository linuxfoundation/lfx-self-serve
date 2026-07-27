// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for poll.utils.ts — `yarn test` (this file runs under the packages/shared Vitest project).

import { describe, expect, it } from 'vitest';

import { PollStatus } from '../enums';
import { normalizePollStatus } from './poll.utils';

describe('normalizePollStatus', () => {
  it('returns an already-lowercase status unchanged', () => {
    expect(normalizePollStatus(PollStatus.ACTIVE)).toBe(PollStatus.ACTIVE);
  });

  it('lowercases an uppercase/mixed-case status that matches a real member', () => {
    expect(normalizePollStatus('ACTIVE')).toBe(PollStatus.ACTIVE);
    expect(normalizePollStatus('Ended')).toBe(PollStatus.ENDED);
  });

  it('returns undefined for a nullish status instead of throwing', () => {
    expect(normalizePollStatus(null)).toBeUndefined();
    expect(normalizePollStatus(undefined)).toBeUndefined();
  });

  it('returns undefined for a value that is not a real PollStatus member', () => {
    expect(normalizePollStatus('archived')).toBeUndefined();
    expect(normalizePollStatus('')).toBeUndefined();
  });
});
