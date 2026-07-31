// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACTIVITY_FEED_DEFAULT_PAGE_SIZE, ACTIVITY_FEED_MAX_PAGE_SIZE } from '@lfx-one/shared/constants';
import type { ActivityPageTokenPayload, CommitteeActivityQuery } from '@lfx-one/shared/interfaces';
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
    since = rawSince;
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
  const before = rawPageToken !== undefined ? decodePageToken(rawPageToken, operation) : undefined;

  return { since, before, limit };
}
