// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal All Employees roster shapes for the Org Lens People backend services.
// They live in the shared package because AGENTS.md prohibits module-level interfaces
// inside apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.
// Merge-only data never leaves the server: `toWireRow` strips it before the
// response is cached or sent, and the cache validator rejects any entry carrying it.

import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeRow, OrgEmploymentFilter } from './org-people.interface';

/**
 * Roster row carrying every code count the commit filters can pick (lfx-self-serve#4164): `commitsCount` is
 * authored commits here, and the wire projection replaces it with the count the request's `commitScope` /
 * `metric` select. The stored roster and the cached directory hold this shape, so one entry serves every
 * commit scope and metric. Never sent.
 */
export interface OrgAllEmployeeCountedRow extends OrgAllEmployeeRow {
  /** Authored commits merged to the main branch. */
  mergedCommitsCount: number;
}

/** In-memory merge row — the counted shape plus the field the identity merge accumulates. Never cached, never sent. */
export interface OrgAllEmployeeRowInternal extends OrgAllEmployeeCountedRow {
  /** Every lowercased address that contributed to this row. Length > 1 is the normal result of a merge. */
  emails: string[];
}

/** Counted roster payload, before the commit filters pick a count and the tiles are counted. Never sent. */
export interface OrgAllEmployeesCountedResponse {
  accountId: string;
  rows: OrgAllEmployeeCountedRow[];
  foundations: OrgAllEmployeeFoundationOption[];
}

/** In-memory merge payload — the stored seed. Never cached, never sent. */
export interface OrgAllEmployeesInternalResponse extends OrgAllEmployeesCountedResponse {
  rows: OrgAllEmployeeRowInternal[];
}

/** Per-(account, person) roster row: one time range of `PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES`, or the unranged `ORG_PEOPLE_ALL`. */
export interface OrgPeopleAllRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  LFID: string | null;
  LF_USERNAME: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  PHOTO: string | null;
  SEATS_COUNT: number;
  BOARD_SEATS_COUNT: number;
  COMMITTEE_SEATS_COUNT: number;
  /** Authored commits (any branch) in the range and project scope; the unranged roster's code count. */
  COMMITS_COUNT: number;
  /** Authored commits merged to the main branch; the unranged roster repeats its COMMITS_COUNT. */
  MERGED_COMMITS_COUNT: number;
  /** Code-contribution activities; the unranged roster repeats its COMMITS_COUNT. */
  CODE_ACTIVITIES_COUNT: number;
  EVENTS_COUNT: number;
  COURSES_COUNT: number;
}

/** Roster row including the raw `ENGAGED_FOUNDATION_IDS` column (a Snowflake ARRAY may arrive as a JSON string or a parsed array). */
export type OrgPeopleAllRowRaw = OrgPeopleAllRow & { ENGAGED_FOUNDATION_IDS: string | string[] | null };

/** Distinct `(FOUNDATION_ID, FOUNDATION_NAME)` pair powering the All Foundations dropdown. */
export interface OrgPeopleFoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

/** Raw All Employees reads for one range: roster rows and the foundation dropdown pairs. */
export interface OrgAllEmployeesRaw {
  rowsRaw: OrgPeopleAllRowRaw[];
  foundationRaw: OrgPeopleFoundationOptionRow[];
}

/** Answer of the keyed former-employee check; `failed` answers are never cached. */
export interface OrgFormerEmployeeCheck {
  isFormer: boolean;
  failed: boolean;
}

/** One row of `PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS`. */
export interface OrgPersonCompanyEmailRow {
  EMAIL: string | null;
  /** Snowflake BOOLEAN arrives as a boolean; a 0/1 column is accepted too so the flag survives either shape. */
  IS_PRIMARY: boolean | number | null;
}

/** A person's employment at the account — current or former; the Employment filter's `all` is not a classification. */
export type OrgPersonEmployment = Exclude<OrgEmploymentFilter, 'all'>;

/**
 * One person's ORG_PEOPLE_ALL_RANGES row for a (range, project scope), classified by `IS_FORMER` (lfx-self-serve#4627).
 * Someone with no row is neither current nor former, so only the Employment filter's `all` lists them.
 */
export interface OrgPersonEmploymentRow {
  PERSON_KEY: string;
  EMPLOYMENT: OrgPersonEmployment;
}

/**
 * The account's classification for a (range, project scope) as stored in Valkey: the person keys of each class, without
 * the per-row field names (`people-employment:v2`). Someone in neither list has no roster row.
 */
export type OrgPersonEmploymentKeys = Record<OrgPersonEmployment, string[]>;
