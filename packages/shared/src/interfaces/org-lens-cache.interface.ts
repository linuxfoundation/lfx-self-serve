// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable } from './compact-cache.interface';
import type { CommitteeServiceOrgSeat } from './org-memberships.interface';
import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeStats } from './org-people.interface';

/**
 * The committee-level fields every seat carries, stored once per distinct combination in
 * {@link CompactOrgSeatsEntry.c} (GH-1906).
 */
export type SeatCommittee = Pick<CommitteeServiceOrgSeat, 'committee_uid' | 'committee_name' | 'committee_category' | 'project_uid' | 'project_slug'>;

/**
 * One stored seat row: a seat minus its {@link SeatCommittee} fields and the org-wide
 * `organization_id`, plus `c` — the seat's index into {@link CompactOrgSeatsEntry.c}.
 */
export type CompactSeatRow = Omit<CommitteeServiceOrgSeat, keyof SeatCommittee | 'organization_id'> & { c: number };

/**
 * Stored form of the per-caller org seats cache (GH-1906, namespace `org-seats:v2`).
 *
 * The drain that produces it returns one flat row per seat, and on a large org those rows repeat
 * their committee's identity and the org's own id tens of thousands of times — enough that the
 * serialized value was refused for exceeding `VALKEY_CACHE.MAX_VALUE_BYTES` and the roster was
 * never cached at all. This shape stores each committee once, the organization once, and the
 * per-seat field names once; `CommitteeServiceOrgSeat` objects are rebuilt intact on read.
 */
export interface CompactOrgSeatsEntry {
  /**
   * `organization_id`, hoisted out of the rows. The drain is scoped to a single organization
   * upstream (`GET /committees/b2b-org/{uid}/seats`), so every seat in one entry carries the same
   * value by construction.
   */
  o: string;
  /**
   * Distinct {@link SeatCommittee} field combinations, referenced by index from each seat row.
   *
   * Keyed on ALL five fields, not on `committee_uid` alone: committee-service copies these onto
   * each member record when it is written rather than joining them from the committee, so members
   * of one committee can disagree (a pre-backfill member with an empty `project_uid`, or a member a
   * failed re-sync left behind). A uid-only key would stamp one member's values onto the whole
   * committee — moving seats between the Board and Committee tabs, or dropping their foundation.
   */
  c: ColumnarTable;
  /** Per-seat fields, columnar. One column, `c`, holds the seat's index into the committee table. */
  s: ColumnarTable;
}

/**
 * Stored form of the per-caller merged people directory cache (GH-1906, namespace
 * `org-people-dir:v3`). `stats` and `foundations` are small fixed-size structures and are kept
 * verbatim; only `rows` — where the same ~19 field names repeat on every person — is compacted.
 */
export interface CompactOrgPeopleDirectoryEntry {
  accountId: string;
  /** `OrgAllEmployeeRow`s, columnar. */
  r: ColumnarTable;
  stats: OrgAllEmployeeStats;
  foundations: OrgAllEmployeeFoundationOption[];
}
