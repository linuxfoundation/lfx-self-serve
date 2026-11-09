// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_EVENTS_ATTRIBUTION,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  DEFAULT_ORG_EVENTS_SCOPE,
  ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX,
  ORG_EVENTS_ATTRIBUTION_OPTIONS,
  ORG_EVENTS_ATTRIBUTION_QUERY_PARAM,
  ORG_EVENTS_FOUNDATION_ID_MAX_LENGTH,
  ORG_EVENTS_FOUNDATION_QUERY_PARAM,
  ORG_EVENTS_PARTICIPATION_COLUMN_SEGMENT,
  ORG_EVENTS_PARTICIPATION_OPTIONS,
  ORG_EVENTS_PARTICIPATION_QUERY_PARAM,
  ORG_EVENTS_SCOPE_OPTIONS,
  ORG_EVENTS_SCOPE_QUERY_PARAM,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGES,
} from '@lfx-one/shared/constants';
import type {
  EventAttendeeFoundationOptionRow,
  OrgEventsAttribution,
  OrgEventsFilters,
  OrgEventsParticipation,
  OrgLensTimeRange,
} from '@lfx-one/shared/interfaces';
import {
  isOrgLensTimeRange,
  normalizeLegacyOrgLensTimeRange,
  orgLensTimeRangeDays,
  parseOrgEventsAttribution,
  parseOrgEventsParticipation,
  parseOrgEventsScope,
} from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from './validation.helper';

/**
 * Validate the Org Lens Events filters (`attribution`, `participation`, `eventScope`, `foundation`, `range`; lfx-self-serve#4598):
 * a missing param is its default, an unknown value is a 400 before any SQL is built.
 */
export function parseOrgEventsFilters(req: Request, operation: string): OrgEventsFilters {
  return {
    attribution: parseEnumParam(
      req,
      ORG_EVENTS_ATTRIBUTION_QUERY_PARAM,
      parseOrgEventsAttribution,
      ORG_EVENTS_ATTRIBUTION_OPTIONS,
      DEFAULT_ORG_EVENTS_ATTRIBUTION,
      operation
    ),
    participation: parseEnumParam(
      req,
      ORG_EVENTS_PARTICIPATION_QUERY_PARAM,
      parseOrgEventsParticipation,
      ORG_EVENTS_PARTICIPATION_OPTIONS,
      DEFAULT_ORG_EVENTS_PARTICIPATION,
      operation
    ),
    scope: parseEnumParam(req, ORG_EVENTS_SCOPE_QUERY_PARAM, parseOrgEventsScope, ORG_EVENTS_SCOPE_OPTIONS, DEFAULT_ORG_EVENTS_SCOPE, operation),
    foundation: parseFoundation(req, operation),
    range: parseRange(req, operation),
  };
}

/** `ALL_COUNT_<ATTRIBUTION>`, `REGISTERED_COUNT_<ATTRIBUTION>` or `ATTENDED_COUNT_<ATTRIBUTION>` of `ORG_EVENTS` — the per-event distinct-people count of an option. */
export function orgEventsCountColumn(attribution: OrgEventsAttribution, participation: OrgEventsParticipation): string {
  return `${ORG_EVENTS_PARTICIPATION_COLUMN_SEGMENT[participation]}_COUNT_${ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX[attribution]}`;
}

/** `HAS_FOOTPRINT_<ATTRIBUTION>` of `ORG_EVENTS` — whether the company has activity at the event under the attribution. */
export function orgEventsFootprintColumn(attribution: OrgEventsAttribution): string {
  return `HAS_FOOTPRINT_${ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX[attribution]}`;
}

/**
 * `ORG_EVENT_PARTICIPATION` predicate selecting the attendees an attribution and participation count (no leading `AND`):
 * the one row-level conjunction flag dbt computes for the pair (`IS_COUNTED_REGISTERED_VERIFIED`, `IS_COUNTED_ATTENDED_ALL`,
 * `IS_COUNTED_ALL_SELF_REPORTED` — registered or attended, ...).
 */
export function orgEventsAttendeePredicate(attribution: OrgEventsAttribution, participation: OrgEventsParticipation): string {
  return `IS_COUNTED_${ORG_EVENTS_PARTICIPATION_COLUMN_SEGMENT[participation]}_${ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX[attribution]} = TRUE`;
}

/**
 * Predicate for the speakers an attribution credits (no leading `AND`): the one row-level flag dbt computes for an ACCEPTED talk
 * credited under that attribution (`IS_COUNTED_SPEAKER_VERIFIED`, `IS_COUNTED_SPEAKER_ALL`, ...).
 */
export function orgEventsSpeakerPredicate(attribution: OrgEventsAttribution): string {
  return `IS_COUNTED_SPEAKER_${ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX[attribution]} = TRUE`;
}

/**
 * The range window on an event-date column: events on or after N days before today; empty for `all`. Inline, not bound —
 * the day count comes from the allow-listed range. Begins with `AND`, like the other Org Lens window predicates.
 */
export function orgEventsRangeWindow(column: string, range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND ${column} >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}

/**
 * The foundation dropdown rows, one per foundation id. Names are normalized here, not in SQL, because `TRIM` in Snowflake strips
 * only spaces and a name padded with a tab, newline or no-break space would still split one foundation in two. A blank name
 * is skipped, and when one id carries several spellings the first in name order wins.
 */
export function distinctFoundationOptions(rows: EventAttendeeFoundationOptionRow[]): EventAttendeeFoundationOptionRow[] {
  const byId = new Map<string, EventAttendeeFoundationOptionRow>();
  const named = rows
    .map((row) => ({ FOUNDATION_ID: row.FOUNDATION_ID, FOUNDATION_NAME: (row.FOUNDATION_NAME ?? '').trim() }))
    .filter((row) => row.FOUNDATION_ID && row.FOUNDATION_NAME)
    .sort((a, b) => a.FOUNDATION_NAME.localeCompare(b.FOUNDATION_NAME) || a.FOUNDATION_ID.localeCompare(b.FOUNDATION_ID));
  for (const row of named) {
    if (!byId.has(row.FOUNDATION_ID)) byId.set(row.FOUNDATION_ID, row);
  }
  return [...byId.values()].sort((a, b) => a.FOUNDATION_NAME.localeCompare(b.FOUNDATION_NAME) || a.FOUNDATION_ID.localeCompare(b.FOUNDATION_ID));
}

function parseEnumParam<T extends string>(
  req: Request,
  field: string,
  parse: (value: string | undefined) => T | null,
  options: readonly { value: T }[],
  fallback: T,
  operation: string
): T {
  const raw = getStringQueryParam(req, field);
  if (!raw) {
    return fallback;
  }
  const value = parse(raw);
  if (value === null) {
    throw ServiceValidationError.forField(field, `Invalid ${field} value. Allowed: ${options.map((option) => option.value).join(', ')}`, { operation });
  }
  return value;
}

/** Missing → All Foundations (`''`); the id is only ever bound, so any short string is safe. */
function parseFoundation(req: Request, operation: string): string {
  const raw = getStringQueryParam(req, ORG_EVENTS_FOUNDATION_QUERY_PARAM);
  if (!raw) {
    return '';
  }
  if (raw.length > ORG_EVENTS_FOUNDATION_ID_MAX_LENGTH) {
    throw ServiceValidationError.forField(ORG_EVENTS_FOUNDATION_QUERY_PARAM, 'Invalid foundation value', { operation });
  }
  return raw;
}

/** Missing → the default; the legacy `12mo` → `365d`; any other unknown value → 400. */
function parseRange(req: Request, operation: string): OrgLensTimeRange {
  const raw = getStringQueryParam(req, 'range');
  if (!raw) {
    return ORG_LENS_DEFAULT_TIME_RANGE;
  }
  const range = normalizeLegacyOrgLensTimeRange(raw);
  if (!isOrgLensTimeRange(range)) {
    throw ServiceValidationError.forField('range', `Invalid range value. Allowed: ${ORG_LENS_TIME_RANGES.join(', ')}`, { operation });
  }
  return range;
}
