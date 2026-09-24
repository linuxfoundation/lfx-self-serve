// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal All Employees roster shapes for the Org Lens People backend services.
// They live in the shared package because CLAUDE.md prohibits module-level interfaces
// inside apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.
// Merge-only data never leaves the server: `toWireRow` strips it before the
// response is cached or sent, and the cache validator rejects any entry carrying it.

import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeRow, OrgAllEmployeeStats } from './org-people.interface';

/** In-memory merge row — the wire shape plus the field the identity merge accumulates. Never cached, never sent. */
export interface OrgAllEmployeeRowInternal extends OrgAllEmployeeRow {
  /** Every lowercased address that contributed to this row. Length > 1 is the normal result of a merge. */
  emails: string[];
}

/** In-memory merge payload — the stored seed and the pre-strip merge result. Never cached, never sent. */
export interface OrgAllEmployeesInternalResponse {
  accountId: string;
  rows: OrgAllEmployeeRowInternal[];
  stats: OrgAllEmployeeStats;
  foundations: OrgAllEmployeeFoundationOption[];
}

/** Per-(account, person) row from `PLATINUM_LFX_ONE.ORG_PEOPLE_ALL`. */
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
  COMMITS_COUNT: number;
  EVENTS_COUNT: number;
  COURSES_COUNT: number;
}

/** Roster row including the raw `ENGAGED_FOUNDATION_IDS` column (a Snowflake ARRAY may arrive as a JSON string or a parsed array). */
export type OrgPeopleAllRowRaw = OrgPeopleAllRow & { ENGAGED_FOUNDATION_IDS: string | string[] | null };

/** One-row aggregate from `PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_STATS`. */
export interface OrgPeopleAllStatsRow {
  ACCOUNT_ID: string;
  ACTIVE_IN_OSS: number;
  IN_GOVERNANCE: number;
  CODE_CONTRIBUTORS: number;
  EVENT_ATTENDEES: number;
  TRAINEES: number;
}

/** Distinct `(FOUNDATION_ID, FOUNDATION_NAME)` pair powering the All Foundations dropdown. */
export interface OrgPeopleFoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}
