// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_DEFAULT_LIMIT, ACTIVITY_FEED_MAX_LIMIT } from '@lfx-one/shared/constants';
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

/** Parsed, validated query for `GET /api/committees/:uid/activity`. */
export interface CommitteeActivityQuery {
  /** Inclusive lower bound on `occurred_at`, applied as `date_from` on every source that supports it. */
  since?: string;
  /** Exclusive upper bound on `occurred_at`, decoded from an incoming `page_token`. Undefined on page 1. */
  before?: string;
  limit: number;
}

/** Shape encoded into the opaque `page_token` string — see `encodeActivityPageToken`. */
interface ActivityPageTokenPayload {
  before: string;
}

function isParseableTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * Encodes the cursor for "the next page starts strictly before this timestamp" as an opaque
 * base64url string. Timestamp-based, not offset-based — matches the house cursor-pagination
 * pattern (`docs/architecture/backend/pagination.md`) while working across a merge of 4
 * independently-paginated upstream sources, which a single shared `page_token` per source could not.
 */
export function encodeActivityPageToken(before: string): string {
  return Buffer.from(JSON.stringify({ before } satisfies ActivityPageTokenPayload), 'utf8').toString('base64url');
}

/**
 * Decodes a `page_token` produced by `encodeActivityPageToken`. Untrusted client input — malformed
 * or tampered tokens are a 400, not a silently-ignored value (mirrors `parseCommitteeEngagementWindow`'s
 * "never a silent fallback for a bad explicit value" rule), since silently ignoring a bad token would
 * quietly restart the feed from the newest page instead of surfacing the client's stale/corrupt cursor.
 */
function decodePageToken(raw: string, operation: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }
  const before = (parsed as Partial<ActivityPageTokenPayload> | null)?.before;
  if (typeof before !== 'string' || !isParseableTimestamp(before)) {
    throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation });
  }
  return before;
}

/**
 * Parses and validates `since`, `limit`, and `page_token` for the committee activity feed endpoint.
 * An omitted `since`/`limit` takes its default silently; an explicit-but-invalid value is a 400 —
 * answering a bad `?limit=abc` with the default would silently mask the caller's mistake.
 */
export function parseCommitteeActivityQuery(req: Request, operation: string): CommitteeActivityQuery {
  const rawSince = getStringQueryParam(req, 'since');
  let since: string | undefined;
  if (rawSince !== undefined) {
    if (!isParseableTimestamp(rawSince)) {
      throw ServiceValidationError.forField('since', 'since must be a valid ISO 8601 timestamp', { operation });
    }
    since = rawSince;
  }

  const rawLimit = getStringQueryParam(req, 'limit');
  let limit = ACTIVITY_FEED_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsedLimit = Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > ACTIVITY_FEED_MAX_LIMIT) {
      throw ServiceValidationError.forField('limit', `limit must be an integer between 1 and ${ACTIVITY_FEED_MAX_LIMIT}`, { operation });
    }
    limit = parsedLimit;
  }

  const rawPageToken = getStringQueryParam(req, 'page_token');
  const before = rawPageToken !== undefined ? decodePageToken(rawPageToken, operation) : undefined;

  return { since, before, limit };
}
