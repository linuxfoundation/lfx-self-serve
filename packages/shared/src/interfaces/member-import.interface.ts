// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MEMBER_IMPORT_COLUMNS } from '../constants/member-import.constants';
import type { Committee, CommitteeInvite } from './committee.interface';
import type { TagSeverity } from './components.interface';
import type { CommitteeMember, CreateCommitteeMemberRequest } from './member.interface';

/** A known, exact lowercase snake_case header of the member import CSV. */
export type MemberImportColumn = (typeof MEMBER_IMPORT_COLUMNS)[number];

/** Trimmed cell values of one CSV record, keyed by header. Absent headers are absent keys. */
export type MemberImportCells = Partial<Record<MemberImportColumn, string>>;

/**
 * Lifecycle of one imported row: `ready`/`invalid`/`skipped` while previewing, then
 * `importing` while its POST is in flight and `added`/`skipped`/`failed` once it settles.
 */
export type MemberImportRowStatus = 'ready' | 'invalid' | 'skipped' | 'importing' | 'added' | 'failed';

/** Which conditional member requirements apply to the selected group. */
export interface MemberImportGroupRules {
  /** Voting or business email required — each member needs an organization name + https website. */
  requiresOrganization: boolean;
  /** Voting enabled — each member needs a role and a voting status. */
  votingEnabled: boolean;
}

/** Guidance for one template column, as it applies to the selected group. */
export interface MemberImportFieldGuide {
  column: MemberImportColumn;
  required: boolean;
  description: string;
}

/** Static metadata for one CSV column; `requiredWhen` names the group rule that makes it required. */
export interface MemberImportFieldDefinition {
  column: MemberImportColumn;
  requiredWhen: 'always' | 'organization' | 'voting' | 'never';
  /** True when the column only applies to voting groups (left out of non-voting templates). */
  votingOnly: boolean;
  description: string;
}

/** A row-specific validation problem; `column` is null when it concerns the whole record. */
export interface MemberImportValidationIssue {
  column: MemberImportColumn | null;
  message: string;
}

/** One data record from the CSV, with its logical source row number (the first CSV record is row 1). */
export interface MemberImportRecord {
  rowNumber: number;
  cells: MemberImportCells;
}

/**
 * Result of reading a whole CSV. A non-empty `errors` means the file as a whole is unusable
 * (malformed quoting, unknown headers, too many rows…) and no record should be previewed.
 */
export interface MemberImportParseResult {
  headers: MemberImportColumn[];
  records: MemberImportRecord[];
  errors: string[];
}

/** One previewed/imported row of the member import dialog. */
export interface MemberImportRow {
  rowNumber: number;
  /** Trimmed email as written in the CSV. */
  email: string;
  /** Trimmed + lowercased email, used for duplicate detection. */
  normalizedEmail: string;
  cells: MemberImportCells;
  status: MemberImportRowStatus;
  issues: MemberImportValidationIssue[];
  /** Native create-member body; null for invalid rows. */
  payload: CreateCommitteeMemberRequest | null;
  /** User-facing reason shown for skipped or failed rows. */
  reason?: string;
  /** Set when the member was added but their stale pending invitation could not be revoked. */
  cleanupWarning?: string;
  /** True when the create call returned 409 — the person was already a member upstream. */
  conflict?: boolean;
}

/** Steps of the import dialog: choose a file, review it, write rows, then show the outcome. */
export type MemberImportDialogPhase = 'select' | 'preview' | 'importing' | 'results';

/** Display-ready projection of a {@link MemberImportRow} for the preview/results table. */
export interface MemberImportRowView {
  row: MemberImportRow;
  name: string;
  organization: string;
  /** Role and voting status, e.g. "Chair · Voting Rep". */
  governance: string;
  statusLabel: string;
  statusSeverity: TagSeverity;
  /** Every non-empty supplied cell, for the row detail area. */
  details: { column: MemberImportColumn; value: string }[];
}

/** Data the Members tab or edit wizard passes into the import dialog. */
export interface MemberImportDialogData {
  committee: Committee;
  existingMembers: CommitteeMember[];
  existingInvites: CommitteeInvite[];
  /** Collect validated member requests for the edit wizard; close returns StagedCommitteeMemberRequest[] with notification/cleanup metadata, without writing. */
  collectOnly?: boolean;
}

/** Cumulative outcome returned when the import dialog closes (zero counts when nothing was written). */
export interface MemberImportDialogResult {
  added: number;
  conflicts: number;
}
