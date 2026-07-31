// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_DEFAULT_PAGE_SIZE, ACTIVITY_FEED_MAX_PAGE_SIZE } from '@lfx-one/shared/constants';
import type { ActivityPageCursor, CommitteeActivityQuery } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { ServiceValidationError } from '../errors';

/**
 * Not `validation.helper.ts`'s `getStringQueryParam` — that module also imports
 * `@lfx-one/shared/utils`, which pulls in Angular-only runtime code that Vitest can't resolve
 * outside an Angular context (same issue documented in `activity-feed.utils.ts`). Inlined locally
 * to keep this helper's unit test importable without mocking half of `validation.helper.ts`.
 */
function getStringQueryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

function isParseableTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * Normalizes an already-validated (`isParseableTimestamp`) timestamp to RFC3339. `Date.parse`
 * accepts formats upstream doesn't — e.g. `2026-01-05T00:00:00` with no zone designator, or
 * `2026/01/05` — and query-service's `date_from`/`date_to` require strict RFC3339 or date-only,
 * rejecting anything else with a 400. Since every leg's `.catch()` degrades that 400 into an
 * empty result for its source (LFXV2-1707's graceful-degradation-per-leg design), an unnormalized
 * value wouldn't surface as an error at all — it would silently return a thinner feed. Normalizing
 * once here, rather than validating against the stricter upstream grammar, keeps any
 * currently-working caller working.
 */
function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Encodes a keyset pagination position as an opaque base64url string. `(before, key)` compound —
 * not a bare timestamp — matches the house cursor-pagination pattern
 * (`docs/architecture/backend/pagination.md`) while staying correct across a merge of 4
 * independently-paginated upstream sources: a bare timestamp cursor can't distinguish between
 * multiple events sharing the exact same `occurred_at` (e.g. a batch of documents uploaded in one
 * request), so `key` (see `eventKey` in `committee-activity.service.ts`) breaks the tie.
 */
export function encodeActivityPageToken(cursor: ActivityPageCursor): string {
  return Buffer.from(JSON.stringify(cursor satisfies ActivityPageCursor), 'utf8').toString('base64url');
}

/**
 * Decodes a `page_token` produced by `encodeActivityPageToken`. Untrusted client input — malformed
 * or tampered tokens are a 400, not a silently-ignored value (mirrors `parseCommitteeEngagementWindow`'s
 * "never a silent fallback for a bad explicit value" rule), since silently ignoring a bad token would
 * quietly restart the feed from the newest page instead of surfacing the client's stale/corrupt cursor.
 */
function decodePageToken(raw: string, operation: string): ActivityPageCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }
  const candidate = parsed as Partial<ActivityPageCursor> | null;
  if (typeof candidate?.before !== 'string' || !isParseableTimestamp(candidate.before) || typeof candidate.key !== 'string' || candidate.key === '') {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }
  return { before: normalizeTimestamp(candidate.before), key: candidate.key };
}

/**
 * Parses and validates `since`, `page_size`, and `page_token` for the committee activity feed
 * endpoint (`page_size`, not `limit` — matches the house pagination convention documented in
 * `docs/architecture/backend/pagination.md`). An omitted `since`/`page_size` takes its default
 * silently; an explicit-but-invalid value is a 400 — answering a bad `?page_size=abc` with the
 * default would silently mask the caller's mistake.
 */
export function parseCommitteeActivityQuery(req: Request, operation: string): CommitteeActivityQuery {
  const rawSince = getStringQueryParam(req, 'since');
  let since: string | undefined;
  if (rawSince !== undefined) {
    if (!isParseableTimestamp(rawSince)) {
      throw ServiceValidationError.forField('since', 'since must be a valid ISO 8601 timestamp', { operation });
    }
    since = normalizeTimestamp(rawSince);
  }

  const rawPageSize = getStringQueryParam(req, 'page_size');
  let limit = ACTIVITY_FEED_DEFAULT_PAGE_SIZE;
  if (rawPageSize !== undefined) {
    const parsedPageSize = Number(rawPageSize);
    if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > ACTIVITY_FEED_MAX_PAGE_SIZE) {
      throw ServiceValidationError.forField('page_size', `page_size must be an integer between 1 and ${ACTIVITY_FEED_MAX_PAGE_SIZE}`, { operation });
    }
    limit = parsedPageSize;
  }

  const rawPageToken = getStringQueryParam(req, 'page_token');
  const cursor = rawPageToken !== undefined ? decodePageToken(rawPageToken, operation) : undefined;

  return { since, cursor, limit };
}
