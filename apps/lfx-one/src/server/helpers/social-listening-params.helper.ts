// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTION_FILTER_MAX_VALUES,
  MENTION_HAS_TITLE_OPTIONS,
  MENTION_IDS_MAX_VALUES,
  MENTION_MAX_FEED_OFFSET,
  MENTION_READ_IDS_MAX_VALUES,
  MENTION_RELEVANCE_OPTIONS,
  MENTION_SENTIMENT_OPTIONS,
  MENTION_SERVER_WINDOW_SIZE,
} from '@lfx-one/shared/constants';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam, getValidatedPeriod } from './validation.helper';

import type { ResolvedPeriodRange, SocialListeningFilterParams, SocialListeningReadBlindFilterParams, SocialListeningScopedOptionsParams } from '@lfx-one/shared/interfaces';

/**
 * Query-parameter parsing for the Social Listening endpoints: every value is validated and bounded
 * here so the service only binds vetted values. No logging — `apiErrorHandler` logs every
 * `ServiceValidationError` at WARN. Array values arrive as repeated params.
 */

/** Foundation slugs are alphanumeric + hyphens. Case-insensitive because the dashboard-access middleware compares slugs case-insensitively and the client sends `project.slug` verbatim — the parsed value is normalized to lowercase before it reaches the Snowflake bind / cache key. */
const FOUNDATION_SLUG_PATTERN = /^[a-z0-9-]+$/i;

/** Matches the `isFilterSafeIdentifier()` ceiling so a passing slug can always build a Valkey cache key. */
const FOUNDATION_SLUG_MAX_LENGTH = 64;

/** Upper bound for a single filter value (a keyword, tag, author handle, language code, or id). */
const FILTER_VALUE_MAX_LENGTH = 200;

/** Search terms get more room than a single-token filter but still can't be unbounded. */
const SEARCH_MAX_LENGTH = 500;

/**
 * Read-state cutoff shape: ISO 8601 (`2026-08-01T00:00:00Z`) or Snowflake's space-separated form
 * (`2026-08-01 12:00:00`), optional millis — the two shapes the client persists, since `newestTsOf`
 * passes feed-payload timestamps through verbatim.
 */
const READ_BEFORE_TS_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/;

/** A page can never exceed the server window the client is built around. */
export const MAX_FEED_LIMIT = MENTION_SERVER_WINDOW_SIZE;

/** Ceiling for the caller-supplied `limit` on the analytics top-projects panel. */
export const MAX_ANALYTICS_LIMIT = 100;

/** Ceiling for the tag-option `limit`: the filter panel needs the whole vocabulary it will let a user select from. */
export const MAX_TAGS_LIMIT = MENTION_FILTER_MAX_VALUES;

const VALID_SENTIMENTS = MENTION_SENTIMENT_OPTIONS.map((option) => option.value);
const VALID_RELEVANCES = MENTION_RELEVANCE_OPTIONS.map((option) => option.value);
const VALID_HAS_TITLE = MENTION_HAS_TITLE_OPTIONS.map((option) => option.value);

/** Required, format-checked foundation slug, capped at the cache-key builder's 64-char ceiling (`isFilterSafeIdentifier`). */
export function parseFoundationSlug(req: Request, operation: string): string {
  const foundationSlug = getStringQueryParam(req, 'foundationSlug');

  if (!foundationSlug) {
    throw ServiceValidationError.forField('foundationSlug', 'foundationSlug query parameter is required', { operation });
  }

  if (foundationSlug.length > FOUNDATION_SLUG_MAX_LENGTH || !FOUNDATION_SLUG_PATTERN.test(foundationSlug)) {
    throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', { operation });
  }

  return foundationSlug.toLowerCase();
}

/** Foundation + half-open `[startDate, endDate)` window + the two scope selects. `ytd` — defaulted or explicit — ends at tomorrow's UTC date so today's mentions fall inside the exclusive bound. */
export function parseSocialListeningScope(req: Request, operation: string): SocialListeningScopedOptionsParams {
  const period = getValidatedPeriod(req, operation);
  // A live mention feed reads ytd as through-today; the month-bounded analytics preset excludes the
  // current month and collapses to an empty window every January.
  const range = !period || period.type === 'ytd' ? yearToDateThroughToday() : period;

  return {
    foundationSlug: parseFoundationSlug(req, operation),
    startDate: range.startDate,
    endDate: range.endDate,
    sourceProjectId: parseTextParam(req, 'sourceProjectId', FILTER_VALUE_MAX_LENGTH, operation),
    platform: parseTextParam(req, 'platform', FILTER_VALUE_MAX_LENGTH, operation),
  };
}

/** Every feed filter. `all` and blank values normalize to `undefined` (no predicate). */
export function parseSocialListeningFilters(req: Request, operation: string): SocialListeningFilterParams {
  return {
    ...parseSocialListeningAuthorFilters(req, operation),
    authors: parseArrayParam(req, 'authors', MENTION_FILTER_MAX_VALUES, operation),
    mentionIds: parseArrayParam(req, 'mentionIds', MENTION_IDS_MAX_VALUES, operation),
    // Unread view: the client's persisted read state as a server-side exclusion predicate.
    unreadOnly: getStringQueryParam(req, 'unreadOnly') === 'true' || undefined,
    readIds: parseArrayParam(req, 'readIds', MENTION_READ_IDS_MAX_VALUES, operation),
    unreadIds: parseArrayParam(req, 'unreadIds', MENTION_READ_IDS_MAX_VALUES, operation),
    readBeforeTs: parseTimestampParam(req, 'readBeforeTs', operation),
  };
}

/** Analytics + tag filters — omits `mentionIds` and the unread read-state params: bookmarks are all-time and read state is per-user view state, so non-feed/count queries stay read-blind (the page strips them too). */
export function parseSocialListeningAnalyticsFilters(req: Request, operation: string): SocialListeningReadBlindFilterParams {
  return {
    ...parseSocialListeningAuthorFilters(req, operation),
    authors: parseArrayParam(req, 'authors', MENTION_FILTER_MAX_VALUES, operation),
  };
}

/** The filter subset the author-option query cascades off — omits `authors`/`mentionIds` and the unread read-state params so a multiselect never filters its own option list and author options stay read-state-blind. */
export function parseSocialListeningAuthorFilters(
  req: Request,
  operation: string
): Omit<SocialListeningReadBlindFilterParams, 'authors'> {
  return {
    sentiment: parseEnumParam(req, 'sentiment', VALID_SENTIMENTS, operation),
    relevance: parseEnumParam(req, 'relevance', VALID_RELEVANCES, operation),
    hasTitle: parseEnumParam(req, 'hasTitle', VALID_HAS_TITLE, operation),
    language: parseTextParam(req, 'language', FILTER_VALUE_MAX_LENGTH, operation),
    search: parseTextParam(req, 'search', SEARCH_MAX_LENGTH, operation),
    keywords: parseArrayParam(req, 'keywords', MENTION_FILTER_MAX_VALUES, operation),
    tags: parseArrayParam(req, 'tags', MENTION_FILTER_MAX_VALUES, operation),
  };
}

/** Feed window bounds. Both default to the first page and are clamped, never silently wrapped. */
export function parseSocialListeningPagination(req: Request, operation: string): { limit: number; offset: number } {
  return {
    limit: parseIntegerParam(req, 'limit', operation, { fallback: MAX_FEED_LIMIT, min: 1, max: MAX_FEED_LIMIT }),
    offset: parseIntegerParam(req, 'offset', operation, { fallback: 0, min: 0, max: MENTION_MAX_FEED_OFFSET }),
  };
}

/** Optional row cap for the panels that expose one (analytics top-projects, tag options); `undefined` lets the service apply its own default. */
export function parseSocialListeningLimit(req: Request, operation: string, max: number = MAX_ANALYTICS_LIMIT): number | undefined {
  if (getStringQueryParam(req, 'limit') === undefined) {
    return undefined;
  }

  return parseIntegerParam(req, 'limit', operation, { fallback: max, min: 1, max });
}

/** The `ytd` window: Jan 1 through today. Consumers treat `endDate` as exclusive, so it resolves to tomorrow's UTC date. */
function yearToDateThroughToday(): ResolvedPeriodRange {
  const now = new Date();
  const year = now.getUTCFullYear();
  // Date.UTC rolls month/year boundaries, so Dec 31 resolves to Jan 1 of next year.
  const tomorrow = new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1));

  return {
    type: 'ytd',
    startDate: `${year}-01-01`,
    endDate: tomorrow.toISOString().split('T')[0],
    label: `Year to Date (${year})`,
  };
}

/** Whitelisted single-select value. `all` means "no predicate" and normalizes to `undefined`. */
function parseEnumParam(req: Request, name: string, allowed: string[], operation: string): string | undefined {
  const raw = getStringQueryParam(req, name);

  if (!raw) {
    return undefined;
  }

  if (!allowed.includes(raw)) {
    throw ServiceValidationError.forField(name, `Invalid ${name} value. Allowed: ${allowed.join(', ')}`, { operation });
  }

  return raw.toLowerCase() === 'all' ? undefined : raw;
}

/** Length-bounded free-text value: values that become Snowflake binds can't be whitelisted, so they are bounded instead. */
function parseTextParam(req: Request, name: string, maxLength: number, operation: string): string | undefined {
  const raw = getStringQueryParam(req, name);

  if (raw === undefined) {
    return undefined;
  }

  const value = raw.trim();

  if (!value || value.toLowerCase() === 'all') {
    return undefined;
  }

  if (value.length > maxLength) {
    throw ServiceValidationError.forField(name, `${name} exceeds the ${maxLength}-character limit`, { operation });
  }

  return value;
}

/**
 * Repeated-key array params (`tags=a&tags=b`) as a bounded string array; a lone key collapses to one
 * element. Over-long lists are rejected rather than clamped (unlike `parseIntegerParam`) because
 * silently dropping filter values would return rows the caller's own predicate excludes.
 */
function parseArrayParam(req: Request, name: string, cap: number, operation: string): string[] | undefined {
  const raw = req.query[name];

  if (raw === undefined) {
    return undefined;
  }

  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length > cap) {
    throw ServiceValidationError.forField(name, `Too many ${name} values. Maximum is ${cap}`, { operation });
  }

  if (values.some((value) => value.length > FILTER_VALUE_MAX_LENGTH)) {
    throw ServiceValidationError.forField(name, `A ${name} value exceeds the ${FILTER_VALUE_MAX_LENGTH}-character limit`, { operation });
  }

  // A present-but-empty key must read as "no predicate" — a truthy `[]` zeroes the mention feed (`1 = 0`).
  return values.length === 0 ? undefined : values;
}

/**
 * Format-checked timestamp: the value reaches `TO_TIMESTAMP_NTZ(?)` as a bind, so an unparseable
 * shape would surface as a 500 Snowflake error instead of a 400. The regex pins the two accepted
 * shapes; the `Date.parse` round-trip rejects regex-shaped nonsense (`2026-13-40T99:99:99Z`).
 */
function parseTimestampParam(req: Request, name: string, operation: string): string | undefined {
  const value = parseTextParam(req, name, FILTER_VALUE_MAX_LENGTH, operation);

  if (value === undefined) {
    return undefined;
  }

  // Normalize the space separator so both accepted shapes parse as UTC for the validity check only — the original value is what gets bound.
  const isoCandidate = value.replace(' ', 'T');
  const asUtc = isoCandidate.endsWith('Z') ? isoCandidate : `${isoCandidate}Z`;
  // `Date.parse` normalizes calendar-impossible dates (Feb 30 rolls into March) instead of rejecting them —
  // the round-trip compare catches that: the parsed instant must reproduce the input's date-time fields.
  const parsed = Date.parse(asUtc);
  const calendarValid = !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 19) === isoCandidate.slice(0, 19);
  if (!READ_BEFORE_TS_PATTERN.test(value) || !calendarValid) {
    throw ServiceValidationError.forField(name, `Invalid ${name} format. Expected ISO 8601 or 'YYYY-MM-DD HH24:MI:SS'`, { operation });
  }

  return value;
}

/** Bounded integer query param. Rejects non-integers outright; out-of-range values clamp to the nearest bound. */
function parseIntegerParam(req: Request, name: string, operation: string, bounds: { fallback: number; min: number; max: number }): number {
  const raw = getStringQueryParam(req, name);

  if (raw === undefined || raw === '') {
    return bounds.fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw ServiceValidationError.forField(name, `${name} must be an integer`, { operation });
  }

  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}
