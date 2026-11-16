// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MEMBER_360_INPUT_TIMEOUT_MESSAGE, MEMBER_360_PAUSED_MESSAGE } from './member-360.constants';

describe('Member 360 paused notice', () => {
  it('keeps the legacy export compatible without expiry or rerun instructions', () => {
    expect(MEMBER_360_INPUT_TIMEOUT_MESSAGE).toBe(MEMBER_360_PAUSED_MESSAGE);
    expect(MEMBER_360_PAUSED_MESSAGE).toBe('Member 360 is waiting for input; the run stays open.');
  });
});
