// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// Mirrors committee-engagement.service.spec.ts / snowflake-schema.helper.spec.ts: `@lfx-one/shared/constants`
// resolves through a barrel with transitive imports that don't survive outside an Angular
// build/test context, but the two values this helper needs are deep-imported from their real
// implementation (not hand-copied). Unlike those siblings, this doesn't make the suite fail on a
// constant change — `it.each` below derives its cases from the same constant, so adding or
// removing a window just changes what's covered, silently, rather than failing anything. The
// benefit here is that the parameterized cases track the real window list instead of a stale
// snapshot of it, not regression detection.
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/committee-engagement.constants')>(
    '../../../../../packages/shared/src/constants/committee-engagement.constants'
  );
  return {
    COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS: actual.COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS,
    COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW: actual.COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW,
  };
});

import { COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '../../../../../packages/shared/src/constants/committee-engagement.constants';
import { ServiceValidationError } from '../errors';
import { parseCommitteeEngagementWindow } from './committee-engagement-window.helper';

describe('parseCommitteeEngagementWindow', () => {
  it('defaults to 30d when the parameter is omitted', () => {
    // Pinned to the literal, not COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW — the mock resolves the same
    // constant the helper reads, so comparing against it here couldn't fail if the default changed.
    expect(parseCommitteeEngagementWindow(undefined, 'get_committee_engagement')).toBe('30d');
  });

  it.each(COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS)('passes through the supported value %s', (value) => {
    expect(parseCommitteeEngagementWindow(value, 'get_committee_engagement')).toBe(value);
  });

  it('rejects an unsupported string value', () => {
    expect(() => parseCommitteeEngagementWindow('allTime', 'get_committee_engagement')).toThrow(ServiceValidationError);
  });

  it('rejects an empty string rather than defaulting', () => {
    expect(() => parseCommitteeEngagementWindow('', 'get_committee_engagement')).toThrow(ServiceValidationError);
  });

  it('rejects a non-string value', () => {
    expect(() => parseCommitteeEngagementWindow(42, 'get_committee_engagement')).toThrow(ServiceValidationError);
  });
});
