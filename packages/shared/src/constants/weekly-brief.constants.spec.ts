// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pins WEEKLY_BRIEF_TEXT_MAX_LENGTH against upstream's documented bound. The BFF's
// server-side vitest config mocks `@lfx-one/shared/constants` wholesale (to avoid
// re-triggering an Angular JIT-compilation failure — see weekly-brief.controller.spec.ts),
// so its mocked value can't catch drift if this constant ever changes. This is the one
// place the real value is loaded and checked.

import { describe, expect, it } from 'vitest';

import { WEEKLY_BRIEF_DEFAULT_THROTTLE, WEEKLY_BRIEF_TEXT_MAX_LENGTH } from './weekly-brief.constants';

describe('WEEKLY_BRIEF_TEXT_MAX_LENGTH', () => {
  it('matches upstream UpdateCurrentWeeklyBriefRequestBody.brief_text maxLength', () => {
    expect(WEEKLY_BRIEF_TEXT_MAX_LENGTH).toBe(20_000);
  });
});

describe('WEEKLY_BRIEF_DEFAULT_THROTTLE', () => {
  it('matches the documented policy of 2 fresh generates and 3 regenerations per rolling week', () => {
    expect(WEEKLY_BRIEF_DEFAULT_THROTTLE).toEqual({
      generates_used: 0,
      generates_limit: 2,
      regenerations_used: 0,
      regenerations_limit: 3,
    });
  });
});
