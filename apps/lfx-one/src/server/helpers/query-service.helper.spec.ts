// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for fetchAllQueryResources (#4964) — pins multi-page aggregation and the pagination
// bound: a repeated page_token or a chain longer than QUERY_SERVICE_MAX_PAGES stops the drain
// (strict callers throw, others keep partial rows), while maxResults keeps its early stop.

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QUERY_SERVICE_MAX_PAGES } from '@lfx-one/shared/constants';
import type { QueryServiceResponse } from '@lfx-one/shared/interfaces';

vi.mock('../services/logger.service', () => ({
  logger: {
    debug: vi.fn(),
    warning: vi.fn(),
  },
}));

import { logger } from '../services/logger.service';
import { fetchAllQueryResources } from './query-service.helper';

interface Row {
  id: number;
}

const page = (ids: number[], pageToken?: string): QueryServiceResponse<Row> => ({
  resources: ids.map((id) => ({ type: 'test_row', id: `test_row:${id}`, data: { id } })),
  ...(pageToken && { page_token: pageToken }),
});

describe('fetchAllQueryResources', () => {
  const req = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const capWarnings = () => vi.mocked(logger.warning).mock.calls.filter(([, , message]) => String(message).startsWith('Pagination stopped early'));

  it('aggregates every page and stops when no token is returned', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1], 't1'))
      .mockResolvedValueOnce(page([2], 't2'))
      .mockResolvedValueOnce(page([3]));

    const rows = await fetchAllQueryResources<Row>(req, fetchPage);

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls).toEqual([[], ['t1'], ['t2']]);
    expect(capWarnings()).toHaveLength(0);
  });

  it('returns the rows fetched so far on a repeated token when not strict', async () => {
    const onPartial = vi.fn();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1], 'same'))
      .mockResolvedValue(page([2], 'same'));

    const rows = await fetchAllQueryResources<Row>(req, fetchPage, { onPartial });

    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(capWarnings()).toHaveLength(1);
    expect(capWarnings()[0][3]).toMatchObject({ reason: 'repeated_page_token', page: 2, accumulated_count: 2 });
  });

  it('rejects with QUERY_SERVICE_PAGINATION_LIMIT on a repeated token when strict', async () => {
    const onPartial = vi.fn();
    const fetchPage = vi.fn().mockResolvedValue(page([1], 'same'));

    await expect(fetchAllQueryResources<Row>(req, fetchPage, { failOnPartial: true, onPartial })).rejects.toMatchObject({
      code: 'QUERY_SERVICE_PAGINATION_LIMIT',
      statusCode: 502,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('stops after QUERY_SERVICE_MAX_PAGES fetches of always-fresh tokens when not strict', async () => {
    const onPartial = vi.fn();
    let calls = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      calls++;
      return page([calls], `token-${calls}`);
    });

    const rows = await fetchAllQueryResources<Row>(req, fetchPage, { onPartial });

    expect(fetchPage).toHaveBeenCalledTimes(QUERY_SERVICE_MAX_PAGES);
    expect(rows).toHaveLength(QUERY_SERVICE_MAX_PAGES);
    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(capWarnings()[0][3]).toMatchObject({ reason: 'max_pages', page: QUERY_SERVICE_MAX_PAGES, max_pages: QUERY_SERVICE_MAX_PAGES });
  });

  it('rejects after QUERY_SERVICE_MAX_PAGES fetches of always-fresh tokens when strict', async () => {
    let calls = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      calls++;
      return page([calls], `token-${calls}`);
    });

    await expect(fetchAllQueryResources<Row>(req, fetchPage, { failOnPartial: true })).rejects.toMatchObject({
      code: 'QUERY_SERVICE_PAGINATION_LIMIT',
    });
    expect(fetchPage).toHaveBeenCalledTimes(QUERY_SERVICE_MAX_PAGES);
  });

  it('still stops early on maxResults without a cap warning', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], 't1'))
      .mockResolvedValueOnce(page([3, 4], 't2'))
      .mockResolvedValue(page([5], 't3'));

    const rows = await fetchAllQueryResources<Row>(req, fetchPage, { maxResults: 3 });

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(capWarnings()).toHaveLength(0);
  });
});
