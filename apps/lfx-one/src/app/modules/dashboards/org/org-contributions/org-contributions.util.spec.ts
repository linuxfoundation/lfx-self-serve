// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgCommitFilters } from '@lfx-one/shared/interfaces';

import { describeContributionsCaption, describeContributionsWindow } from './org-contributions.util';

describe('describeContributionsWindow', () => {
  const now = new Date('2026-10-21T23:26:00.000Z');

  it.each([
    ['365d', 'from Oct 21, 2025 to Oct 21, 2026 (UTC)'],
    ['90d', 'from Jul 23, 2026 to Oct 21, 2026 (UTC)'],
    ['30d', 'from Sep 21, 2026 to Oct 21, 2026 (UTC)'],
    ['all', 'across all recorded history'],
  ] as const)('describes %s', (range, expected) => {
    expect(describeContributionsWindow(range, now)).toBe(expected);
  });

  // 365 days, not 12 months: across a leap day the window starts a day later than the same date last year,
  // matching `DATEADD(day, -365, ...)` in the BFF.
  it('counts 365 days back across a leap day, not twelve months', () => {
    expect(describeContributionsWindow('365d', new Date('2028-03-15T12:00:00.000Z'))).toBe('from Mar 16, 2027 to Mar 15, 2028 (UTC)');
  });
});

describe('describeContributionsCaption', () => {
  const window = 'from Oct 21, 2025 to Oct 21, 2026 (UTC)';
  const caption = (filters: Partial<OrgCommitFilters>) =>
    describeContributionsCaption({ projectScope: 'all', commitScope: 'all', metric: 'commits', ...filters }, 'Acme', window);

  it('describes commits on any branch by default', () => {
    expect(caption({})).toBe(
      'Commits authored by contributors affiliated with Acme, on any branch (including pull-request commits not yet merged), counted once each, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.'
    );
  });

  it('describes merged commits in LF projects', () => {
    expect(caption({ commitScope: 'merged', projectScope: 'lf' })).toBe(
      'Commits authored by contributors affiliated with Acme, merged to the main branch in LF projects, counted once each, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.'
    );
  });

  it('describes commits outside LF projects', () => {
    expect(caption({ projectScope: 'non_lf' })).toContain('not yet merged) outside LF projects, counted once each,');
  });

  it.each([
    ['all', ''],
    ['lf', ' in LF projects'],
    ['non_lf', ' outside LF projects'],
  ] as const)('describes code contributions with projectScope=%s, ignoring the commit scope', (projectScope, phrase) => {
    expect(caption({ metric: 'code', projectScope, commitScope: 'merged' })).toBe(
      `Code contributions (commits, pull requests, reviews and comments) by contributors affiliated with Acme${phrase}, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.`
    );
  });
});
