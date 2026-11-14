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

import { MeetupsService } from '../services/meetups.service';
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

describe('MeetupsController filter scopes and errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
  });

  it.each([
    { query: {}, options: { isPast: undefined, registeredOnly: false } },
    { query: { isPast: 'false', registeredOnly: 'true' }, options: { isPast: false, registeredOnly: true } },
    { query: { isPast: 'true', registeredOnly: 'true' }, options: { isPast: true, registeredOnly: false } },
    { query: { isPast: 'invalid', registeredOnly: 'false' }, options: { isPast: undefined, registeredOnly: false } },
    { query: { isPast: ['true'], registeredOnly: ['true'] }, options: { isPast: undefined, registeredOnly: false } },
  ])('forwards the normalized scope for $query', async ({ query, options }) => {
    const spy = vi.spyOn(MeetupsService.prototype, 'getMeetupFilters').mockResolvedValue({ communities: [], roles: [] });
    const req = { query } as never;
    const json = vi.fn();
    const next = vi.fn();
    await new MeetupsController().getMeetupFilters(req, { json } as never, next);
    expect(spy).toHaveBeenCalledWith(req, 'user@example.com', options);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ communities: [], roles: [] });
  });

  it.each(['getMyMeetups', 'getMeetupFilters'] as const)('forwards %s service rejections to next', async (endpoint) => {
    const error = new Error('Service unavailable');
    vi.spyOn(MeetupsService.prototype, endpoint).mockRejectedValueOnce(error);
    const next = vi.fn();
    const json = vi.fn();
    await new MeetupsController()[endpoint]({ query: {} } as never, { json } as never, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(json).not.toHaveBeenCalled();
  });

  it.each(['false', 'true'])('matches padded Community selections with normalized SQL for isPast=%s', async (isPast) => {
    const next = vi.fn();
    await new MeetupsController().getMyMeetups(
      { query: { isPast, community: ' Example Community ', searchQuery: 'Example', role: 'Attendee', status: 'registered' } } as never,
      { json: vi.fn() } as never,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('AND TRIM(COMMUNITY) = ?');
    expect(sql).toContain(isPast === 'true' ? 'OCG_PAST_MEETUPS' : 'OCG_UPCOMING_MEETUPS');
    expect(binds).toEqual(['user@example.com', '%Example%', 'Example Community', ',Attendee,']);
    expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
  });
});

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
