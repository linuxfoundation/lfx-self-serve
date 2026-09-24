// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_EVENT_ATTENDEES_RESPONSE, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  CompactOrgEventAttendeesRawCache,
  EventAttendeeEventOptionRow,
  EventAttendeeFoundationOptionRow,
  OrgEventAttendeeDetailRow,
  OrgEventAttendeeEventOption,
  OrgEventAttendeeFoundationOption,
  OrgEventAttendeeRow,
  OrgEventAttendeesResponse,
  OrgPeopleAllEventAttendeeRow,
  OrgPeopleEventRow,
} from '@lfx-one/shared/interfaces';
import { dedupeByKey, fromColumnar, isColumnarTable, normalizeToUrl, toColumnar } from '@lfx-one/shared/utils';

import { toIsoDate } from '../helpers/date-format.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

/** Event Attendees tab data access — single bundled GET that backs the filter trio, four stat cards, main row, and expanded event-grain sub-table client-side. */
export class OrgPeopleEventAttendeesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled attendees + per-(person, event) details + filter dropdowns. Four parallel Snowflake queries; stats are recomputed client-side from filtered details so the server ships none. */
  public async getEventAttendees(accountId: string): Promise<OrgEventAttendeesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_EVENT_ATTENDEES_RESPONSE };
    }

    // `people-event-attendees:v2`: the stored value is now the compact projection below (GH-1906),
    // with the event-level columns lifted out of the per-(person, event) detail rows — a `v1` entry
    // is a different shape entirely and must miss.
    const { attendeeRows, detailRows, foundationRows, eventRows } = await withOrgCompactCache(
      accountId,
      'people-event-attendees:v2',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchEventAttendeesRaw(accountId),
      { encode: encodeEventAttendeesRaw, decode: decodeEventAttendeesRaw, accept: isCompactEventAttendeesRaw }
    );

    const attendees: OrgEventAttendeeRow[] = attendeeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
    }));

    const details: OrgEventAttendeeDetailRow[] = detailRows.map((row) => ({
      personKey: row.PERSON_KEY,
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME ?? row.EVENT_ID,
      eventLocation: row.EVENT_LOCATION,
      eventCity: row.EVENT_CITY,
      eventCountry: row.EVENT_COUNTRY,
      // Normalize scheme-less DB URLs (e.g. "regfox.com/..") so a future clickable event name binds a safe absolute href.
      eventUrl: normalizeToUrl(row.EVENT_URL ?? ''),
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
      foundationOptions,
      eventOptions,
    };
  }

  private async fetchEventAttendeesRaw(accountId: string): Promise<{
    attendeeRows: OrgPeopleAllEventAttendeeRow[];
    detailRows: OrgPeopleEventRow[];
    foundationRows: EventAttendeeFoundationOptionRow[];
    eventRows: EventAttendeeEventOptionRow[];
  }> {
    const [attendeeRows, detailRows, foundationRows, eventRows] = await Promise.all([
      this.fetchAttendeeRows(accountId),
      this.fetchDetailRows(accountId),
      this.fetchFoundationOptions(accountId),
      this.fetchEventOptions(accountId),
    ]);
    return { attendeeRows, detailRows, foundationRows, eventRows };
  }

  private async fetchAttendeeRows(accountId: string): Promise<OrgPeopleAllEventAttendeeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL
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

  private async fetchFoundationOptions(accountId: string): Promise<EventAttendeeFoundationOptionRow[]> {
    const query = `
      SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ?
        AND FOUNDATION_ID IS NOT NULL
        AND FOUNDATION_NAME IS NOT NULL
      ORDER BY FOUNDATION_NAME ASC
    `;
    const result = await this.snowflakeService.execute<EventAttendeeFoundationOptionRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchEventOptions(accountId: string): Promise<EventAttendeeEventOptionRow[]> {
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
    const result = await this.snowflakeService.execute<EventAttendeeEventOptionRow>(query, [accountId]);
    return result.rows;
  }
}

/**
 * Compacts the four raw reads for Valkey storage (GH-1906).
 *
 * `detailRows` is nearly all of the payload — 4.8 MB of a 5.69 MB value for the largest org — and
 * almost none of it is per-row data: the grain is (person, event), so each of the ~25k rows repeats
 * the same EVENT_NAME / LOCATION / CITY / COUNTRY / URL / START / END / FOUNDATION_ID /
 * FOUNDATION_NAME as every other row for that event. Those nine columns are stored once per
 * distinct event and referenced by index; what stays per row is `PERSON_KEY`, `IS_SPEAKER` and
 * `IS_PAST_EVENT`.
 */
function encodeEventAttendeesRaw(raw: {
  attendeeRows: OrgPeopleAllEventAttendeeRow[];
  detailRows: OrgPeopleEventRow[];
  foundationRows: EventAttendeeFoundationOptionRow[];
  eventRows: EventAttendeeEventOptionRow[];
}): CompactOrgEventAttendeesRawCache {
  // Keyed on the whole event tuple, not on EVENT_ID: two rows sharing an id but disagreeing on any
  // event column must not collapse onto the first one seen, or the rebuilt rows would differ from
  // the uncached ones. Rows that agree — the overwhelming majority — still collapse.
  const keyOf = (row: OrgPeopleEventRow): string =>
    JSON.stringify([
      row.EVENT_ID,
      row.EVENT_NAME,
      row.EVENT_LOCATION,
      row.EVENT_CITY,
      row.EVENT_COUNTRY,
      row.EVENT_URL,
      row.EVENT_START_DATE,
      row.EVENT_END_DATE,
      row.FOUNDATION_ID,
      row.FOUNDATION_NAME,
    ]);
  const events = dedupeByKey(raw.detailRows, keyOf);

  return {
    attendeeRows: toColumnar(raw.attendeeRows, ['PERSON_KEY', 'LFID', 'CDP_MEMBER_ID', 'NAME', 'TITLE', 'EMAIL']),
    events: toColumnar(events.values, [
      'EVENT_ID',
      'EVENT_NAME',
      'EVENT_LOCATION',
      'EVENT_CITY',
      'EVENT_COUNTRY',
      'EVENT_URL',
      'EVENT_START_DATE',
      'EVENT_END_DATE',
      'FOUNDATION_ID',
      'FOUNDATION_NAME',
    ]),
    details: toColumnar(raw.detailRows, ['PERSON_KEY', 'IS_SPEAKER', 'IS_PAST_EVENT']),
    // Every detail row was part of the set `events` was built from, so the lookup always resolves.
    detailEvents: raw.detailRows.map((row) => events.indexOf.get(keyOf(row))!),
    foundationRows: toColumnar(raw.foundationRows, ['FOUNDATION_ID', 'FOUNDATION_NAME']),
    eventRows: toColumnar(raw.eventRows, ['EVENT_ID', 'EVENT_NAME', 'EVENT_END_DATE']),
  };
}

/** Rebuilds the raw rows {@link encodeEventAttendeesRaw} stored, so the mapping below sees exactly what a cache miss would hand it. */
function decodeEventAttendeesRaw(value: CompactOrgEventAttendeesRawCache): {
  attendeeRows: OrgPeopleAllEventAttendeeRow[];
  detailRows: OrgPeopleEventRow[];
  foundationRows: EventAttendeeFoundationOptionRow[];
  eventRows: EventAttendeeEventOptionRow[];
} {
  const events = fromColumnar<OrgPeopleEventRow>(value.events);
  const detailRows = fromColumnar<OrgPeopleEventRow>(value.details);
  detailRows.forEach((row, index) => Object.assign(row, events[value.detailEvents[index]]));
  return {
    attendeeRows: fromColumnar<OrgPeopleAllEventAttendeeRow>(value.attendeeRows),
    detailRows,
    foundationRows: fromColumnar<EventAttendeeFoundationOptionRow>(value.foundationRows),
    eventRows: fromColumnar<EventAttendeeEventOptionRow>(value.eventRows),
  };
}

function isCompactEventAttendeesRaw(value: unknown): boolean {
  const cache = value as Partial<CompactOrgEventAttendeesRawCache> | null;
  if (
    !cache ||
    typeof cache !== 'object' ||
    !isColumnarTable(cache.attendeeRows) ||
    !isColumnarTable(cache.events) ||
    !isColumnarTable(cache.details) ||
    !isColumnarTable(cache.foundationRows) ||
    !isColumnarTable(cache.eventRows)
  ) {
    return false;
  }
  // Every reference must resolve, so the decode can rebuild each detail row in full rather than
  // silently emitting one missing its whole event — a truncated entry is a miss, not a partial hit.
  const eventCount = cache.events.r.length;
  return (
    Array.isArray(cache.detailEvents) &&
    cache.detailEvents.length === cache.details.r.length &&
    cache.detailEvents.every((index) => Number.isInteger(index) && index >= 0 && index < eventCount)
  );
}
