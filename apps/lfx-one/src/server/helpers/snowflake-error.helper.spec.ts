// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isInvalidIdentifierError, isInvalidRowCountError, isMissingObjectError, isPoolQueueFullError } from './snowflake-error.helper';

describe('isMissingObjectError', () => {
  it('matches a realistically wrapped missing-table error', () => {
    const error = new Error(
      "Snowflake query execution failed: SQL compilation error: Object 'ANALYTICS.PLATINUM_LFX_ONE.COMMITTEE_MEMBER_MEETING_ATTENDANCE' does not exist or not authorized."
    );
    expect(isMissingObjectError(error)).toBe(true);
  });

  it('does not match a wrong-column-name compilation error', () => {
    const error = new Error("Snowflake query execution failed: SQL compilation error: error line 2 at position 13\ninvalid identifier 'MEMBER_EMAIL'");
    expect(isMissingObjectError(error)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isMissingObjectError(new Error('Object X DOES NOT EXIST OR NOT AUTHORIZED.'))).toBe(true);
  });

  it('stringifies a non-Error value before matching', () => {
    expect(isMissingObjectError('Object X does not exist or not authorized.')).toBe(true);
    expect(isMissingObjectError({ some: 'object' })).toBe(false);
  });
});

describe('isInvalidIdentifierError', () => {
  it('matches invalid identifier compilation errors', () => {
    const error = new Error("Snowflake query execution failed: SQL compilation error: error line 2 at position 13\ninvalid identifier 'CONV'");
    expect(isInvalidIdentifierError(error)).toBe(true);
  });

  it('matches explicit Snowflake error code 904', () => {
    const error = new Error('SQL compilation error: error code: 904');
    expect(isInvalidIdentifierError(error)).toBe(true);
  });

  it('matches Snowflake error code 904 with leading zeros', () => {
    const error = new Error('SQL compilation error: error code: 000904');
    expect(isInvalidIdentifierError(error)).toBe(true);
  });

  it('matches the canonical Snowflake SDK code property', () => {
    const error = Object.assign(new Error('SQL compilation error'), { code: '000904' });
    expect(isInvalidIdentifierError(error)).toBe(true);
  });

  it('matches only the expected identifier when one is provided', () => {
    const error = new Error("SQL compilation error: invalid identifier 'LAST_TOUCH_CONVERSIONS'");
    expect(isInvalidIdentifierError(error, 'LAST_TOUCH_CONVERSIONS')).toBe(true);
    expect(isInvalidIdentifierError(error, 'CONV')).toBe(false);
  });

  it('does not match a longer identifier that shares the expected prefix', () => {
    const error = new Error("SQL compilation error: invalid identifier 'LAST_TOUCH_CONVERSIONS_VALUE'");
    expect(isInvalidIdentifierError(error, 'LAST_TOUCH_CONVERSIONS')).toBe(false);
  });

  it('does not accept an identifier-specific fallback from error code alone', () => {
    expect(isInvalidIdentifierError(new Error('SQL compilation error: error code: 904'), 'LAST_TOUCH_CONVERSIONS')).toBe(false);
  });

  it('does not match missing-object errors', () => {
    const error = new Error("Object 'ANALYTICS.PLATINUM_LFX_ONE.PAID_ADS_ATTRIBUTION' does not exist or not authorized.");
    expect(isInvalidIdentifierError(error)).toBe(false);
  });
});

describe('isPoolQueueFullError', () => {
  it("matches generic-pool's full waiting-queue rejection", () => {
    expect(isPoolQueueFullError(new Error('max waitingClients count exceeded'))).toBe(true);
  });

  it('does not match an acquire timeout, which can also mean Snowflake is unreachable', () => {
    const timeout = Object.assign(new Error('ResourceRequest timed out'), { name: 'TimeoutError' });
    expect(isPoolQueueFullError(timeout)).toBe(false);
  });

  it('does not match a Snowflake query error', () => {
    expect(isPoolQueueFullError(new Error('Network error. Could not reach Snowflake.'))).toBe(false);
  });
});

describe('isInvalidRowCountError', () => {
  it.each([
    ['OFFSET', "SQL compilation error:\nInvalid row count '10000000000000000000000000' in result offset clause", '002011'],
    ['LIMIT', "SQL compilation error:\nInvalid row count '10000000000000000000000000' in limit clause", '002010'],
  ])('matches an out-of-range %s row count by SDK code and by message', (_clause, message, code) => {
    expect(isInvalidRowCountError(Object.assign(new Error('SQL compilation error'), { code }))).toBe(true);
    expect(isInvalidRowCountError(new Error(`Snowflake query execution failed: ${message}`))).toBe(true);
  });

  it.each([
    ["Object 'ANALYTICS.PLATINUM_LFX_ONE.EXAMPLE' does not exist or not authorized."],
    ["SQL compilation error: error line 2 at position 13\ninvalid identifier 'MEMBER_EMAIL'"],
    ["SQL compilation error:\nsyntax error line 1 at position 30 unexpected '-'."],
    ['Network error. Could not reach Snowflake.'],
  ])('does not match any other failure: %s', (message) => {
    expect(isInvalidRowCountError(new Error(message))).toBe(false);
  });

  it('does not match an unrelated SDK error code', () => {
    expect(isInvalidRowCountError(Object.assign(new Error('SQL compilation error'), { code: '002003' }))).toBe(false);
  });
});
