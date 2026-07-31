// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

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

function mockRequest(query: Record<string, string> = {}): Request {
  return { query } as unknown as Request;
}

const OPERATION = 'get_committee_activity';

describe('parseCommitteeActivityQuery', () => {
  it('defaults limit to 8 and leaves since/cursor undefined when omitted', () => {
    expect(parseCommitteeActivityQuery(mockRequest(), OPERATION)).toEqual({ since: undefined, cursor: undefined, limit: 8 });
  });

  it('passes through a valid ISO since value', () => {
    const result = parseCommitteeActivityQuery(mockRequest({ since: '2026-01-01T00:00:00Z' }), OPERATION);
    expect(result.since).toBe('2026-01-01T00:00:00Z');
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

  it('round-trips a page_token produced by encodeActivityPageToken back to the same cursor', () => {
    const token = encodeActivityPageToken({ before: '2026-01-05T00:00:00Z', key: 'vote:vote-1' });
    const result = parseCommitteeActivityQuery(mockRequest({ page_token: token }), OPERATION);
    expect(result.cursor).toEqual({ before: '2026-01-05T00:00:00Z', key: 'vote:vote-1' });
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
});
