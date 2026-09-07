// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pins ACTIVITY_FEED_MAX_PAGE_SIZE against the value weekly-brief.service.spec.ts's fixtures are
// built from. That file mocks `@lfx-one/shared/constants` wholesale and hand-copies this
// constant's value into the mock factory — so a real-value change wouldn't be caught by that file's
// own "built from the constant, not a bare literal" fixtures, which are really built from the
// mock's copy. This is the one place the real value is loaded and checked.

import { describe, expect, it } from 'vitest';

import { ACTIVITY_FEED_MAX_PAGE_SIZE } from './activity-event.constants';

describe('ACTIVITY_FEED_MAX_PAGE_SIZE', () => {
  it("matches the value weekly-brief.service.spec.ts's mock factory hand-copies", () => {
    expect(ACTIVITY_FEED_MAX_PAGE_SIZE).toBe(50);
  });
});
