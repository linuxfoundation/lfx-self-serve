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
