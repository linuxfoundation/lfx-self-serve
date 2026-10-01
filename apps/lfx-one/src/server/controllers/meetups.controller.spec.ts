// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MAX_MEETUPS_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../services/snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: () => 'user@example.com' }));

import { MeetupsController } from './meetups.controller';

async function limitAndOffsetFor(query: Record<string, unknown>): Promise<{ limit: string; offset: string }> {
  const next = vi.fn();
  await new MeetupsController().getMyMeetups({ query } as never, { json: vi.fn() } as never, next);

  expect(next).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
  const sql = execute.mock.calls[0][0] as string;
  const match = sql.match(/LIMIT\s+(\S+)\s+OFFSET\s+(\S+)/);
  expect(match, sql).not.toBeNull();
  return { limit: match![1], offset: match![2] };
}

const hostileQueries: Record<string, unknown>[] = [
  { offset: '9999999999999999999999999' },
  { offset: '999999999999999999999' },
  { offset: '99999999999999999999' },
  { offset: '9223372036854775808' },
  { offset: '1e25' },
  { offset: '1e309' },
  { offset: 'Infinity' },
  { offset: '-Infinity' },
  { offset: '-1' },
  { offset: '-1e25' },
  { offset: 'NaN' },
  { offset: '0x7fffffffffffffffff' },
  { offset: '12.9' },
  { offset: ['9999999999999999999999999'] },
  { offset: ['1', '2'] },
  { offset: { a: '1' } },
  { offset: '9999999999999999999999999', pageSize: '100' },
  { offset: '9999999999999999999999999', pageSize: '1e25' },
  { offset: '9999999999999999999999999', pageSize: '100.9' },
  { offset: '9999999999999999999999999', isPast: 'true' },
  { offset: '9999999999999999999999999', isPast: 'true', pageSize: '100' },
];

describe('MeetupsController.getMyMeetups pagination literals', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
  });

  it.each(hostileQueries)('interpolates a bounded plain-integer LIMIT/OFFSET for %j', async (query) => {
    const { limit, offset } = await limitAndOffsetFor(query);

    expect(limit).toMatch(/^\d+$/);
    expect(Number(limit)).toBeGreaterThan(0);
    expect(Number(limit)).toBeLessThanOrEqual(MAX_MEETUPS_PAGE_SIZE);
    expect(offset).toMatch(/^\d+$/);
    expect(Number(offset)).toBeLessThanOrEqual(MAX_SNOWFLAKE_PAGINATION_PAGE * MAX_MEETUPS_PAGE_SIZE);
  });
});
