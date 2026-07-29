// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// Mirrors session-store.service.spec.ts / meeting.helper.spec.ts: `@lfx-one/shared/constants`
// resolves through a barrel with transitive imports that don't survive outside an Angular
// build/test context, so only the two values this helper needs are mocked.
vi.mock('@lfx-one/shared/constants', () => ({
  COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS: ['30d', '90d', 'ytd'],
  COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW: '30d',
}));

import { ServiceValidationError } from '../errors';
import { parseCommitteeEngagementWindow } from './committee-engagement-window.helper';

describe('parseCommitteeEngagementWindow', () => {
  it('defaults to 30d when the parameter is omitted', () => {
    expect(parseCommitteeEngagementWindow(undefined, 'get_committee_engagement')).toBe('30d');
  });

  it.each(['30d', '90d', 'ytd'])('passes through the supported value %s', (value) => {
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
