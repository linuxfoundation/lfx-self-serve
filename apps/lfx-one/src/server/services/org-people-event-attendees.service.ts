// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_EVENT_ATTENDEES_RESPONSE } from '@lfx-one/shared/constants';
import type {
  OrgEventAttendeeDetailRow,
  OrgEventAttendeeEventOption,
  OrgEventAttendeeFoundationOption,
  OrgEventAttendeeRow,
  OrgEventAttendeesResponse,
  OrgEventAttendeeStatsBaseline,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

/** Per-(account, person) row from `ORG_PEOPLE_ALL` filtered to people with at least one event registration. */
interface OrgPeopleAllEventAttendeeRow {
  PERSON_KEY: string;
  LFID: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  EVENTS_COUNT: number | null;
}

/** Per-(account, person, event) row from `ORG_PEOPLE_EVENTS`. */
interface OrgPeopleEventRow {
  PERSON_KEY: string;
  EVENT_ID: string;
  EVENT_NAME: string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  EVENT_URL: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  IS_SPEAKER: boolean | null;
  IS_PAST_EVENT: boolean | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface FoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

interface EventOptionRow {
  EVENT_ID: string;
  EVENT_NAME: string;
}

/** Event Attendees tab data access — single bundled GET that backs the filter trio, four stat cards, main row, and expanded event-grain sub-table client-side. */
export class OrgPeopleEventAttendeesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Bundled attendees + per-(person, event) details + baseline stats + filter-dropdown payloads.
   * Four parallel Snowflake queries; stats are computed in TS over the returned details so the
   * wire contract stays free of duplicated math and the client `computed()` re-uses the same body.
   */
  public async getEventAttendees(accountId: string): Promise<OrgEventAttendeesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_EVENT_ATTENDEES_RESPONSE };
    }

    const [attendeeRows, detailRows, foundationRows, eventRows] = await Promise.all([
      this.fetchAttendeeRows(accountId),
      this.fetchDetailRows(accountId),
      this.fetchFoundationOptions(accountId),
      this.fetchEventOptions(accountId),
    ]);

    const attendees: OrgEventAttendeeRow[] = attendeeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
      eventsCount: row.EVENTS_COUNT ?? 0,
    }));

    const details: OrgEventAttendeeDetailRow[] = detailRows.map((row) => ({
      personKey: row.PERSON_KEY,
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME ?? row.EVENT_ID,
      eventLocation: row.EVENT_LOCATION,
      eventCity: row.EVENT_CITY,
      eventCountry: row.EVENT_COUNTRY,
      eventUrl: row.EVENT_URL,
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
      eventStartDate: toIsoDate(row.EVENT_START_DATE),
      eventEndDate: toIsoDate(row.EVENT_END_DATE),
      isSpeaker: row.IS_SPEAKER === true,
      isPastEvent: row.IS_PAST_EVENT === true,
    }));

    const foundationOptions: OrgEventAttendeeFoundationOption[] = foundationRows.map((row) => ({
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
    }));

    const eventOptions: OrgEventAttendeeEventOption[] = eventRows.map((row) => ({
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME,
    }));

    return {
      accountId,
      attendees,
      details,
      stats: computeBaselineStats(details),
      foundationOptions,
      eventOptions,
    };
  }

  private async fetchAttendeeRows(accountId: string): Promise<OrgPeopleAllEventAttendeeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL,
        EVENTS_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ? AND EVENTS_COUNT > 0
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllEventAttendeeRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchDetailRows(accountId: string): Promise<OrgPeopleEventRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        EVENT_ID,
        EVENT_NAME,
        EVENT_LOCATION,
        EVENT_CITY,
        EVENT_COUNTRY,
        EVENT_URL,
        EVENT_START_DATE,
        EVENT_END_DATE,
        IS_SPEAKER,
        IS_PAST_EVENT,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ?
      ORDER BY PERSON_KEY ASC, EVENT_END_DATE DESC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleEventRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchFoundationOptions(accountId: string): Promise<FoundationOptionRow[]> {
    const query = `
      SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ?
        AND FOUNDATION_ID IS NOT NULL
        AND FOUNDATION_NAME IS NOT NULL
      ORDER BY FOUNDATION_NAME ASC
    `;
    const result = await this.snowflakeService.execute<FoundationOptionRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchEventOptions(accountId: string): Promise<EventOptionRow[]> {
    // R2.3 — most-recent-first, matches the prototype's flat list. Distinct on (EVENT_ID, EVENT_NAME, EVENT_END_DATE)
    // to keep the EVENT_END_DATE column available for ORDER BY without forcing a re-aggregation.
    const query = `
      SELECT DISTINCT EVENT_ID, EVENT_NAME, EVENT_END_DATE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ?
        AND EVENT_ID IS NOT NULL
        AND EVENT_NAME IS NOT NULL
      ORDER BY EVENT_END_DATE DESC NULLS LAST, EVENT_NAME ASC
    `;
    const result = await this.snowflakeService.execute<EventOptionRow>(query, [accountId]);
    return result.rows;
  }
}

/**
 * Recompute baseline stat values from the bundled `details` array — same math the client
 * runs on filter change, so initial paint and live filtering share one source of truth.
 * Matches the brief's locked Item 3 formulas: speakers = distinct person_key where
 * any-event isSpeaker, attendees = distinct person_key (includes speakers), events =
 * distinct event_id, foundations = distinct foundation_id (non-null).
 */
function computeBaselineStats(details: OrgEventAttendeeDetailRow[]): OrgEventAttendeeStatsBaseline {
  const attendees = new Set<string>();
  const speakers = new Set<string>();
  const events = new Set<string>();
  const foundations = new Set<string>();

  for (const row of details) {
    attendees.add(row.personKey);
    if (row.isSpeaker) {
      speakers.add(row.personKey);
    }
    events.add(row.eventId);
    if (row.foundationId) {
      foundations.add(row.foundationId);
    }
  }

  return {
    speakers: speakers.size,
    attendees: attendees.size,
    events: events.size,
    foundations: foundations.size,
  };
}

/** Normalize Snowflake `Date | string | null` to an ISO `YYYY-MM-DD` date string (date-only — events platform's date columns are date-grain even when typed TIMESTAMP). Null in → null out. */
function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return null;
}
