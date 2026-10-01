// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable } from './compact-cache.interface';
import type { CommitteeServiceOrgSeat } from './org-memberships.interface';
import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeStats } from './org-people.interface';

/**
 * The seat-level fields that repeat across the seats of one committee, stored once per distinct
 * combination in {@link CompactOrgSeatsEntry.c} (GH-1906). `organization_id` rides here too rather
 * than being hoisted to one envelope value: every seat of an org-scoped drain normally shares it, so
 * it costs nothing extra, but if any seat ever disagrees it simply gets its own dictionary entry
 * instead of being overwritten with another seat's value.
 */
export type SeatCommittee = Pick<
  CommitteeServiceOrgSeat,
  'committee_uid' | 'committee_name' | 'committee_category' | 'project_uid' | 'project_slug' | 'organization_id'
>;

/** One stored seat row: a seat minus its {@link SeatCommittee} fields, plus `c` — the seat's index into {@link CompactOrgSeatsEntry.c}. */
export type CompactSeatRow = Omit<CommitteeServiceOrgSeat, keyof SeatCommittee> & { c: number };

/**
 * Stored form of the per-caller org seats cache (GH-1906, namespace `org-seats:v2`).
 *
 * The drain that produces it returns one flat row per seat, and on a large org those rows repeat
 * their committee's identity and the org's own id tens of thousands of times — enough that the
 * serialized value was refused for exceeding `VALKEY_CACHE.MAX_VALUE_BYTES` and the roster was
 * never cached at all. This shape stores each distinct committee context once and the per-seat field
 * names once; `CommitteeServiceOrgSeat` objects are rebuilt intact on read.
 */
export interface CompactOrgSeatsEntry {
  /**
   * Distinct {@link SeatCommittee} field combinations, referenced by index from each seat row.
   *
   * Keyed on EVERY field it stores, not on `committee_uid` alone: committee-service copies these
   * onto each member record when it is written rather than joining them from the committee, so
   * members of one committee can disagree (a pre-backfill member with an empty `project_uid`, or a
   * member a failed re-sync left behind). A uid-only key would stamp one member's values onto the
   * whole committee — moving seats between the Board and Committee tabs, or dropping their foundation.
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
