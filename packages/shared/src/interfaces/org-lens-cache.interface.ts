// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable } from './compact-cache.interface';
import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeStats } from './org-people.interface';

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
  /** Distinct committees — uid, name, category, and project uid/slug — referenced by index from each seat row. */
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
