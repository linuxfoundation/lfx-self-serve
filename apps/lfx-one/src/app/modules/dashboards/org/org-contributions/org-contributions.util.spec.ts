// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgCommitFilters } from '@lfx-one/shared/interfaces';

import { describeContributionsCaption, describeContributionsWindow, describeContributorsTooltip } from './org-contributions.util';

describe('describeContributionsWindow', () => {
  const now = new Date('2026-10-21T23:26:00.000Z');

  it.each([
    ['730d', 'from Oct 21, 2024 to Oct 21, 2026 (UTC)'],
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
  // Every caption here is for commits on any branch in LF projects unless the case overrides it.
  const caption = (filters: Partial<OrgCommitFilters>) =>
    describeContributionsCaption({ projectScope: 'lf', commitScope: 'all', metric: 'commits', ...filters }, 'Acme', window);

  it('describes commits on any branch in LF projects', () => {
    expect(caption({})).toBe(
      'Commits authored by contributors affiliated with Acme, on any branch (including pull-request commits not yet merged) in LF projects, counted once each, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.'
    );
  });

  it('names LF and non-LF projects, the scope Insights counts', () => {
    expect(caption({ projectScope: 'all' })).toContain('not yet merged) in LF and non-LF projects, counted once each,');
  });

  it('describes only main branch commits in LF projects', () => {
    expect(caption({ commitScope: 'merged', projectScope: 'lf' })).toBe(
      'Commits authored by contributors affiliated with Acme, only commits on the main branch in LF projects, counted once each, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.'
    );
  });

  it('describes commits outside LF projects', () => {
    expect(caption({ projectScope: 'non_lf' })).toContain('not yet merged) outside LF projects, counted once each,');
  });

  it.each([
    ['all', ' in LF and non-LF projects'],
    ['lf', ' in LF projects'],
    ['non_lf', ' outside LF projects'],
  ] as const)('describes code contributions with projectScope=%s, ignoring the commit scope', (projectScope, phrase) => {
    expect(caption({ metric: 'code', projectScope, commitScope: 'merged' })).toBe(
      `Code contributions (commits, pull requests, reviews and comments) by contributors affiliated with Acme${phrase}, from Oct 21, 2025 to Oct 21, 2026 (UTC). Bots excluded.`
    );
  });
});

describe('describeContributorsTooltip', () => {
  it('names the scope and window and credits the employer at the time, people who left included under All employees', () => {
    expect(describeContributorsTooltip('lf', 'Acme', 'across all recorded history', 'all')).toBe(
      'People with at least one code contribution (commit, pull request, review or comment) credited to Acme in LF projects, across all recorded history. ' +
        'Each contribution is credited to the employer the person had at the time, so people who have since left are included. ' +
        'Maintainers with code are counted here too. Bots excluded.'
    );
  });

  it('names LF and non-LF projects', () => {
    expect(describeContributorsTooltip('all', 'Acme', 'from Oct 21, 2025 to Oct 21, 2026 (UTC)', 'all')).toContain(
      'credited to Acme in LF and non-LF projects, from Oct 21, 2025 to Oct 21, 2026 (UTC).'
    );
  });

  // lfx-self-serve#4627 — the Employment filter narrows who is counted.
  it.each([
    ['current', 'Each contribution is credited to the employer the person had at the time, and only people who still work at Acme are counted. '],
    ['former', 'Each contribution is credited to the employer the person had at the time, and only people who have since left Acme are counted. '],
  ] as const)('says who is counted under %s employees', (employment, sentence) => {
    const tooltip = describeContributorsTooltip('lf', 'Acme', 'across all recorded history', employment);

    expect(tooltip).toContain(sentence);
    expect(tooltip).not.toContain('people who have since left are included');
  });
});
