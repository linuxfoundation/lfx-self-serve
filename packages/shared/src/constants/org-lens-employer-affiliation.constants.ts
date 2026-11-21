// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * #4314 — the values behind matching a caller's profile employer to a Salesforce account, shared so
 * the BFF's TypeScript key and its SQL twin are built from one list.
 */

/** Guards the `IN` list: far above any real number of concurrent jobs, and bounded all the same. */
export const MAX_CURRENT_EMPLOYERS = 10;

/**
 * Legal-form suffixes dropped before an employer name is compared to a Salesforce account name. A
 * profile says "Acme"; Salesforce says "Acme LLC". Without this, that member company misses its own
 * account and its employee is told their employer is not a member — the wrong copy, stated definitively.
 *
 * Only these, and only one of them, and only at the end: a trailing legal form is the one part of a
 * company name that is routinely written or omitted at will. Anything more aggressive starts merging
 * genuinely different companies, and a wrong "member" answer silently hides that state.
 */
export const LEGAL_FORM_SUFFIXES: readonly string[] = [
  'INC',
  'INCORPORATED',
  'LLC',
  'LLP',
  'LTD',
  'LIMITED',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'GMBH',
  'AG',
  'SA',
  'SAS',
  'SPA',
  'BV',
  'NV',
  'PLC',
  'PTY',
  'OY',
  'AB',
  'AS',
  'KK',
  'SRL',
  'SL',
] as const;
