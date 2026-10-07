// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MEETUPS_DISCOVERABLE_UPCOMING_LIMIT } from '@lfx-one/shared/constants';
import { GetMyMeetupsOptions, GetMeetupFiltersOptions, MeetupRow, MeetupStatusFilter } from '@lfx-one/shared/interfaces';
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
  const emails = ['alpha.member@example.com', 'Beta.Member@Example.com'];
  const row: MeetupRow = {
    EVENT_ID: 'example-event',
    STARTS_AT: '2026-11-01T12:00:00Z',
    EVENT_NAME: 'Example Meetup',
    COMMUNITY: 'Example Community',
    DATE: 'November 1, 2026',
    LOCATION: 'Online',
    ROLES: 'Attendee',
    GROUP_SLUG: 'example-group',
    EVENT_SLUG: 'example-meetup',
    TOTAL_RECORDS: 2,
  };

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

  it.each([1, 10])('returns a confirmed zero when the registered query succeeds without rows at pageSize=%s', async (pageSize) => {
    await expect(service.getMyMeetups(request, 'nobody@example.com', { ...options, pageSize, status: 'registered' })).resolves.toEqual({
      data: [],
      total: 0,
      pageSize,
      offset: 0,
    });
    expect(execute.mock.calls[0][1]).toEqual(['nobody@example.com']);
  });

  // Mocked rows verify SQL/bind contracts and mapping; live Snowflake checks prove email matching.
  it.each(emails)('preserves upcoming query contracts and bound email casing for %s', async (callerEmail) => {
    for (const status of [undefined, 'registered', 'not-registered'] satisfies (MeetupStatusFilter | undefined)[]) {
      execute.mockClear();
      await service.getMyMeetups(request, callerEmail, {
        ...options,
        status,
        searchQuery: 'Example',
        community: 'Example Community',
        role: 'Speaker',
        sortField: 'EVENT_NAME',
        sortOrder: 'DESC',
        pageSize: 3,
        offset: 6,
      });
      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('ON LOWER(r.EMAIL) = LOWER(?)');
      expect(sql).toContain('AND r.EVENT_ID = m.EVENT_ID');
      expect(sql).toContain('AND EVENT_NAME ILIKE ?');
      expect(sql).toContain('AND TRIM(COMMUNITY) = ?');
      expect(sql).toContain("AND POSITION(? IN CONCAT(',', REPLACE(ROLES, ', ', ','), ',')) > 0");
      expect(binds).toEqual([callerEmail, '%Example%', 'Example Community', ',Speaker,']);
      expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
      expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY STARTS_AT ASC, EVENT_ID ASC)');
      expect(sql).toContain(`WHERE UPCOMING_RANK <= ${MEETUPS_DISCOVERABLE_UPCOMING_LIMIT}`);
      expect(sql).toContain('OR ROLES IS NOT NULL');
      expect(sql).toContain('COUNT(*) OVER() AS TOTAL_RECORDS');
      expect(sql).toContain('ORDER BY EVENT_NAME DESC, EVENT_ID DESC');
      expect(sql).toContain('LIMIT 3 OFFSET 6');
      if (status === 'registered') {
        expect(sql).toContain('AND ROLES IS NOT NULL');
      } else if (status === 'not-registered') {
        expect(sql).toContain('AND ROLES IS NULL');
      } else {
        expect(sql).not.toContain('AND ROLES IS NOT NULL');
        expect(sql).not.toContain('AND ROLES IS NULL');
      }
    }
  });

  it.each(emails)('preserves past query contracts and bound email casing for %s', async (callerEmail) => {
    await service.getMyMeetups(request, callerEmail, {
      ...options,
      isPast: true,
      status: 'not-registered',
      searchQuery: 'Example',
      community: 'Example Community',
      role: 'Speaker',
      sortField: 'COMMUNITY',
      sortOrder: 'DESC',
      pageSize: 3,
      offset: 6,
    });
    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('FROM ');
    expect(sql).toContain('OCG_PAST_MEETUPS');
    expect(sql).toContain('WHERE LOWER(EMAIL) = LOWER(?)');
    expect(sql).toContain('AND EVENT_NAME ILIKE ?');
    expect(sql).toContain('AND TRIM(COMMUNITY) = ?');
    expect(sql).toContain("AND POSITION(? IN CONCAT(',', REPLACE(ROLES, ', ', ','), ',')) > 0");
    expect(binds).toEqual([callerEmail, '%Example%', 'Example Community', ',Speaker,']);
    expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
    expect(sql).toContain('COUNT(*) OVER() AS TOTAL_RECORDS');
    expect(sql).toContain('ORDER BY COMMUNITY DESC, EVENT_ID DESC');
    expect(sql).toContain('LIMIT 3 OFFSET 6');
    expect(sql).not.toContain('OCG_UPCOMING_MEETUPS');
    expect(sql).not.toContain('ROLES IS NULL');
  });

  it.each(emails)('keeps registered probe and list totals consistent for %s', async (callerEmail) => {
    execute.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [row, { ...row, EVENT_ID: 'example-event-2' }] });
    const probe = await service.getMyMeetups(request, callerEmail, { ...options, status: 'registered', pageSize: 1 });
    const list = await service.getMyMeetups(request, callerEmail, { ...options, status: 'registered' });
    expect(probe.total).toBe(2);
    expect(list.total).toBe(probe.total);
    expect(probe.data).toHaveLength(1);
    expect(list.data).toHaveLength(2);
    expect(list.data.every((meetup) => meetup.status === 'Registered' && meetup.role === 'Attendee')).toBe(true);
    for (const [sql, binds] of execute.mock.calls) {
      expect(sql).toContain('ON LOWER(r.EMAIL) = LOWER(?)');
      expect(sql).toContain('AND ROLES IS NOT NULL');
      expect(sql).toContain('COUNT(*) OVER() AS TOTAL_RECORDS');
      expect(sql).toContain('ORDER BY STARTS_AT ASC, EVENT_ID ASC');
      expect(binds).toEqual([callerEmail]);
      expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
    }
    expect(execute.mock.calls[0][0]).toContain('LIMIT 1 OFFSET 0');
    expect(execute.mock.calls[1][0]).toContain('LIMIT 10 OFFSET 0');
  });

  it('preserves unregistered mapping and drops malformed rows without changing the window total', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { ...row, ROLES: null },
        { ...row, EVENT_ID: '' },
      ],
    });
    const response = await service.getMyMeetups(request, email, options);
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({ id: row.EVENT_ID, status: 'Not Registered', role: '', startDate: '2026-11-01T12:00:00.000Z' });
  });

  it.each(
    emails.flatMap((callerEmail) =>
      [{ isPast: true }, { registeredOnly: true }, { isPast: true, registeredOnly: true }].map((scope) => ({ callerEmail, scope }))
    )
  )('scopes communities while keeping roles global for $callerEmail / $scope', async ({ callerEmail, scope }) => {
    execute.mockImplementation(async (sql: string) => ({
      rows: sql.includes('OCG_MEETUPS_FILTERS') ? [{ FILTER_NAME: 'role', FILTER_VALUE: 'Attendee' }] : [{ COMMUNITY: 'Example Community' }],
    }));
    await expect(service.getMeetupFilters(request, callerEmail, scope)).resolves.toEqual({ communities: ['Example Community'], roles: ['Attendee'] });
    expect(execute).toHaveBeenCalledTimes(2);
    const communityCall = execute.mock.calls.find(([sql]) => !sql.includes('OCG_MEETUPS_FILTERS'))!;
    expect(communityCall[1]).toEqual([callerEmail]);
    expect(communityCall[0]).toContain('SELECT DISTINCT');
    if (scope.isPast) {
      expect(communityCall[0]).toContain('OCG_PAST_MEETUPS');
      expect(communityCall[0]).toContain('WHERE LOWER(EMAIL) = LOWER(?)');
      expect(communityCall[0]).not.toContain('OCG_UPCOMING_MEETUPS');
      expect(communityCall[0]).toContain("AND NULLIF(TRIM(COMMUNITY), '') IS NOT NULL");
      expect(communityCall[0]).toContain('SELECT DISTINCT TRIM(COMMUNITY) AS COMMUNITY');
    } else {
      expect(communityCall[0]).toContain('OCG_UPCOMING_MEETUPS');
      expect(communityCall[0]).toContain('OCG_UPCOMING_MEETUPS_ROLES');
      expect(communityCall[0]).toContain('ON LOWER(r.EMAIL) = LOWER(?)');
      expect(communityCall[0]).toContain('r.EVENT_ID = m.EVENT_ID');
      expect(communityCall[0]).toContain("WHERE NULLIF(TRIM(m.COMMUNITY), '') IS NOT NULL");
      expect(communityCall[0]).toContain('SELECT DISTINCT TRIM(m.COMMUNITY) AS COMMUNITY');
    }
    const roleCall = execute.mock.calls.find(([sql]) => sql.includes('OCG_MEETUPS_FILTERS'))!;
    expect(communityCall[0]).toContain('ORDER BY COMMUNITY');
    expect(roleCall[0]).toContain("FILTER_NAME = 'role'");
    expect(roleCall[1]).toEqual([]);
    for (const [sql, binds] of execute.mock.calls) expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
  });

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
