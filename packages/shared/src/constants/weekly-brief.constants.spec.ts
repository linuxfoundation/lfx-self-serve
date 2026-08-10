// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pins WEEKLY_BRIEF_TEXT_MAX_LENGTH against upstream's documented bound. The BFF's
// server-side vitest config mocks `@lfx-one/shared/constants` wholesale (to avoid
// re-triggering an Angular JIT-compilation failure — see weekly-brief.controller.spec.ts),
// so its mocked value can't catch drift if this constant ever changes. This is the one
// place the real value is loaded and checked.

import { describe, expect, it } from 'vitest';

import {
  SLACK_ERROR_BODY_MAX_LENGTH,
  SLACK_ERROR_TOKEN_PATTERN,
  SLACK_MESSAGE_TEXT_MAX_LENGTH,
  WEEKLY_BRIEF_DEFAULT_THROTTLE,
  WEEKLY_BRIEF_TEXT_MAX_LENGTH,
} from './weekly-brief.constants';

describe('WEEKLY_BRIEF_TEXT_MAX_LENGTH', () => {
  it('matches upstream UpdateCurrentWeeklyBriefRequestBody.brief_text maxLength', () => {
    expect(WEEKLY_BRIEF_TEXT_MAX_LENGTH).toBe(20_000);
  });
});

describe('SLACK_MESSAGE_TEXT_MAX_LENGTH', () => {
  // Same rationale as WEEKLY_BRIEF_TEXT_MAX_LENGTH above: weekly-brief.service.spec.ts's
  // wholesale `@lfx-one/shared/constants` mock hand-copies this value, so a real-value change
  // here wouldn't be caught there — this is the one place it's checked against the real export.
  it("matches Slack's documented incoming-webhook text field limit", () => {
    expect(SLACK_MESSAGE_TEXT_MAX_LENGTH).toBe(40_000);
  });
});

describe('SLACK_ERROR_BODY_MAX_LENGTH', () => {
  // Same rationale as the two describes above: weekly-brief.service.spec.ts's wholesale
  // `@lfx-one/shared/constants` mock hand-copies this value too.
  it('is a small, deliberate bound', () => {
    expect(SLACK_ERROR_BODY_MAX_LENGTH).toBe(500);
  });
});

describe('SLACK_ERROR_TOKEN_PATTERN', () => {
  it("matches Slack's documented short lowercase/underscore error tokens", () => {
    expect(SLACK_ERROR_TOKEN_PATTERN.test('invalid_payload')).toBe(true);
    expect(SLACK_ERROR_TOKEN_PATTERN.test('channel_not_found')).toBe(true);
    expect(SLACK_ERROR_TOKEN_PATTERN.test('action_prohibited')).toBe(true);
  });

  it('rejects arbitrary third-party content that is not a Slack error token', () => {
    expect(SLACK_ERROR_TOKEN_PATTERN.test('<html><body>502 Bad Gateway</body></html>')).toBe(false);
    expect(SLACK_ERROR_TOKEN_PATTERN.test('invalid_payload\n')).toBe(false);
    expect(SLACK_ERROR_TOKEN_PATTERN.test('x'.repeat(65))).toBe(false);
    expect(SLACK_ERROR_TOKEN_PATTERN.test('')).toBe(false);
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
