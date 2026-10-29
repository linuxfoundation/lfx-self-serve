// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isInvalidIdentifierError, isInvalidRowCountError, isMissingObjectError, isPoolQueueFullError, isValueConversionError } from './snowflake-error.helper';

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

  describe('with an expected object', () => {
    const missing = (object: string) =>
      new Error(`Snowflake query execution failed: SQL compilation error: Object '${object}' does not exist or not authorized.`);

    it('matches the blamed object by its unqualified name', () => {
      expect(isMissingObjectError(missing('ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(true);
      expect(isMissingObjectError(missing('ORG_PEOPLE_COMPANY_EMAILS'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(true);
    });

    // The whole point of the argument: a core table going missing in the same statement must not be
    // exempted by a caller that only expects its own optional table to be absent.
    it('does not match a different missing object', () => {
      expect(isMissingObjectError(missing('ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(false);
      expect(isMissingObjectError(missing('ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(false);
    });

    it('requires a dot at the qualified-name boundary', () => {
      expect(isMissingObjectError(missing('ANALYTICS.SILVER_FACT.LEGACY_EVENT_REGISTRATIONS'), 'EVENT_REGISTRATIONS')).toBe(false);
    });

    it('does not match when Snowflake names no object', () => {
      const unnamed = new Error('SQL compilation error: Object does not exist or not authorized.');
      expect(isMissingObjectError(unnamed)).toBe(true);
      expect(isMissingObjectError(unnamed, 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(false);
    });

    it('ignores case and quoting on both sides', () => {
      expect(isMissingObjectError(missing('analytics.platinum_lfx_one.org_people_company_emails'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(true);
      expect(isMissingObjectError(new Error('Table "ORG_PEOPLE_COMPANY_EMAILS" does not exist or not authorized.'), 'ORG_PEOPLE_COMPANY_EMAILS')).toBe(true);
    });
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

describe('isValueConversionError', () => {
  it.each(['Date', 'Timestamp', 'Time', 'Numeric value', 'Boolean value'])('matches an unrecognized %s by message', (type) => {
    expect(isValueConversionError(new Error(`Snowflake query execution failed: ${type} 'x' is not recognized`))).toBe(true);
  });

  it.each([100038, '100038', '0100038'])('matches the confirmed numeric-conversion code %j', (code) => {
    expect(isValueConversionError(Object.assign(new Error('Conversion failed'), { code }))).toBe(true);
  });

  it('matches case-insensitive messages and string rejections', () => {
    expect(isValueConversionError("TIMESTAMP 'x' IS NOT RECOGNIZED")).toBe(true);
  });

  it.each([
    "Object 'ANALYTICS.PLATINUM_LFX_ONE.EXAMPLE' does not exist or not authorized.",
    "SQL compilation error: invalid identifier 'MEMBER_EMAIL'",
    "SQL compilation error: syntax error line 1 unexpected '-'.",
    "Invalid row count '10000000000000000000000000' in result offset clause",
    'max waitingClients count exceeded',
    'Network error. Could not reach Snowflake.',
    'Incorrect username or password.',
    "Session parameter 'EXAMPLE' is not recognized",
    "Numeric value '345.123' is out of range",
  ])('does not exempt unrelated failures: %s', (message) => {
    expect(isValueConversionError(new Error(message))).toBe(false);
  });

  it.each(['100040', '100035', '002003', '002011', null, undefined])('does not match an unconfirmed or unrelated code alone: %j', (code) => {
    expect(isValueConversionError(Object.assign(new Error('Other failure'), { code }))).toBe(false);
  });

  it.each([null, undefined, { message: 'Other failure' }])('handles non-Error rejection values %j', (error) => {
    expect(isValueConversionError(error)).toBe(false);
  });
});
