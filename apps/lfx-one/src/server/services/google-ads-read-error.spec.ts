// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ERROR_CODES, GOOGLE_ADS_NOT_CONFIGURED_MESSAGE, GOOGLE_ADS_READ_FAILED_MESSAGE } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { MicroserviceError } from '../errors';
import { GoogleAdsNotConfiguredError, googleAdsFailureCode, toGoogleAdsReadError } from './google-ads-read-error';

/** A synthetic `GoogleAdsFailure`-shaped rejection: not an `Error`, with `errors[0].error_code`. */
const failure = (errorCode: Record<string, unknown>, message = 'synthetic upstream detail for acme-foundation'): unknown => ({
  errors: [{ error_code: errorCode, message }],
});

describe('toGoogleAdsReadError (#4526)', () => {
  it('answers a missing credential with an authored 503 advisory', () => {
    const result = toGoogleAdsReadError(new GoogleAdsNotConfiguredError('Google Ads credentials not configured (GADS_CLIENT_ID)'), 'campaign_monitor');

    expect(result).toBeInstanceOf(MicroserviceError);
    const error = result as MicroserviceError;
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ERROR_CODES.SERVICE_ADVISORY);
    expect(error.message).toBe(GOOGLE_ADS_NOT_CONFIGURED_MESSAGE);
    // The env var names stay in the log, never in the response.
    expect(JSON.stringify(error.toResponse())).not.toContain('GADS_CLIENT_ID');
    expect(error.getLogContext()['original_error']).toContain('GADS_CLIENT_ID');
  });

  it('names the Google Ads error code of a failure, and keeps its free text out of the response', () => {
    const error = toGoogleAdsReadError(failure({ authentication_error: 'OAUTH_TOKEN_REVOKED' }), 'campaign_monitor') as MicroserviceError;

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe(ERROR_CODES.SERVICE_ADVISORY);
    expect(error.message).toBe(`${GOOGLE_ADS_READ_FAILED_MESSAGE} Google Ads error: OAUTH_TOKEN_REVOKED.`);
    expect(error.operation).toBe('campaign_monitor');
    expect(JSON.stringify(error.toResponse())).not.toContain('synthetic upstream detail');
    expect(error.getLogContext()['original_error']).toBe('synthetic upstream detail for acme-foundation');
  });

  it('falls back to a generic advisory for a plain error, logging its message', () => {
    const error = toGoogleAdsReadError(new Error('socket hang up'), 'campaign_monitor') as MicroserviceError;

    expect(error.statusCode).toBe(502);
    expect(error.message).toBe(`${GOOGLE_ADS_READ_FAILED_MESSAGE} Please try again.`);
    expect(error.getLogContext()['original_error']).toBe('socket hang up');
  });

  it('passes an API error through unchanged', () => {
    const original = new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation: 'campaign_monitor' });

    expect(toGoogleAdsReadError(original, 'campaign_monitor')).toBe(original);
  });
});

describe('googleAdsFailureCode', () => {
  it.each([
    ['a quota code', failure({ quota_error: 'RESOURCE_EXHAUSTED' }), 'RESOURCE_EXHAUSTED'],
    ['no errors array', { message: 'x' }, null],
    ['an empty errors array', { errors: [] }, null],
    ['a code that is not an identifier', failure({ request_error: '<script>alert(1)</script>' }), null],
    ['a non-string code', failure({ request_error: 7 }), null],
    ['null', null, null],
  ])('reads %s', (_label, error, expected) => {
    expect(googleAdsFailureCode(error)).toBe(expected);
  });
});
