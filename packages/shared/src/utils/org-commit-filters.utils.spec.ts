// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORG_CODE_MEASURE,
  DEFAULT_ORG_COMMIT_FILTERS,
  ORG_CODE_MEASURE_DEFINITION,
  ORG_CODE_MEASURE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
} from '../constants/org-commit-filters.constants';
import type { OrgCommitFilters } from '../interfaces';
import {
  orgCodeFilterValues,
  orgCommitFiltersFor,
  orgCommitFiltersUrlMatches,
  orgCommitFiltersUrlParams,
  readOrgCommitFilters,
} from './org-commit-filters.utils';

const read = (params: Record<string, string>): OrgCommitFilters => readOrgCommitFilters((name) => params[name]);

// lfx-self-serve#4559 — All code contributions is the default on Code Contributions, People → Contributors and All Employees.
describe('Org Lens code-count dropdown', () => {
  it('offers All code contributions first, as the default, then All commits and Only main branch commits', () => {
    expect(ORG_CODE_MEASURE_OPTIONS).toEqual([
      { label: 'All code contributions', value: 'code' },
      { label: 'All commits', value: 'commits' },
      { label: 'Only main branch commits', value: 'merged' },
    ]);
    expect(DEFAULT_ORG_CODE_MEASURE).toBe('code');
    expect(DEFAULT_ORG_COMMIT_FILTERS).toEqual({ projectScope: 'all', commitScope: 'all', metric: 'code' });
    expect(orgCommitFiltersFor({ projectScope: 'all', metric: DEFAULT_ORG_CODE_MEASURE })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('defines each option for its tooltip', () => {
    expect(ORG_CODE_MEASURE_DEFINITION).toEqual({
      commits: 'Commits the person authored, on any branch (including pull-request commits not yet merged), counted once each. Bots excluded.',
      merged: 'Commits the person authored that landed on the main branch, counted once each. Bots excluded.',
      code: 'Commits, pull requests, reviews and comments, counted as activities. Bots excluded.',
    });
  });

  it.each([
    ['commits', 'all', 'commits'],
    ['merged', 'merged', 'commits'],
    ['code', 'all', 'code'],
  ] as const)('maps %s to commitScope=%s&metric=%s and back', (metric, commitScope, bffMetric) => {
    const filters = orgCommitFiltersFor({ projectScope: 'lf', metric });

    expect(filters).toEqual({ projectScope: 'lf', commitScope, metric: bffMetric });
    expect(orgCodeFilterValues(filters)).toEqual({ projectScope: 'lf', metric });
  });

  it('reads the option from ?metric=, an unknown or missing value as All code contributions', () => {
    expect(read({ metric: 'merged' })).toEqual({ projectScope: 'all', commitScope: 'merged', metric: 'commits' });
    expect(read({ metric: 'commits' })).toEqual({ projectScope: 'all', commitScope: 'all', metric: 'commits' });
    expect(read({ projectScope: 'non_lf', metric: 'code' })).toEqual({ projectScope: 'non_lf', commitScope: 'all', metric: 'code' });
    expect(read({ projectScope: 'LF', metric: 'prs' })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
    expect(read({})).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('reads a legacy commitScope=merged link (commits was the default then) as Only main branch commits unless it asked for code contributions', () => {
    const merged: OrgCommitFilters = { projectScope: 'all', commitScope: 'merged', metric: 'commits' };
    expect(read({ commitScope: 'merged' })).toEqual(merged);
    expect(read({ commitScope: 'merged', metric: 'commits' })).toEqual(merged);
    expect(read({ commitScope: 'merged', metric: 'code' })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
    expect(read({ commitScope: 'main' })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('writes the option to ?metric=, drops the default and always drops ?commitScope=', () => {
    expect(orgCommitFiltersUrlParams(DEFAULT_ORG_COMMIT_FILTERS)).toEqual({ projectScope: null, commitScope: null, metric: null });
    expect(orgCommitFiltersUrlParams({ projectScope: 'lf', commitScope: 'merged', metric: 'commits' })).toEqual({
      projectScope: 'lf',
      commitScope: null,
      metric: 'merged',
    });
    const commits: OrgCommitFilters = { projectScope: 'all', commitScope: 'all', metric: 'commits' };
    expect(orgCommitFiltersUrlParams(commits)).toEqual({ projectScope: null, commitScope: null, metric: 'commits' });
    // Round trip: an explicit ?metric=commits reads back as commits.
    expect(read({ metric: 'commits' })).toEqual(commits);
  });

  it('matches only a URL that already spells the filters canonically', () => {
    const merged: OrgCommitFilters = { projectScope: 'all', commitScope: 'merged', metric: 'commits' };
    const matches = (filters: OrgCommitFilters, params: Record<string, string>): boolean => orgCommitFiltersUrlMatches(filters, (name) => params[name]);

    expect(matches(merged, { metric: 'merged', tab: 'contributors' })).toBe(true);
    expect(matches(merged, { commitScope: 'merged' })).toBe(false);
    expect(matches(DEFAULT_ORG_COMMIT_FILTERS, { metric: 'code' })).toBe(false);
    expect(matches(DEFAULT_ORG_COMMIT_FILTERS, {})).toBe(true);
    expect(matches({ ...DEFAULT_ORG_COMMIT_FILTERS, metric: 'commits' }, { metric: 'commits' })).toBe(true);
    expect(matches({ ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'lf' }, { projectScope: 'lf' })).toBe(true);
    expect(matches({ ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'lf' }, {})).toBe(false);
  });
});

// lfx-self-serve#4694 — LF and non-LF projects by default, as LFX Insights counts; LF projects only is explicit.
describe('Org Lens project scope', () => {
  it('offers LF and non-LF projects first, as the default, then LF projects and Non-LF projects', () => {
    expect(ORG_PROJECT_SCOPE_OPTIONS).toEqual([
      { label: 'LF and non-LF projects', value: 'all' },
      { label: 'LF projects', value: 'lf' },
      { label: 'Non-LF projects', value: 'non_lf' },
    ]);
    expect(DEFAULT_ORG_COMMIT_FILTERS.projectScope).toBe('all');
  });

  it('reads a link without projectScope, or with an unknown one, as LF and non-LF projects', () => {
    expect(read({}).projectScope).toBe('all');
    expect(read({ metric: 'code' })).toEqual({ projectScope: 'all', commitScope: 'all', metric: 'code' });
    expect(read({ projectScope: 'everything' }).projectScope).toBe('all');
  });

  it('round-trips ?projectScope=lf through the URL and drops the all-projects default', () => {
    const lf = read({ projectScope: 'lf' });

    expect(lf).toEqual({ projectScope: 'lf', commitScope: 'all', metric: 'code' });
    const params = orgCommitFiltersUrlParams(lf);
    expect(params).toEqual({ projectScope: 'lf', commitScope: null, metric: null });
    expect(readOrgCommitFilters((name) => params[name])).toEqual(lf);
    expect(orgCommitFiltersUrlParams({ ...lf, projectScope: 'all' }).projectScope).toBeNull();
  });
});
