// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this
// app's vitest config, so every runtime (non-type-only) import needs a stub. Option lists and caps
// mirror `social-listening.constants.ts`; the akrites entries are only here because
// `validation.helper` — the real module, since `getValidatedPeriod` is part of the behavior under
// test — derives them at module scope.
vi.mock('@lfx-one/shared/constants', () => ({
  MENTION_SENTIMENT_OPTIONS: [
    { label: 'All', value: 'all' },
    { label: 'Positive', value: 'positive' },
    { label: 'Neutral', value: 'neutral' },
    { label: 'Negative', value: 'negative' },
  ],
  MENTION_RELEVANCE_OPTIONS: [
    { label: 'All', value: 'all' },
    { label: 'High', value: 'high' },
    { label: 'Low', value: 'low' },
  ],
  MENTION_HAS_TITLE_OPTIONS: [
    { label: 'All', value: 'all' },
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
  ],
  SOCIAL_LISTENING_MAX_FILTER_VALUES: 200,
  SOCIAL_LISTENING_MAX_MENTION_IDS: 500,
  SOCIAL_LISTENING_SERVER_PAGE_SIZE: 100,
  MONTH_FORMAT_REGEX: /^\d{4}-(0[1-9]|1[0-2])$/,
  AKRITES_STEWARD_ROLE_OPTIONS: [],
  AKRITES_ESCALATION_PATHS: [],
  AKRITES_INACTIVE_REASON_OPTIONS: [],
}));

// Period resolution is stubbed so the assertions don't move with the wall clock. `endDate` is
// exclusive and both bounds are month-aligned, matching the real `resolvePeriodRange()`.
const RANGES: Record<string, { type: string; startDate: string; endDate: string; label: string }> = {
  ytd: { type: 'ytd', startDate: '2026-01-01', endDate: '2026-08-01', label: 'YTD' },
  '2026-03': { type: 'month', startDate: '2026-03-01', endDate: '2026-04-01', label: 'Mar 2026' },
  '2020-01': { type: 'month', startDate: '2020-01-01', endDate: '2020-02-01', label: 'Jan 2020' },
  '2026-07': { type: 'month', startDate: '2026-07-01', endDate: '2026-08-01', label: 'Jul 2026' },
};

vi.mock('@lfx-one/shared/utils', () => ({
  resolvePeriodRange: (period: string) => RANGES[period] ?? null,
  /** The client's own default — the previous complete calendar month. */
  getDefaultMarketingImpactPeriod: () => '2026-07',
}));

const { ServiceValidationError } = await import('../errors');
const {
  parseFoundationSlug,
  parseSocialListeningAuthorFilters,
  parseSocialListeningFilters,
  parseSocialListeningLimit,
  parseSocialListeningPagination,
  parseSocialListeningScope,
} = await import('./social-listening-params.helper');

const OPERATION = 'get_social_listening_test';

function request(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

describe('parseFoundationSlug', () => {
  it('returns a well-formed slug', () => {
    expect(parseFoundationSlug(request({ foundationSlug: 'cncf-projects' }), OPERATION)).toBe('cncf-projects');
  });

  it.each([
    { label: 'a missing slug', query: {} },
    { label: 'an empty slug', query: { foundationSlug: '' } },
    { label: 'a repeated slug param', query: { foundationSlug: ['cncf', 'lfai'] } },
    { label: 'an uppercased slug', query: { foundationSlug: 'CNCF' } },
    { label: 'a slug with a space', query: { foundationSlug: 'cn cf' } },
    { label: 'a slug with a wildcard', query: { foundationSlug: 'cncf%' } },
    { label: 'an over-long slug', query: { foundationSlug: 'c'.repeat(201) } },
  ])('rejects $label', ({ query }) => {
    expect(() => parseFoundationSlug(request(query), OPERATION)).toThrow(ServiceValidationError);
    expect(() => parseFoundationSlug(request(query), OPERATION)).toThrow(/foundationSlug/);
  });
});

describe('parseSocialListeningScope', () => {
  it('resolves the requested period into a half-open window', () => {
    const scope = parseSocialListeningScope(request({ foundationSlug: 'cncf', period: '2026-03' }), OPERATION);

    expect(scope).toEqual({
      foundationSlug: 'cncf',
      startDate: '2026-03-01',
      endDate: '2026-04-01',
      sourceProjectId: undefined,
      platform: undefined,
    });
  });

  it('falls back to the previous calendar month when the client omits the period', () => {
    const scope = parseSocialListeningScope(request({ foundationSlug: 'cncf' }), OPERATION);

    expect(scope.startDate).toBe('2026-07-01');
    expect(scope.endDate).toBe('2026-08-01');
  });

  it('still honors the legacy `month` param', () => {
    const scope = parseSocialListeningScope(request({ foundationSlug: 'cncf', month: '2020-01' }), OPERATION);

    expect(scope.startDate).toBe('2020-01-01');
  });

  it('rejects an unknown period token', () => {
    expect(() => parseSocialListeningScope(request({ foundationSlug: 'cncf', period: 'last-99' }), OPERATION)).toThrow(/period/);
  });

  it('carries the two scope selects through', () => {
    const scope = parseSocialListeningScope(request({ foundationSlug: 'cncf', period: 'ytd', source_project_id: 'proj-1', platform: 'Reddit' }), OPERATION);

    expect(scope.sourceProjectId).toBe('proj-1');
    // Case is preserved here; the service lowercases the platform when it binds it.
    expect(scope.platform).toBe('Reddit');
  });

  it.each(['all', '', '   '])('normalizes a "%s" scope select to no filter', (value) => {
    const scope = parseSocialListeningScope(request({ foundationSlug: 'cncf', period: 'ytd', source_project_id: value, platform: value }), OPERATION);

    expect(scope.sourceProjectId).toBeUndefined();
    expect(scope.platform).toBeUndefined();
  });

  it('rejects an over-long scope select', () => {
    expect(() => parseSocialListeningScope(request({ foundationSlug: 'cncf', period: 'ytd', platform: 'p'.repeat(201) }), OPERATION)).toThrow(/platform/);
  });
});

describe('parseSocialListeningFilters', () => {
  it('normalizes an unfiltered request to no predicates at all', () => {
    expect(parseSocialListeningFilters(request({}), OPERATION)).toEqual({
      sentiment: undefined,
      relevance: undefined,
      hasTitle: undefined,
      language: undefined,
      search: undefined,
      keywords: undefined,
      tags: undefined,
      authors: undefined,
      mentionIds: undefined,
    });
  });

  it.each([
    { field: 'sentiment', value: 'positive' },
    { field: 'relevance', value: 'high' },
    { field: 'has_title', value: 'yes' },
  ])('accepts a whitelisted $field value', ({ field, value }) => {
    const filters = parseSocialListeningFilters(request({ [field]: value }), OPERATION) as Record<string, unknown>;

    expect(Object.values(filters)).toContain(value);
  });

  it.each([
    { field: 'sentiment', value: 'furious' },
    { field: 'relevance', value: 'medium' },
    { field: 'has_title', value: 'maybe' },
  ])('rejects an off-whitelist $field value', ({ field, value }) => {
    expect(() => parseSocialListeningFilters(request({ [field]: value }), OPERATION)).toThrow(new RegExp(field));
  });

  it.each(['sentiment', 'relevance', 'has_title'])('treats %s=all as no predicate', (field) => {
    const filters = parseSocialListeningFilters(request({ [field]: 'all' }), OPERATION) as Record<string, unknown>;

    expect(Object.values(filters).every((value) => value === undefined)).toBe(true);
  });

  it('reads repeated query keys as a list and trims each value', () => {
    const filters = parseSocialListeningFilters(request({ tags: ['  release ', 'security', ' '] }), OPERATION);

    expect(filters.tags).toEqual(['release', 'security']);
  });

  it('reads a single occurrence as a one-element list', () => {
    expect(parseSocialListeningFilters(request({ keywords: 'kubernetes' }), OPERATION).keywords).toEqual(['kubernetes']);
  });

  it('preserves a present-but-empty id list — the service reads it as "nothing selected"', () => {
    expect(parseSocialListeningFilters(request({ mention_ids: [] }), OPERATION).mentionIds).toEqual([]);
  });

  it.each([
    { field: 'keywords', cap: 200 },
    { field: 'tags', cap: 200 },
    { field: 'authors', cap: 200 },
    { field: 'mention_ids', cap: 500 },
  ])('rejects rather than truncates an over-cap $field list', ({ field, cap }) => {
    const atCap = Array.from({ length: cap }, (_, index) => `v${index}`);

    expect(() => parseSocialListeningFilters(request({ [field]: atCap }), OPERATION)).not.toThrow();
    expect(() => parseSocialListeningFilters(request({ [field]: [...atCap, 'one-too-many'] }), OPERATION)).toThrow(new RegExp(field));
  });

  it('rejects an over-long value inside a list', () => {
    expect(() => parseSocialListeningFilters(request({ tags: ['ok', 't'.repeat(201)] }), OPERATION)).toThrow(/tags/);
  });

  it('gives the search term more room than a single-token filter', () => {
    expect(parseSocialListeningFilters(request({ search: 's'.repeat(500) }), OPERATION).search).toHaveLength(500);
    expect(() => parseSocialListeningFilters(request({ search: 's'.repeat(501) }), OPERATION)).toThrow(/search/);
  });
});

describe('parseSocialListeningAuthorFilters', () => {
  it('omits authors and mention ids by construction — a multiselect must not filter its own options', () => {
    const filters = parseSocialListeningAuthorFilters(request({ authors: ['@lf'], mention_ids: ['a'], sentiment: 'negative' }), OPERATION);

    expect(filters).not.toHaveProperty('authors');
    expect(filters).not.toHaveProperty('mentionIds');
    expect(filters.sentiment).toBe('negative');
  });
});

describe('parseSocialListeningPagination', () => {
  it('defaults to the first full server window', () => {
    expect(parseSocialListeningPagination(request({}), OPERATION)).toEqual({ limit: 100, offset: 0 });
  });

  it.each([
    { label: 'a limit above the server window', query: { limit: '500' }, expected: { limit: 100, offset: 0 } },
    { label: 'a zero limit', query: { limit: '0' }, expected: { limit: 1, offset: 0 } },
    { label: 'a negative offset', query: { offset: '-20' }, expected: { limit: 100, offset: 0 } },
    { label: 'an offset past the scan ceiling', query: { offset: '999999' }, expected: { limit: 100, offset: 100000 } },
    { label: 'blank values', query: { limit: '', offset: '' }, expected: { limit: 100, offset: 0 } },
  ])('clamps $label', ({ query, expected }) => {
    expect(parseSocialListeningPagination(request(query), OPERATION)).toEqual(expected);
  });

  it('passes an in-range window through untouched', () => {
    expect(parseSocialListeningPagination(request({ limit: '20', offset: '40' }), OPERATION)).toEqual({ limit: 20, offset: 40 });
  });

  it.each([{ limit: 'abc' }, { limit: '10.5' }, { offset: 'NaN' }])('rejects a non-integer window bound (%o)', (query) => {
    expect(() => parseSocialListeningPagination(request(query), OPERATION)).toThrow(ServiceValidationError);
  });
});

describe('parseSocialListeningLimit', () => {
  it('returns undefined when the caller omits the limit, so the service applies its own default', () => {
    expect(parseSocialListeningLimit(request({}), OPERATION)).toBeUndefined();
  });

  it.each([
    { raw: '5', expected: 5 },
    { raw: '999', expected: 100 },
    { raw: '0', expected: 1 },
  ])('clamps a requested limit of $raw to $expected', ({ raw, expected }) => {
    expect(parseSocialListeningLimit(request({ limit: raw }), OPERATION)).toBe(expected);
  });

  it('rejects a non-integer limit', () => {
    expect(() => parseSocialListeningLimit(request({ limit: '7.5' }), OPERATION)).toThrow(/limit/);
  });
});
