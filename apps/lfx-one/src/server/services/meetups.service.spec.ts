// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { GetMyMeetupsOptions, GetMeetupFiltersOptions } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));

import { MeetupsService } from './meetups.service';

describe('MeetupsService', () => {
  let service: MeetupsService;
  const email = 'member@example.com';
  const request = {} as never;
  const options: GetMyMeetupsOptions = { isPast: false, pageSize: 10, offset: 0, sortOrder: 'ASC' };

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    service = new MeetupsService();
  });

  it.each([1, 10])('propagates upcoming registered-only failures at pageSize=%s', async (pageSize) => {
    const error = new Error('Snowflake unavailable');
    execute.mockRejectedValueOnce(error);
    await expect(service.getMyMeetups(request, email, { ...options, pageSize, status: 'registered' })).rejects.toBe(error);
  });

  it.each([{ isPast: false }, { isPast: false, status: 'not-registered' as const }, { isPast: true, status: 'registered' as const }])(
    'preserves the empty fallback for %j',
    async (scope) => {
      execute.mockRejectedValueOnce(new Error('Snowflake unavailable'));
      await expect(service.getMyMeetups(request, email, { ...options, ...scope })).resolves.toEqual({ data: [], total: 0, pageSize: 10, offset: 0 });
    }
  );

  it('returns a confirmed zero when the registered query succeeds without rows', async () => {
    await expect(service.getMyMeetups(request, email, { ...options, status: 'registered' })).resolves.toEqual({ data: [], total: 0, pageSize: 10, offset: 0 });
  });

  it.each([{ isPast: true }, { registeredOnly: true }, { isPast: true, registeredOnly: true }])(
    'scopes communities while keeping roles global for %j',
    async (scope) => {
      execute.mockImplementation(async (sql: string) => ({
        rows: sql.includes('OCG_MEETUPS_FILTERS') ? [{ FILTER_NAME: 'role', FILTER_VALUE: 'Attendee' }] : [{ COMMUNITY: ' Example Community ' }],
      }));
      // Preserve nonblank values so selecting an option still matches the list's raw COMMUNITY predicate.
      await expect(service.getMeetupFilters(request, email, scope)).resolves.toEqual({ communities: [' Example Community '], roles: ['Attendee'] });
      expect(execute).toHaveBeenCalledTimes(2);
      const communityCall = execute.mock.calls.find(([sql]) => !sql.includes('OCG_MEETUPS_FILTERS'))!;
      expect(communityCall[1]).toEqual([email]);
      expect(communityCall[0]).toContain('SELECT DISTINCT');
      if (scope.isPast) {
        expect(communityCall[0]).toContain('OCG_PAST_MEETUPS');
        expect(communityCall[0]).toContain('WHERE EMAIL = ?');
        expect(communityCall[0]).toContain("AND NULLIF(TRIM(COMMUNITY), '') IS NOT NULL");
        expect(communityCall[0]).toContain('SELECT DISTINCT COMMUNITY');
      } else {
        expect(communityCall[0]).toContain('OCG_UPCOMING_MEETUPS');
        expect(communityCall[0]).toContain('OCG_UPCOMING_MEETUPS_ROLES');
        expect(communityCall[0]).toContain('r.EMAIL = ?');
        expect(communityCall[0]).toContain('r.EVENT_ID = m.EVENT_ID');
        expect(communityCall[0]).toContain("WHERE NULLIF(TRIM(m.COMMUNITY), '') IS NOT NULL");
        expect(communityCall[0]).toContain('SELECT DISTINCT m.COMMUNITY');
      }
      const roleCall = execute.mock.calls.find(([sql]) => sql.includes('OCG_MEETUPS_FILTERS'))!;
      expect(roleCall[0]).toContain("FILTER_NAME = 'role'");
      expect(roleCall[1]).toEqual([]);
      for (const [sql, binds] of execute.mock.calls) expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
    }
  );

  it('uses only the global catalog without a scope', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { FILTER_NAME: 'community', FILTER_VALUE: 'Global Community' },
        { FILTER_NAME: 'role', FILTER_VALUE: 'Speaker' },
      ],
    });
    await expect(service.getMeetupFilters(request, email, {})).resolves.toEqual({ communities: ['Global Community'], roles: ['Speaker'] });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('OCG_MEETUPS_FILTERS');
    expect(binds).toEqual([]);
    expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
  });

  it.each([{ isPast: true }, { registeredOnly: true }] satisfies GetMeetupFiltersOptions[])('propagates scoped filter failures for %j', async (scope) => {
    const error = new Error('Snowflake unavailable');
    execute.mockRejectedValue(error);
    await expect(service.getMeetupFilters(request, email, scope)).rejects.toBe(error);
  });

  it('preserves the empty fallback for global filter failures', async () => {
    execute.mockRejectedValueOnce(new Error('Snowflake unavailable'));
    await expect(service.getMeetupFilters(request, email, {})).resolves.toEqual({ communities: [], roles: [] });
  });
});
