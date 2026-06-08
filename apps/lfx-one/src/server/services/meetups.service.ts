// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_MEETUP_SORT_FIELD,
  MEETUPS_DEFAULT_SNOWFLAKE_SCHEMA,
  MEETUPS_SNOWFLAKE_SCHEMA_PATTERN,
  OCG_MEETUP_BASE_URL,
  VALID_MEETUP_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import {
  GetMyMeetupsOptions,
  MeetupFilterOptionsResponse,
  MeetupFilterRow,
  MeetupRow,
  MeetupSortOrder,
  MyMeetup,
  MyMeetupsResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

export class MeetupsService {
  private readonly snowflakeService: SnowflakeService;
  private readonly schema: string;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.schema = this.resolveMeetupsSchema();
  }

  public async getMyMeetups(req: Request, userEmail: string, options: GetMyMeetupsOptions): Promise<MyMeetupsResponse> {
    const { isPast, searchQuery, community, role, status, sortField: rawSortField, pageSize, offset, sortOrder } = options;
    const sortField = rawSortField && VALID_MEETUP_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_MEETUP_SORT_FIELD;
    const normalizedSortOrder: MeetupSortOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
    const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    logger.debug(req, 'get_my_meetups', 'Building meetups query', {
      is_past: isPast,
      has_search_query: !!searchQuery,
      has_community: !!community,
      has_role: !!role,
      status,
      page_size: normalizedPageSize,
      offset: normalizedOffset,
      sort_field: sortField,
      sort_order: normalizedSortOrder,
    });

    const query = isPast
      ? this.buildPastMeetupsQuery(userEmail, searchQuery, community, role, sortField, normalizedSortOrder, normalizedPageSize, normalizedOffset)
      : this.buildUpcomingMeetupsQuery(userEmail, searchQuery, community, role, status, sortField, normalizedSortOrder, normalizedPageSize, normalizedOffset);

    let result;
    try {
      result = await this.snowflakeService.execute<MeetupRow>(query.sql, query.binds);
    } catch (error) {
      logger.warning(req, 'get_my_meetups', 'Snowflake query failed, returning empty meetups', {
        error: error instanceof Error ? error.message : String(error),
        page_size: normalizedPageSize,
        offset: normalizedOffset,
      });
      return { data: [], total: 0, pageSize: normalizedPageSize, offset: normalizedOffset };
    }

    const total = result.rows.length > 0 ? (result.rows[0].TOTAL_RECORDS ?? 0) : 0;
    const data = result.rows
      .map((row) => this.mapRowToMeetupOrNull(req, row, normalizedPageSize, normalizedOffset))
      .filter((meetup): meetup is MyMeetup => meetup !== null);

    logger.debug(req, 'get_my_meetups', 'Fetched meetups', { count: data.length, total });

    return { data, total, pageSize: normalizedPageSize, offset: normalizedOffset };
  }

  public async getMeetupFilters(req: Request): Promise<MeetupFilterOptionsResponse> {
    logger.debug(req, 'get_meetup_filters', 'Fetching meetup filters');

    const sql = `
      SELECT FILTER_NAME, FILTER_VALUE
      FROM ${this.table('OCG_MEETUPS_FILTERS')}
      ORDER BY FILTER_NAME, FILTER_VALUE
    `;

    let result;
    try {
      result = await this.snowflakeService.execute<MeetupFilterRow>(sql, []);
    } catch (error) {
      logger.warning(req, 'get_meetup_filters', 'Snowflake query failed, returning empty filters', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { communities: [], roles: [] };
    }

    const communities: string[] = [];
    const roles: string[] = [];

    for (const row of result.rows) {
      if (row.FILTER_NAME === 'community') {
        communities.push(row.FILTER_VALUE);
      } else if (row.FILTER_NAME === 'role') {
        roles.push(row.FILTER_VALUE);
      }
    }

    return { communities, roles };
  }

  private buildUpcomingMeetupsQuery(
    userEmail: string,
    searchQuery: string | undefined,
    community: string | undefined,
    role: string | undefined,
    status: string | undefined,
    sortField: string,
    sortOrder: MeetupSortOrder,
    pageSize: number,
    offset: number
  ): { sql: string; binds: string[] } {
    const searchQueryFilter = searchQuery ? 'AND EVENT_NAME ILIKE ?' : '';
    const communityFilter = community ? 'AND COMMUNITY = ?' : '';
    const roleFilterResult = role ? this.buildRoleFilter(role) : { filter: '', binds: [] as string[] };
    let statusFilter = '';
    if (status === 'registered') {
      statusFilter = 'AND ROLES IS NOT NULL';
    } else if (status === 'not-registered') {
      statusFilter = 'AND ROLES IS NULL';
    }

    const sql = `
      WITH meetups AS (
        SELECT
          m.*,
          r.ROLES
        FROM ${this.table('OCG_UPCOMING_MEETUPS')} m
        LEFT JOIN ${this.table('OCG_UPCOMING_MEETUPS_ROLES')} r
          ON r.EMAIL = ?
          AND r.EVENT_ID = m.EVENT_ID
      ),
      filtered AS (
        SELECT *
        FROM meetups
        WHERE 1=1
          ${searchQueryFilter}
          ${communityFilter}
          ${roleFilterResult.filter}
          ${statusFilter}
      ),
      ranked_meetups AS (
        SELECT
          *,
          ROW_NUMBER() OVER (ORDER BY STARTS_AT ASC, EVENT_ID ASC) AS UPCOMING_RANK
        FROM filtered
      ),
      discoverable AS (
        SELECT *
        FROM ranked_meetups
        WHERE UPCOMING_RANK <= 50
          OR ROLES IS NOT NULL
      )
      SELECT
        EVENT_ID,
        STARTS_AT,
        EVENT_NAME,
        COMMUNITY,
        DATE,
        LOCATION,
        ROLES,
        GROUP_SLUG,
        EVENT_SLUG,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM discoverable
      ORDER BY ${sortField} ${sortOrder}, EVENT_ID ${sortOrder}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const binds: string[] = [userEmail];
    if (searchQuery) binds.push(`%${searchQuery}%`);
    if (community) binds.push(community);
    binds.push(...roleFilterResult.binds);

    return { sql, binds };
  }

  private buildPastMeetupsQuery(
    userEmail: string,
    searchQuery: string | undefined,
    community: string | undefined,
    role: string | undefined,
    sortField: string,
    sortOrder: MeetupSortOrder,
    pageSize: number,
    offset: number
  ): { sql: string; binds: string[] } {
    const searchQueryFilter = searchQuery ? 'AND EVENT_NAME ILIKE ?' : '';
    const communityFilter = community ? 'AND COMMUNITY = ?' : '';
    const roleFilterResult = role ? this.buildRoleFilter(role) : { filter: '', binds: [] as string[] };

    const sql = `
      WITH filtered AS (
        SELECT
          EVENT_ID,
          STARTS_AT,
          EVENT_NAME,
          COMMUNITY,
          DATE,
          LOCATION,
          ROLES,
          GROUP_SLUG,
          EVENT_SLUG
        FROM ${this.table('OCG_PAST_MEETUPS')}
        WHERE EMAIL = ?
          ${searchQueryFilter}
          ${communityFilter}
          ${roleFilterResult.filter}
      )
      SELECT
        EVENT_ID,
        STARTS_AT,
        EVENT_NAME,
        COMMUNITY,
        DATE,
        LOCATION,
        ROLES,
        GROUP_SLUG,
        EVENT_SLUG,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM filtered
      ORDER BY ${sortField} ${sortOrder}, EVENT_ID ${sortOrder}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const binds: string[] = [userEmail];
    if (searchQuery) binds.push(`%${searchQuery}%`);
    if (community) binds.push(community);
    binds.push(...roleFilterResult.binds);

    return { sql, binds };
  }

  private buildRoleFilter(role: string): { filter: string; binds: string[] } {
    return {
      filter: `
        AND POSITION(? IN CONCAT(',', REPLACE(ROLES, ', ', ','), ',')) > 0
      `,
      binds: [`,${role},`],
    };
  }

  private mapRowToMeetupOrNull(req: Request, row: MeetupRow, pageSize: number, offset: number): MyMeetup | null {
    try {
      return this.mapRowToMeetup(row);
    } catch (error) {
      logger.warning(req, 'get_my_meetups', 'Dropping malformed meetup row', {
        event_id: row.EVENT_ID ?? null,
        error: error instanceof Error ? error.message : String(error),
        page_size: pageSize,
        offset,
      });
      return null;
    }
  }

  private mapRowToMeetup(row: MeetupRow): MyMeetup {
    if (!row.EVENT_ID || !row.EVENT_NAME || !row.COMMUNITY || !row.STARTS_AT || !row.GROUP_SLUG || !row.EVENT_SLUG) {
      throw new Error('Meetup row is missing required fields');
    }

    const startsAt = new Date(row.STARTS_AT);
    if (Number.isNaN(startsAt.getTime())) {
      throw new Error('Meetup row has an invalid STARTS_AT value');
    }

    const role = row.ROLES ?? '';
    const communityPath = encodeURIComponent(row.COMMUNITY.toLowerCase());
    const groupSlug = encodeURIComponent(row.GROUP_SLUG);
    const eventSlug = encodeURIComponent(row.EVENT_SLUG);

    return {
      id: row.EVENT_ID,
      name: row.EVENT_NAME,
      community: row.COMMUNITY,
      startDate: startsAt.toISOString(),
      date: row.DATE,
      location: row.LOCATION,
      role,
      status: role ? 'Registered' : 'Not Registered',
      groupSlug: row.GROUP_SLUG,
      eventSlug: row.EVENT_SLUG,
      url: `${OCG_MEETUP_BASE_URL}/${communityPath}/group/${groupSlug}/event/${eventSlug}`,
    };
  }

  private table(tableName: string): string {
    return `${this.schema}.${tableName}`;
  }

  private resolveMeetupsSchema(): string {
    const schema = process.env['MEETUPS_SNOWFLAKE_SCHEMA'] || MEETUPS_DEFAULT_SNOWFLAKE_SCHEMA;
    if (!MEETUPS_SNOWFLAKE_SCHEMA_PATTERN.test(schema)) {
      throw new MicroserviceError('MEETUPS_SNOWFLAKE_SCHEMA must be a dot-separated Snowflake identifier path', 500, 'MEETUPS_SCHEMA_CONFIG_ERROR', {
        operation: 'resolve_meetups_schema',
        service: 'meetups',
      });
    }
    return schema;
  }
}
