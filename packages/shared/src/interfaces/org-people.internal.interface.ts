// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal All Employees roster shapes for the Org Lens People backend services.
// They live in the shared package because CLAUDE.md prohibits module-level interfaces
// inside apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.
// The merge-only fields below never leave the server: `toWireRow` strips them before the
// response is cached or sent, and the cache validator rejects any entry carrying them.

import type { OrgAllEmployeeFoundationOption, OrgAllEmployeeRow, OrgAllEmployeeStats } from './org-people.interface';

/** In-memory merge row — the wire shape plus the fields the identity merge accumulates. Never cached, never sent. */
export interface OrgAllEmployeeRowInternal extends OrgAllEmployeeRow {
  /** Every lowercased address that contributed to this row. Length > 1 is the normal result of a merge. */
  emails: string[];
  /** Diagnostic: the merge keys that collapsed into this row (e.g. `identity:mcderk`). Lets a reviewer explain a merge without re-deriving it. */
  mergedFrom?: string[];
}

/** In-memory merge payload — the stored seed and the pre-strip merge result. Never cached, never sent. */
export interface OrgAllEmployeesInternalResponse {
  accountId: string;
  rows: OrgAllEmployeeRowInternal[];
  stats: OrgAllEmployeeStats;
  foundations: OrgAllEmployeeFoundationOption[];
}
