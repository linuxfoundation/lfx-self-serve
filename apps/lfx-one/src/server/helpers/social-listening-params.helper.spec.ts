// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared barrels transitively reach Angular's partially-compiled @angular/common; under vitest
// that needs the JIT compiler, so load it before the module under test (mirrors the middleware spec).
import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';
import { parseFoundationSlug, parseSocialListeningFilters, parseSocialListeningPagination, parseSocialListeningScope } from './social-listening-params.helper';

const reqWith = (query: Record<string, unknown>): Request => ({ query }) as unknown as Request;

const catchValidation = (fn: () => unknown): ServiceValidationError | undefined => {
  try {
    fn();
  } catch (error) {
    return error as ServiceValidationError;
  }
  return undefined;
};

const expectFieldError = (fn: () => unknown, field: string): void => {
  const error = catchValidation(fn);
  expect(error).toBeInstanceOf(ServiceValidationError);
  expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  expect(error?.validationErrors[0]).toMatchObject({ field });
};

describe('parseFoundationSlug', () => {
  it('400s when foundationSlug is missing', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({}), 'op'), 'foundationSlug');
  });

  it('400s when the slug has characters outside [a-z0-9-]', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({ foundationSlug: 'LF_Project' }), 'op'), 'foundationSlug');
  });

  it('400s past the 64-character cache-key ceiling', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({ foundationSlug: 'a'.repeat(65) }), 'op'), 'foundationSlug');
  });

  it('returns a valid slug unchanged', () => {
    expect(parseFoundationSlug(reqWith({ foundationSlug: 'linux-foundation' }), 'op')).toBe('linux-foundation');
  });
});

describe('parseSocialListeningScope', () => {
  describe('period window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-08-18T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults to year-to-date ending at tomorrow (UTC) — the exclusive bound that includes today', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-08-19');
    });

    it('resolves an explicit period=ytd to the same through-today window as the default', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'ytd' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-08-19');
    });

    it('stays non-empty in January — the month-bounded ytd preset would collapse to [Jan 1, Jan 1)', () => {
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'ytd' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-01-16');
    });

    it('passes an explicit month through the resolved range untouched', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: '2025-07' }), 'op');

      expect(scope.startDate).toBe('2025-07-01');
      expect(scope.endDate).toBe('2025-08-01');
    });

    it('400s an unresolvable period value', () => {
      expectFieldError(() => parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'bogus' }), 'op'), 'period');
    });
  });

  it.each(['all', 'ALL', 'All'])('treats platform=%s as no predicate', (platform) => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', platform }), 'op');

    expect(scope.platform).toBeUndefined();
  });

  it('treats sourceProjectId=ALL as no predicate', () => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', sourceProjectId: 'ALL' }), 'op');

    expect(scope.sourceProjectId).toBeUndefined();
  });

  it('passes a real platform value through verbatim', () => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', platform: 'bluesky' }), 'op');

    expect(scope.platform).toBe('bluesky');
  });
});

describe('parseSocialListeningFilters', () => {
  it.each(['sentiment', 'relevance', 'hasTitle'])('400s an out-of-whitelist %s value', (name) => {
    expectFieldError(() => parseSocialListeningFilters(reqWith({ [name]: 'bogus' }), 'op'), name);
  });

  it('normalizes enum value "all" to undefined (no predicate)', () => {
    expect(parseSocialListeningFilters(reqWith({ sentiment: 'all' }), 'op').sentiment).toBeUndefined();
  });

  it('still 400s enum value "ALL" — the whitelist itself stays case-sensitive', () => {
    expectFieldError(() => parseSocialListeningFilters(reqWith({ sentiment: 'ALL' }), 'op'), 'sentiment');
  });

  it.each(['keywords', 'tags', 'authors'])('400s over 200 %s values', (name) => {
    const values = Array.from({ length: 201 }, (_, i) => `value-${i}`);

    expectFieldError(() => parseSocialListeningFilters(reqWith({ [name]: values }), 'op'), name);
  });

  it('400s over 500 mentionIds values', () => {
    const mentionIds = Array.from({ length: 501 }, (_, i) => `mention-${i}`);

    expectFieldError(() => parseSocialListeningFilters(reqWith({ mentionIds }), 'op'), 'mentionIds');
  });

  it('400s a single value past the 200-character cap', () => {
    expectFieldError(() => parseSocialListeningFilters(reqWith({ keywords: ['a'.repeat(201)] }), 'op'), 'keywords');
  });

  it('400s a search term past 500 characters', () => {
    expectFieldError(() => parseSocialListeningFilters(reqWith({ search: 'a'.repeat(501) }), 'op'), 'search');
  });

  it.each([['mentionIds'], ['keywords']])('normalizes a bare &%s= to undefined instead of an empty list', (name) => {
    const filters = parseSocialListeningFilters(reqWith({ [name]: '' }), 'op') as Record<string, unknown>;

    expect(filters[name]).toBeUndefined();
  });

  it('keeps a repeated-key list as parsed values', () => {
    expect(parseSocialListeningFilters(reqWith({ tags: ['ai', 'linux'] }), 'op').tags).toEqual(['ai', 'linux']);
  });
});

describe('parseSocialListeningPagination', () => {
  it('defaults to the first server window', () => {
    expect(parseSocialListeningPagination(reqWith({}), 'op')).toEqual({ limit: 100, offset: 0 });
  });

  it.each(['abc', '1.5'])('400s a non-integer limit=%s', (limit) => {
    expectFieldError(() => parseSocialListeningPagination(reqWith({ limit }), 'op'), 'limit');
  });

  it('clamps limit=0 up to the 1 minimum', () => {
    expect(parseSocialListeningPagination(reqWith({ limit: '0' }), 'op').limit).toBe(1);
  });

  it('clamps an offset past the 100,000 ceiling', () => {
    expect(parseSocialListeningPagination(reqWith({ offset: '100001' }), 'op').offset).toBe(100_000);
  });
});
