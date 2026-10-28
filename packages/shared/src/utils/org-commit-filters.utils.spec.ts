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

describe('Org Lens code-count dropdown', () => {
  it('offers All commits, Only main branch commits and All code contributions, defaulting to the default filters', () => {
    expect(ORG_CODE_MEASURE_OPTIONS).toEqual([
      { label: 'All commits', value: 'commits' },
      { label: 'Only main branch commits', value: 'merged' },
      { label: 'All code contributions', value: 'code' },
    ]);
    expect(orgCommitFiltersFor({ projectScope: 'lf', metric: DEFAULT_ORG_CODE_MEASURE })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
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

  it('reads the option from ?metric=, an unknown or missing value as Commits', () => {
    expect(read({ metric: 'merged' })).toEqual({ ...DEFAULT_ORG_COMMIT_FILTERS, commitScope: 'merged' });
    expect(read({ projectScope: 'non_lf', metric: 'code' })).toEqual({ projectScope: 'non_lf', commitScope: 'all', metric: 'code' });
    expect(read({ projectScope: 'LF', metric: 'prs' })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
    expect(read({})).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('reads a legacy commitScope=merged link as Only main branch commits unless it asked for code contributions', () => {
    expect(read({ commitScope: 'merged' })).toEqual({ ...DEFAULT_ORG_COMMIT_FILTERS, commitScope: 'merged' });
    expect(read({ commitScope: 'merged', metric: 'commits' })).toEqual({ ...DEFAULT_ORG_COMMIT_FILTERS, commitScope: 'merged' });
    expect(read({ commitScope: 'merged', metric: 'code' })).toEqual({ ...DEFAULT_ORG_COMMIT_FILTERS, metric: 'code' });
    expect(read({ commitScope: 'main' })).toEqual(DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('writes the option to ?metric=, drops defaults and always drops ?commitScope=', () => {
    expect(orgCommitFiltersUrlParams(DEFAULT_ORG_COMMIT_FILTERS)).toEqual({ projectScope: null, commitScope: null, metric: null });
    expect(orgCommitFiltersUrlParams({ projectScope: 'all', commitScope: 'merged', metric: 'commits' })).toEqual({
      projectScope: 'all',
      commitScope: null,
      metric: 'merged',
    });
    expect(orgCommitFiltersUrlParams({ ...DEFAULT_ORG_COMMIT_FILTERS, metric: 'code' })).toEqual({ projectScope: null, commitScope: null, metric: 'code' });
  });

  it('matches only a URL that already spells the filters canonically', () => {
    const merged: OrgCommitFilters = { ...DEFAULT_ORG_COMMIT_FILTERS, commitScope: 'merged' };
    const matches = (filters: OrgCommitFilters, params: Record<string, string>): boolean => orgCommitFiltersUrlMatches(filters, (name) => params[name]);

    expect(matches(merged, { metric: 'merged', tab: 'contributors' })).toBe(true);
    expect(matches(merged, { commitScope: 'merged' })).toBe(false);
    expect(matches(DEFAULT_ORG_COMMIT_FILTERS, { metric: 'commits' })).toBe(false);
    expect(matches(DEFAULT_ORG_COMMIT_FILTERS, {})).toBe(true);
    expect(matches({ ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'all' }, { projectScope: 'all' })).toBe(true);
    expect(matches({ ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'all' }, {})).toBe(false);
  });
});

// lfx-self-serve#4160 — LF projects by default, so every view counts what the Overview counts; LF and non-LF projects (what Insights counts) is explicit.
describe('Org Lens project scope', () => {
  it('offers LF projects first, as the default, then LF and non-LF projects and Non-LF projects', () => {
    expect(ORG_PROJECT_SCOPE_OPTIONS).toEqual([
      { label: 'LF projects', value: 'lf' },
      { label: 'LF and non-LF projects', value: 'all' },
      { label: 'Non-LF projects', value: 'non_lf' },
    ]);
    expect(DEFAULT_ORG_COMMIT_FILTERS.projectScope).toBe('lf');
  });

  it('reads a link without projectScope, or with an unknown one, as LF projects', () => {
    expect(read({}).projectScope).toBe('lf');
    expect(read({ metric: 'code' })).toEqual({ projectScope: 'lf', commitScope: 'all', metric: 'code' });
    expect(read({ projectScope: 'everything' }).projectScope).toBe('lf');
  });

  it('round-trips ?projectScope=all through the URL and drops the LF default', () => {
    const all = read({ projectScope: 'all' });

    expect(all).toEqual({ projectScope: 'all', commitScope: 'all', metric: 'commits' });
    const params = orgCommitFiltersUrlParams(all);
    expect(params).toEqual({ projectScope: 'all', commitScope: null, metric: null });
    expect(readOrgCommitFilters((name) => params[name])).toEqual(all);
    expect(orgCommitFiltersUrlParams({ ...all, projectScope: 'lf' }).projectScope).toBeNull();
  });
});
