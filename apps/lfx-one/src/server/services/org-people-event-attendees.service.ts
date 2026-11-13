// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_ORG_EVENT_ATTENDEES_RESPONSE,
  ORG_EVENT_DETAIL_COLUMNS,
  ORG_EVENT_DICTIONARY_COLUMNS,
  ORG_EVENT_FOUNDATION_OPTION_COLUMNS,
  ORG_EVENT_OPTION_COLUMNS,
  ORG_EVENTS_COUNTED_ATTRIBUTION,
  ORG_EVENTS_NEUTRAL_REGISTRANT_LABEL,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  CompactOrgEventAttendeesRawCache,
  EventAttendeeEventOptionRow,
  EventAttendeeFoundationOptionRow,
  EventAttendeesRaw,
  OrgEventAttendeeDetailRow,
  OrgEventAttendeeEventOption,
  OrgEventAttendeeFoundationOption,
  OrgEventAttendeesResponse,
  OrgEventAttendeesSummary,
  OrgEventParticipationRow,
  OrgEventParticipationSummaryRow,
  OrgEventsFilters,
} from '@lfx-one/shared/interfaces';
import {
  dedupeByKey,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  isObjectRowArray,
  normalizeToUrl,
  toColumnar,
  tupleKey,
} from '@lfx-one/shared/utils';

import { toIsoDate } from '../helpers/date-format.helper';
import { distinctFoundationOptions, orgEventsAttendeePredicate, orgEventsRangeWindow, orgEventsSpeakerPredicate } from '../helpers/org-events-filters.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache, withOrgCompactCache } from './valkey.service';

/**
 * Event Attendees tab data access — one bundled GET: the person × event rows of ORG_EVENT_PARTICIPATION for the picked range and
 * participation (everyone who registered, or spoke, with a company email of the company, by name and title; ended events only; the
 * server applies the window, the browser does not), the summary row dbt computed for the same pick, and the foundation and
 * event dropdown options of that same row set.
 */
export class OrgPeopleEventAttendeesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getEventAttendees(accountId: string, filters: Pick<OrgEventsFilters, 'range' | 'participation'>): Promise<OrgEventAttendeesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_EVENT_ATTENDEES_RESPONSE };
    }

    const { range, participation } = filters;

    // Only the filters that select rows are in the key. `v8` (lfx-self-serve#5582): only registrations and speaker records made with
    // a company email; a `v7` entry holds the old Employee match rows (company email OR roster user), so it must miss.
    const [{ detailRows, foundationRows, eventRows }, summary] = await Promise.all([
      withOrgCompactCache(
        accountId,
        `people-event-attendees:v8:${range}:${participation}`,
        VALKEY_CACHE.ORG_LENS_NAMED_TTL_SECONDS,
        () => this.fetchEventAttendeesRaw(accountId, range, participation),
        { encode: encodeEventAttendeesRaw, decode: decodeEventAttendeesRaw, accept: isCompactEventAttendeesRaw }
      ),
      this.readSummary(accountId, range, participation),
    ]);

    const details: OrgEventAttendeeDetailRow[] = detailRows.map((row) => ({
      participantRef: row.PARTICIPANT_REF,
      personKey: row.PERSON_KEY,
      displayName: displayText(row.DISPLAY_NAME) ?? ORG_EVENTS_NEUTRAL_REGISTRANT_LABEL,
      jobTitle: displayText(row.JOB_TITLE),
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
    }));

    const foundationOptions: OrgEventAttendeeFoundationOption[] = distinctFoundationOptions(foundationRows).map((row) => ({
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
    }));

    const eventOptions: OrgEventAttendeeEventOption[] = eventRows.map((row) => ({
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME,
    }));

    return { accountId, details, summary, foundationOptions, eventOptions };
  }

  /** The dbt summary row for (range, participation), company-email rows only; zeros when the account has none (no fallback to another attribution). Read by the Event Attendees tab and the All Employees Event Attendees tile, so both show the same number. */
  public async readSummary(
    accountId: string,
    range: OrgEventsFilters['range'],
    participation: OrgEventsFilters['participation']
  ): Promise<OrgEventAttendeesSummary> {
    const sql = `
      SELECT ATTENDEES_COUNT, SPEAKERS_COUNT, EVENTS_COUNT, FOUNDATIONS_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION_SUMMARY
      WHERE ACCOUNT_ID = ?
        AND TIME_RANGE = ?
        AND ATTRIBUTION = ?
        AND PARTICIPATION = ?
    `;
    // `v4` (lfx-self-serve#5582): company-email rows only; a `v3` entry holds the Employee match counts.
    const rows = await withOrgCache(
      accountId,
      `people-event-attendees-summary:v4:${range}:${participation}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () =>
        (await this.snowflakeService.execute<OrgEventParticipationSummaryRow>(sql, [accountId, range, ORG_EVENTS_COUNTED_ATTRIBUTION, participation])).rows,
      isObjectRowArray
    );
    const row = rows[0];
    return {
      attendeesCount: row?.ATTENDEES_COUNT ?? 0,
      speakersCount: row?.SPEAKERS_COUNT ?? 0,
      eventsCount: row?.EVENTS_COUNT ?? 0,
      foundationsCount: row?.FOUNDATIONS_COUNT ?? 0,
    };
  }

  private async fetchEventAttendeesRaw(
    accountId: string,
    range: OrgEventsFilters['range'],
    participation: OrgEventsFilters['participation']
  ): Promise<EventAttendeesRaw> {
    // One row set, two projections: the rows, and the dropdown options narrowed to what the rows hold. Everyone who
    // registered or spoke with a company email of the company for the participation, ended events only, inside the range window.
    const where = `
      WHERE p.ACCOUNT_ID = ?
        AND p.${orgEventsAttendeePredicate(participation)}
        AND p.EVENT_DATE < CURRENT_DATE()
        ${orgEventsRangeWindow('p.EVENT_DATE', range)}
    `;
    const from = 'FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION p';
    const speaker = `p.${orgEventsSpeakerPredicate()}`;
    const binds = [accountId];

    const [detail, foundations, events] = await Promise.all([
      this.snowflakeService.execute<OrgEventParticipationRow>(
        `SELECT p.PARTICIPANT_REF, p.PERSON_KEY, p.DISPLAY_NAME, p.JOB_TITLE, p.EVENT_ID, p.EVENT_NAME, p.EVENT_LOCATION, p.EVENT_CITY,
                p.EVENT_COUNTRY, p.EVENT_URL, p.EVENT_START_DATE, p.EVENT_END_DATE, p.FOUNDATION_ID, p.FOUNDATION_NAME,
                CASE WHEN ${speaker} THEN TRUE ELSE FALSE END AS IS_SPEAKER
         ${from} ${where}
         ORDER BY p.PARTICIPANT_REF ASC, p.EVENT_DATE DESC NULLS LAST, p.EVENT_ID ASC`,
        binds
      ),
      this.snowflakeService.execute<EventAttendeeFoundationOptionRow>(
        `SELECT DISTINCT p.FOUNDATION_ID, p.FOUNDATION_NAME ${from} ${where}
           AND p.FOUNDATION_ID IS NOT NULL AND p.FOUNDATION_NAME IS NOT NULL
         ORDER BY p.FOUNDATION_NAME ASC`,
        binds
      ),
      // Most-recent-first, matching the prototype's flat list.
      this.snowflakeService.execute<EventAttendeeEventOptionRow>(
        `SELECT DISTINCT p.EVENT_ID, p.EVENT_NAME, p.EVENT_DATE ${from} ${where}
           AND p.EVENT_ID IS NOT NULL AND p.EVENT_NAME IS NOT NULL
         ORDER BY p.EVENT_DATE DESC NULLS LAST, p.EVENT_NAME ASC`,
        binds
      ),
    ]);

    return { detailRows: detail.rows, foundationRows: foundations.rows, eventRows: events.rows };
  }
}

/** A name or title for display: trimmed, `null` when empty or when it holds an address — no email reaches the client, whatever the warehouse sent. */
function displayText(value: string | null): string | null {
  const text = value?.trim();
  return text && !text.includes('@') ? text : null;
}

/**
 * Compacts the three raw reads for Valkey storage (GH-1906).
 *
 * `detailRows` is nearly all of the payload, and almost none of it is per-row data: the grain is (person, event), so each
 * row repeats the same EVENT_NAME / LOCATION / CITY / COUNTRY / URL / START / END / FOUNDATION_ID / FOUNDATION_NAME as every
 * other row for that event. Those columns are stored once per distinct event and referenced by index; what stays per row is
 * `PARTICIPANT_REF`, `PERSON_KEY`, `DISPLAY_NAME`, `JOB_TITLE` and `IS_SPEAKER`.
 */
function encodeEventAttendeesRaw(raw: EventAttendeesRaw): CompactOrgEventAttendeesRawCache {
  // Keyed on the whole event tuple, not on EVENT_ID: two rows sharing an id but disagreeing on any
  // event column must not collapse onto the first one seen, or the rebuilt rows would differ from
  // the uncached ones. Rows that agree — the overwhelming majority — still collapse.
  // Keyed once per row and reused for both the dictionary and the index array: the key is the
  // expensive part of the encode, and computing it twice per row bought nothing.
  const keys = new Map<OrgEventParticipationRow, string>(
    raw.detailRows.map((row) => [
      row,
      tupleKey([
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
      ]),
    ])
  );
  const events = dedupeByKey(raw.detailRows, (row) => keys.get(row)!);

  return {
    events: toColumnar(events.values, ORG_EVENT_DICTIONARY_COLUMNS),
    details: toColumnar(raw.detailRows, ORG_EVENT_DETAIL_COLUMNS),
    // Every detail row was part of the set `events` was built from, so the lookup always resolves.
    detailEvents: raw.detailRows.map((row) => events.indexOf.get(keys.get(row)!)!),
    foundationRows: toColumnar(raw.foundationRows, ORG_EVENT_FOUNDATION_OPTION_COLUMNS),
    eventRows: toColumnar(raw.eventRows, ORG_EVENT_OPTION_COLUMNS),
  };
}

/** Rebuilds the raw rows {@link encodeEventAttendeesRaw} stored, so the mapping below sees exactly what a cache miss would hand it. */
function decodeEventAttendeesRaw(value: CompactOrgEventAttendeesRawCache): EventAttendeesRaw {
  const events = fromColumnar<OrgEventParticipationRow>(value.events);
  const detailRows = fromColumnar<OrgEventParticipationRow>(value.details);
  detailRows.forEach((row, index) => Object.assign(row, events[value.detailEvents[index]]));
  return {
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
    !isColumnarTable(cache.events) ||
    !isColumnarTable(cache.details) ||
    !isColumnarTable(cache.foundationRows) ||
    !isColumnarTable(cache.eventRows) ||
    // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
    // "successfully" into rows missing data the writer always emits, which is worse than a miss —
    // the tab renders with holes in it for the rest of the TTL instead of refetching.
    !hasExactColumns(cache.events, ORG_EVENT_DICTIONARY_COLUMNS) ||
    !hasExactColumns(cache.details, ORG_EVENT_DETAIL_COLUMNS) ||
    !hasExactColumns(cache.foundationRows, ORG_EVENT_FOUNDATION_OPTION_COLUMNS) ||
    !hasExactColumns(cache.eventRows, ORG_EVENT_OPTION_COLUMNS)
  ) {
    return false;
  }
  // Exact columns prove the SHAPE; these prove the VALUES, and both are needed — the column check
  // does NOT subsume them. A current-shape entry whose required cell is absent or mistyped decodes
  // into a row the mapper then reads, so it has to be a miss.
  // A guard must never be STRICTER than the uncached path: the mapper passes a null column straight
  // through, so demanding a string would turn one null row into a permanent miss for that org.
  // Absence and wrong types are still rejected — those the mapper cannot survive.
  const participantRefIndex = ORG_EVENT_DETAIL_COLUMNS.indexOf('PARTICIPANT_REF');
  const personKeyIndex = ORG_EVENT_DETAIL_COLUMNS.indexOf('PERSON_KEY');
  const eventIdIndex = ORG_EVENT_DICTIONARY_COLUMNS.indexOf('EVENT_ID');
  if (
    !cache.details.r.every((row) => typeof row[participantRefIndex] === 'number' && isStoredNullableString(row[personKeyIndex])) ||
    !cache.events.r.every((row) => isStoredNullableString(row[eventIdIndex]))
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

/** A required stored cell: present (not the absence marker) and a string. */
function isStoredString(cell: unknown): boolean {
  return typeof cell === 'string' && !isColumnarAbsent(cell);
}

/** As {@link isStoredString}, but `null` is a legal warehouse value the uncached mapper already handles. */
function isStoredNullableString(cell: unknown): boolean {
  return cell === null || isStoredString(cell);
}
