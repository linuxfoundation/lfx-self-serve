// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pins this module's constants against the values their own consumers assume — either an
// upstream-documented bound, or a value a server spec's `vi.mock('@lfx-one/shared/constants', ...)`
// hand-copies (which real-value drift wouldn't otherwise be caught against; see each `it()` below
// for which applies and why). NOT the BFF's vitest config that could otherwise be blamed for
// needing this: that only aliases `@lfx-one/shared` to the real source
// (`apps/lfx-one/vitest.config.ts`'s own comment: "server specs exercise the real shared barrels
// instead of drift-prone vi.mock stubs") — any hand-copying happens per spec file, not centrally.

import { describe, expect, it } from 'vitest';

import {
  WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS,
  WEEKLY_BRIEF_DEFAULT_THROTTLE,
  WEEKLY_BRIEF_POLL_INTERVAL_MS,
  WEEKLY_BRIEF_TEXT_MAX_LENGTH,
} from './weekly-brief.constants';

describe('WEEKLY_BRIEF_TEXT_MAX_LENGTH', () => {
  it('matches upstream UpdateCurrentWeeklyBriefRequestBody.brief_text maxLength', () => {
    expect(WEEKLY_BRIEF_TEXT_MAX_LENGTH).toBe(20_000);
  });
});

describe('WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS', () => {
  it('stays under WEEKLY_BRIEF_POLL_INTERVAL_MS — its own doc comment claims a slow poll tick can now resolve server-side, inside this budget, before the client abandons the tick; a later edit to either constant that breaks that ordering would otherwise silently revert the claimed behavior with no other test failing', () => {
    expect(WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS).toBeLessThan(WEEKLY_BRIEF_POLL_INTERVAL_MS);
  });

  // Absolute pin, alongside the relative one above —
  // apps/lfx-one/src/server/services/weekly-brief.service.spec.ts's own budget test imports this
  // identifier through that file's `vi.mock('@lfx-one/shared/constants', ...)` hand-copy
  // (currently 3_000, kept in sync by hand), so a real-value change here would leave that test
  // silently exercising a value production no longer uses, with only the relative ordering test
  // above (which a value change could still satisfy) standing between that drift and going
  // unnoticed. Same rationale as activity-event.constants.spec.ts's pin on
  // ACTIVITY_FEED_MAX_PAGE_SIZE for the identical hand-copy hazard.
  it("matches the value weekly-brief.service.spec.ts's mock factory hand-copies", () => {
    expect(WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS).toBe(3_000);
  });
});

describe('WEEKLY_BRIEF_DEFAULT_THROTTLE', () => {
  it('matches the documented policy of 2 fresh generates and 3 regenerations per fixed calendar week', () => {
    expect(WEEKLY_BRIEF_DEFAULT_THROTTLE).toEqual({
      generates_used: 0,
      generates_limit: 2,
      regenerations_used: 0,
      regenerations_limit: 3,
    });
  });
});
