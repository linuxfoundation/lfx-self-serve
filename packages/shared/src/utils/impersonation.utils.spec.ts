// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  classifyImpersonationExchangeFailure,
  classifyImpersonationSearchFailure,
  isImpersonationTargetLookupFailure,
  resolveImpersonationStartErrorMessage,
} from './impersonation.utils';

describe('isImpersonationTargetLookupFailure', () => {
  it('matches the Auth0 CTE deny prefix from the documented NATS contract', () => {
    expect(isImpersonationTargetLookupFailure("target_user_not_found: Target user 'HWilson' not found")).toBe(true);
  });

  it('matches the auth-service wrap for an Auth0 400 (current production string)', () => {
    expect(isImpersonationTargetLookupFailure('token exchange request failed: upstream returned status 400')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isImpersonationTargetLookupFailure('  TARGET_USER_NOT_FOUND: missing  ')).toBe(true);
    expect(isImpersonationTargetLookupFailure('Token Exchange Request Failed: Upstream Returned Status 400')).toBe(true);
  });

  it('does not treat Management API lookup failures as a not-found', () => {
    expect(isImpersonationTargetLookupFailure('target_user_lookup_failed: Failed to look up target user: timeout')).toBe(false);
  });

  it('does not match unrelated exchange or transport failures', () => {
    expect(isImpersonationTargetLookupFailure('impersonation flow unavailable')).toBe(false);
    expect(isImpersonationTargetLookupFailure('token exchange request failed: upstream returned status 500')).toBe(false);
    expect(isImpersonationTargetLookupFailure('')).toBe(false);
  });
});

describe('classifyImpersonationExchangeFailure', () => {
  it('maps a lookup miss to 404 TARGET_USER_NOT_FOUND and the locate copy', () => {
    expect(classifyImpersonationExchangeFailure('token exchange request failed: upstream returned status 400')).toEqual({
      statusCode: 404,
      code: 'TARGET_USER_NOT_FOUND',
      message: 'We were unable to locate the user to impersonate. Please double-check the username or email address and try again.',
    });
  });

  it('maps other exchange failures to 400 CTE_EXCHANGE_FAILED and the generic copy', () => {
    expect(classifyImpersonationExchangeFailure('impersonation flow unavailable')).toEqual({
      statusCode: 400,
      code: 'CTE_EXCHANGE_FAILED',
      message: 'We could not start impersonation. Please try again.',
    });
  });
});

describe('resolveImpersonationStartErrorMessage', () => {
  it('returns the locate copy for TARGET_USER_NOT_FOUND', () => {
    expect(resolveImpersonationStartErrorMessage('TARGET_USER_NOT_FOUND')).toBe(
      'We were unable to locate the user to impersonate. Please double-check the username or email address and try again.'
    );
  });

  it('never surfaces a raw upstream string for unknown or missing codes', () => {
    expect(resolveImpersonationStartErrorMessage('CTE_EXCHANGE_FAILED')).toBe('We could not start impersonation. Please try again.');
    expect(resolveImpersonationStartErrorMessage(undefined)).toBe('We could not start impersonation. Please try again.');
  });
});

describe('classifyImpersonationSearchFailure', () => {
  it.each([
    ['subject_token is not authorized to impersonate', 403, 'IMPERSONATION_SEARCH_FORBIDDEN'],
    ['invalid subject_token', 403, 'IMPERSONATION_SEARCH_FORBIDDEN'],
    ['query needs at least one term of 3 or more characters', 400, 'IMPERSONATION_SEARCH_INVALID'],
    ['query is too long', 400, 'IMPERSONATION_SEARCH_INVALID'],
    ['user search is unavailable', 503, 'IMPERSONATION_SEARCH_UNAVAILABLE'],
    ['user search unavailable', 503, 'IMPERSONATION_SEARCH_UNAVAILABLE'],
    ['something unexpected', 502, 'IMPERSONATION_SEARCH_FAILED'],
  ])('maps %j to %i %s', (upstreamError, statusCode, code) => {
    expect(classifyImpersonationSearchFailure(upstreamError)).toMatchObject({ statusCode, code });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(classifyImpersonationSearchFailure('  Query Is Too Long  ').statusCode).toBe(400);
  });

  it('never returns the upstream text as the public message', () => {
    const upstream = 'query needs at least one term, for jane.doe@example.test';

    expect(classifyImpersonationSearchFailure(upstream).message).not.toContain('jane.doe');
  });
});
