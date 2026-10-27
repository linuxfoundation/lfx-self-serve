// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgCommitFilters } from '@lfx-one/shared/interfaces';

import { describeContributionsCaption, describeContributionsWindow } from './org-contributions.util';

describe('describeContributionsWindow', () => {
  const now = new Date('2026-10-21T23:26:00.000Z');

  it.each([
    ['12mo', 'from Oct 21, 2025 to Oct 21, 2026 (UTC)'],
    ['90d', 'from Jul 23, 2026 to Oct 21, 2026 (UTC)'],
    ['30d', 'from Sep 21, 2026 to Oct 21, 2026 (UTC)'],
    ['all', 'across all recorded history'],
  ] as const)('describes %s', (range, expected) => {
    expect(describeContributionsWindow(range, now)).toBe(expected);
  });

  // Twelve months back lands in the same calendar month, so the leap day is the only date where the
  // target month is shorter. `DATEADD(month, -12, ...)` clamps to Feb 28; a bare `setUTCMonth` would
  // overflow to Mar 1 and put the caption a day off exactly when someone is reconciling source rows.
  it('clamps the 12-month start on a leap day instead of overflowing', () => {
    expect(describeContributionsWindow('12mo', new Date('2028-02-29T12:00:00.000Z'))).toBe('from Feb 28, 2027 to Feb 29, 2028 (UTC)');
  });

  it('leaves the 12-month start alone on a date the target month can hold', () => {
    expect(describeContributionsWindow('12mo', new Date('2028-02-28T12:00:00.000Z'))).toBe('from Feb 28, 2027 to Feb 28, 2028 (UTC)');
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
