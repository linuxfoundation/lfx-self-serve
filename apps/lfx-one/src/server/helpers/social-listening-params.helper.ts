// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTION_FILTER_MAX_VALUES,
  MENTION_HAS_TITLE_OPTIONS,
  MENTION_IDS_MAX_VALUES,
  MENTION_READ_IDS_MAX_VALUES,
  MENTION_RELEVANCE_OPTIONS,
  MENTION_SENTIMENT_OPTIONS,
  MENTION_SERVER_WINDOW_SIZE,
} from '@lfx-one/shared/constants';
import { resolvePeriodRange } from '@lfx-one/shared/utils/marketing-impact.utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam, getValidatedPeriod } from './validation.helper';

import type {
  ResolvedPeriodRange,
  SocialListeningAnalyticsParams,
  SocialListeningFeedParams,
  SocialListeningCountParams,
  SocialListeningFeedCursor,
  SocialListeningReadBlindFilterParams,
  SocialListeningScopedOptionsParams,
} from '@lfx-one/shared/interfaces';

/**
 * JSON-body and query-parameter parsing for the Social Listening endpoints: every value is validated
 * and bounded here so the service only binds vetted values. No logging — `apiErrorHandler` logs every
 * `ServiceValidationError` at WARN. Query array values arrive as repeated params.
 */

/** Foundation slugs are alphanumeric + hyphens. Case-insensitive because the dashboard-access middleware compares slugs case-insensitively and the client sends `project.slug` verbatim — the parsed value is normalized to lowercase before it reaches the Snowflake bind / cache key. */
const FOUNDATION_SLUG_PATTERN = /^[a-z0-9-]+$/i;

/** Matches the `isFilterSafeIdentifier()` ceiling so a passing slug can always build a Valkey cache key. */
const FOUNDATION_SLUG_MAX_LENGTH = 64;

/** Upper bound for a single filter value (a keyword, tag, author handle, language code, or id). */
const FILTER_VALUE_MAX_LENGTH = 200;

/** Bound the encoded cursor before allocating its decoded JSON; leaves room for escaped opaque keys. */
const FEED_PAGE_TOKEN_MAX_LENGTH = 4096;

/** Search terms get more room than a single-token filter but still can't be unbounded. */
const SEARCH_MAX_LENGTH = 500;

/**
 * Feed timestamp shape: ISO 8601 (`2026-08-01T00:00:00Z`) or Snowflake's space-separated form
 * (`2026-08-01 12:00:00`), optional millis — the two shapes feed-payload timestamps arrive in, since
 * `newestTsOf` passes them through verbatim and the page_token codec round-trips them byte-for-byte.
 */
const FEED_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/;

/**
 * Shape + calendar validity for a timestamp bound into `TO_TIMESTAMP_NTZ(?)` — an unparseable shape
 * would surface as a 500 Snowflake error instead of a 400. `Date.parse` normalizes calendar-impossible
 * dates (Feb 30 rolls into March) instead of rejecting them, so the round-trip compare requires the
 * parsed instant to reproduce the input's date-time fields.
 */
function isValidFeedTimestamp(value: string): boolean {
  if (!FEED_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  // Normalize the space separator so both accepted shapes parse as UTC for the validity check only — the original value is what gets bound.
  const isoCandidate = value.replace(' ', 'T');
  const asUtc = isoCandidate.endsWith('Z') ? isoCandidate : `${isoCandidate}Z`;
  const parsed = Date.parse(asUtc);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 19) === isoCandidate.slice(0, 19);
}

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

/** Foundation + half-open `[startDate, endDate)` window + the two scope selects. `ytd` — defaulted or explicit — ends at tomorrow's UTC date so today's mentions fall inside the exclusive bound. `allTime` skips the window entirely (mark-all-as-read newest lookup). */
export function parseSocialListeningScope(req: Request, operation: string): SocialListeningScopedOptionsParams {
  const allTime = getStringQueryParam(req, 'allTime') === 'true';
  const period = getValidatedPeriod(req, operation);
  // A live mention feed reads ytd as through-today; the month-bounded analytics preset excludes the
  // current month and collapses to an empty window every January.
  const range = !period || period.type === 'ytd' ? yearToDateThroughToday() : period;

  return {
    foundationSlug: parseFoundationSlug(req, operation),
    startDate: range.startDate,
    endDate: range.endDate,
    allTime,
    sourceProjectId: parseTextParam(req, 'sourceProjectId', FILTER_VALUE_MAX_LENGTH, operation),
    platform: parseTextParam(req, 'platform', FILTER_VALUE_MAX_LENGTH, operation),
  };
}

/** Governed analytics scope only: content filters and feed read state are deliberately not inspected. */
export function parseSocialListeningAnalyticsScope(req: Request, operation: string): SocialListeningAnalyticsParams {
  const period = getValidatedPeriod(req, operation);
  let periodKey = 'ytd';
  if (period?.type === 'month') {
    periodKey = period.startDate.slice(0, 7);
  } else if (period?.type === 'trailing') {
    periodKey = getStringQueryParam(req, 'period') as string;
  }

  return {
    foundationSlug: parseFoundationSlug(req, operation),
    periodKey,
    sourceProjectId: parseTextParam(req, 'sourceProjectId', FILTER_VALUE_MAX_LENGTH, operation),
    platform: parseTextParam(req, 'platform', FILTER_VALUE_MAX_LENGTH, operation)?.toLowerCase(),
  };
}

/** Complete JSON read payload; query readers share the same value normalization below. */
export function parseSocialListeningCountBody(body: unknown, operation: string): SocialListeningCountParams {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ServiceValidationError.forField('body', 'body must be a JSON object', { operation });
  }
  const fields = body as Record<string, unknown>;
  const text = (name: string): string | undefined => {
    const value = fields[name];
    if (value !== undefined && typeof value !== 'string') {
      throw ServiceValidationError.forField(name, `${name} must be a string`, { operation });
    }
    return value as string | undefined;
  };
  const foundationSlug = text('foundationSlug');
  if (!foundationSlug || foundationSlug.length > FOUNDATION_SLUG_MAX_LENGTH || !FOUNDATION_SLUG_PATTERN.test(foundationSlug)) {
    throw ServiceValidationError.forField('foundationSlug', 'Invalid or missing foundationSlug', { operation });
  }
  const period = text('period');
  const resolved = period ? resolvePeriodRange(period) : undefined;
  if (period && !resolved) {
    throw ServiceValidationError.forField('period', 'Invalid period value', { operation });
  }
  const range = !resolved || resolved.type === 'ytd' ? yearToDateThroughToday() : resolved;
  const array = (name: string, cap: number): string[] | undefined => {
    const value = fields[name];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw ServiceValidationError.forField(name, `${name} must be a string array`, { operation });
    }
    return normalizeArray(value, name, cap, operation);
  };
  const enumValue = (name: string, allowed: string[]) => normalizeEnum(text(name), name, allowed, operation);
  const readBeforeTs = normalizeTimestamp(normalizeText(text('readBeforeTs'), 'readBeforeTs', FILTER_VALUE_MAX_LENGTH, operation), 'readBeforeTs', operation);
  return {
    foundationSlug: foundationSlug.toLowerCase(),
    startDate: range.startDate,
    endDate: range.endDate,
    sourceProjectId: normalizeText(text('sourceProjectId'), 'sourceProjectId', FILTER_VALUE_MAX_LENGTH, operation),
    platform: normalizeText(text('platform'), 'platform', FILTER_VALUE_MAX_LENGTH, operation),
    sentiment: enumValue('sentiment', VALID_SENTIMENTS),
    relevance: enumValue('relevance', VALID_RELEVANCES),
    hasTitle: enumValue('hasTitle', VALID_HAS_TITLE),
    language: normalizeText(text('language'), 'language', FILTER_VALUE_MAX_LENGTH, operation),
    search: normalizeText(text('search'), 'search', SEARCH_MAX_LENGTH, operation),
    keywords: array('keywords', MENTION_FILTER_MAX_VALUES),
    tags: array('tags', MENTION_FILTER_MAX_VALUES),
    authors: array('authors', MENTION_FILTER_MAX_VALUES),
    mentionIds: array('mentionIds', MENTION_IDS_MAX_VALUES),
    readIds: array('readIds', MENTION_READ_IDS_MAX_VALUES),
    unreadIds: array('unreadIds', MENTION_READ_IDS_MAX_VALUES),
    unreadOnly: bodyBoolean(fields, 'unreadOnly', operation) || undefined,
    readBeforeTs,
  };
}

export function parseSocialListeningFeedBody(body: unknown, operation: string): SocialListeningFeedParams {
  const params = parseSocialListeningCountBody(body, operation);
  const fields = body as Record<string, unknown>;
  const pageSize = fields['page_size'];
  if (pageSize !== undefined && (typeof pageSize !== 'number' || !Number.isInteger(pageSize))) {
    throw ServiceValidationError.forField('page_size', 'page_size must be an integer number', { operation });
  }
  const token = fields['page_token'];
  if (token !== undefined && typeof token !== 'string') {
    throw ServiceValidationError.forField('page_token', 'page_token must be a string', { operation });
  }
  return {
    ...params,
    allTime: bodyBoolean(fields, 'allTime', operation),
    pageSize: pageSize === undefined ? MAX_FEED_LIMIT : Math.min(Math.max(pageSize as number, 1), MAX_FEED_LIMIT),
    cursor: token === undefined ? undefined : decodeMentionFeedPageToken(token as string, operation),
  };
}

function bodyBoolean(fields: Record<string, unknown>, name: string, operation: string): boolean {
  const value = fields[name];
  if (value !== undefined && typeof value !== 'boolean') {
    throw ServiceValidationError.forField(name, `${name} must be a boolean`, { operation });
  }
  return value === true;
}

/** Tags endpoint filters — omits `mentionIds` and the unread read-state params: bookmarks are all-time and read state is per-user view state, so tags stay read-blind (the page strips them too). */
export function parseSocialListeningAnalyticsFilters(req: Request, operation: string): SocialListeningReadBlindFilterParams {
  return {
    ...parseSocialListeningAuthorFilters(req, operation),
    authors: parseArrayParam(req, 'authors', MENTION_FILTER_MAX_VALUES, operation),
  };
}

/** The filter subset the author-option query cascades off — omits `authors`/`mentionIds` and the unread read-state params so a multiselect never filters its own option list and author options stay read-state-blind. */
export function parseSocialListeningAuthorFilters(req: Request, operation: string): Omit<SocialListeningReadBlindFilterParams, 'authors'> {
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

/** Encodes the keyset position of a page's last kept row as an opaque base64url `page_token` (house cursor pattern, `docs/architecture/backend/pagination.md`). */
export function encodeMentionFeedPageToken(cursor: SocialListeningFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decodes an incoming `page_token` — malformed or tampered tokens 400, never silently restart the feed. `ts` stays verbatim (no TZ reinterpretation) so the bound value matches the issued one byte-for-byte. */
function decodeMentionFeedPageToken(raw: string, operation: string): SocialListeningFeedCursor {
  if (raw.length > FEED_PAGE_TOKEN_MAX_LENGTH) {
    throw ServiceValidationError.forField('page_token', 'page_token is too long', { operation });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }

  const candidate = parsed as Partial<SocialListeningFeedCursor> | null;
  const ts = candidate?.ts;
  const tsValid = ts === null || (typeof ts === 'string' && isValidFeedTimestamp(ts));
  if (!tsValid || typeof candidate?.key !== 'string' || candidate.key === '' || candidate.key.length > FILTER_VALUE_MAX_LENGTH) {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }

  return { ts, key: candidate.key };
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
  return normalizeEnum(getStringQueryParam(req, name), name, allowed, operation);
}

function normalizeEnum(raw: string | undefined, name: string, allowed: string[], operation: string): string | undefined {
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
  return normalizeText(getStringQueryParam(req, name), name, maxLength, operation);
}

function normalizeText(raw: string | undefined, name: string, maxLength: number, operation: string): string | undefined {
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

  return normalizeArray(
    (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string'),
    name,
    cap,
    operation
  );
}

function normalizeArray(raw: string[], name: string, cap: number, operation: string): string[] | undefined {
  const values = raw.map((value) => value.trim()).filter(Boolean);

  if (values.length > cap) {
    throw ServiceValidationError.forField(name, `Too many ${name} values. Maximum is ${cap}`, { operation });
  }

  if (values.some((value) => value.length > FILTER_VALUE_MAX_LENGTH)) {
    throw ServiceValidationError.forField(name, `A ${name} value exceeds the ${FILTER_VALUE_MAX_LENGTH}-character limit`, { operation });
  }

  // A present-but-empty key must read as "no predicate" — a truthy `[]` zeroes the mention feed (`1 = 0`).
  return values.length === 0 ? undefined : values;
}

function normalizeTimestamp(value: string | undefined, name: string, operation: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isValidFeedTimestamp(value)) {
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
