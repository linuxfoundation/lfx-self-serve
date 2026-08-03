// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mirrors committee-engagement-window.helper.spec.ts: `@lfx-one/shared/constants` resolves through
// a barrel with transitive imports that don't survive outside an Angular build/test context, so the
// two values this helper needs are deep-imported from their real implementation instead.
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/activity-event.constants')>(
    '../../../../../packages/shared/src/constants/activity-event.constants'
  );
  return {
    ACTIVITY_FEED_DEFAULT_PAGE_SIZE: actual.ACTIVITY_FEED_DEFAULT_PAGE_SIZE,
    ACTIVITY_FEED_MAX_PAGE_SIZE: actual.ACTIVITY_FEED_MAX_PAGE_SIZE,
  };
});

import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { encodeActivityPageToken, parseCommitteeActivityQuery } from './committee-activity-query.helper';

function mockRequest(query: Record<string, string | string[]> = {}): Request {
  return { query } as unknown as Request;
}

const OPERATION = 'get_committee_activity';

describe('parseCommitteeActivityQuery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults limit to 8 and leaves since/cursor undefined when omitted', () => {
    expect(parseCommitteeActivityQuery(mockRequest(), OPERATION)).toEqual({ since: undefined, cursor: undefined, limit: 8 });
  });

  it('passes through a valid ISO since value, normalized to RFC3339 with milliseconds', () => {
    const result = parseCommitteeActivityQuery(mockRequest({ since: '2026-01-01T00:00:00Z' }), OPERATION);
    expect(result.since).toBe('2026-01-01T00:00:00.000Z');
  });

  it('normalizes a zone-less since value (interpreted in the server timezone) to UTC RFC3339', () => {
    // Upstream (query-service) only accepts strict RFC3339 or date-only; Date.parse is more
    // permissive (no zone designator, slash-separated, etc.) — an unnormalized value forwarded
    // as-is would 400 upstream on every leg and silently degrade to an empty feed instead.
    // Pinned against a literal (not `new Date(x).toISOString()`, which would just restate the
    // implementation) and TZ stubbed explicitly, since a zone-less string is parsed in the
    // server's local timezone — the exact behavior normalizeTimestamp's caller should know about.
    vi.stubEnv('TZ', 'UTC');
    const result = parseCommitteeActivityQuery(mockRequest({ since: '2026-01-01T00:00:00' }), OPERATION);
    expect(result.since).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects an unparseable since value instead of silently ignoring it', () => {
    expect(() => parseCommitteeActivityQuery(mockRequest({ since: 'not-a-timestamp' }), OPERATION)).toThrow(ServiceValidationError);
  });

  it('accepts a page_size within bounds', () => {
    expect(parseCommitteeActivityQuery(mockRequest({ page_size: '25' }), OPERATION).limit).toBe(25);
  });

  it.each(['0', '51', 'abc', '3.5'])('rejects an out-of-range or non-integer page_size value %s', (pageSize) => {
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_size: pageSize }), OPERATION)).toThrow(ServiceValidationError);
  });

  it('accepts page_size at the upper bound (50)', () => {
    expect(parseCommitteeActivityQuery(mockRequest({ page_size: '50' }), OPERATION).limit).toBe(50);
  });

  it('round-trips a page_token produced by encodeActivityPageToken back to the same cursor, normalized', () => {
    const token = encodeActivityPageToken({ before: '2026-01-05T00:00:00Z', key: 'vote:vote-1' });
    const result = parseCommitteeActivityQuery(mockRequest({ page_token: token }), OPERATION);
    expect(result.cursor).toEqual({ before: '2026-01-05T00:00:00.000Z', key: 'vote:vote-1' });
  });

  it('normalizes a decoded page_token before value the same way as since', () => {
    vi.stubEnv('TZ', 'UTC');
    const badToken = Buffer.from(JSON.stringify({ before: '2026-01-05T00:00:00', key: 'vote:vote-1' }), 'utf8').toString('base64url');
    const result = parseCommitteeActivityQuery(mockRequest({ page_token: badToken }), OPERATION);
    expect(result.cursor?.before).toBe('2026-01-05T00:00:00.000Z');
  });

  it('rejects a malformed page_token instead of silently restarting the feed', () => {
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_token: 'not-base64-json' }), OPERATION)).toThrow(ServiceValidationError);
  });

  it('rejects a page_token that decodes to valid JSON but the wrong shape', () => {
    const badToken = Buffer.from(JSON.stringify({ before: 12345, key: 'x' }), 'utf8').toString('base64url');
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_token: badToken }), OPERATION)).toThrow(ServiceValidationError);
  });

  it('rejects a page_token whose before value is not a valid timestamp', () => {
    const badToken = Buffer.from(JSON.stringify({ before: 'not-a-timestamp', key: 'x' }), 'utf8').toString('base64url');
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_token: badToken }), OPERATION)).toThrow(ServiceValidationError);
  });

  it('rejects a page_token with a missing or empty key', () => {
    const missingKey = Buffer.from(JSON.stringify({ before: '2026-01-05T00:00:00Z' }), 'utf8').toString('base64url');
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_token: missingKey }), OPERATION)).toThrow(ServiceValidationError);

    const emptyKey = Buffer.from(JSON.stringify({ before: '2026-01-05T00:00:00Z', key: '' }), 'utf8').toString('base64url');
    expect(() => parseCommitteeActivityQuery(mockRequest({ page_token: emptyKey }), OPERATION)).toThrow(ServiceValidationError);
  });

  // Express's default `qs`-based query parser turns a repeated param (`?since=a&since=b`) into an
  // array, not a string. Silently treating that the same as "absent" would restart pagination
  // (page_token), ignore since, or fall back page_size to its default with no error surfaced —
  // CodeRabbit flagged this independently, confirmed by dealako.
  it.each(['since', 'page_size', 'page_token'])('rejects a repeated (array-valued) %s instead of silently treating it as absent', (param) => {
    expect(() => parseCommitteeActivityQuery(mockRequest({ [param]: ['a', 'b'] }), OPERATION)).toThrow(ServiceValidationError);
  });
});
