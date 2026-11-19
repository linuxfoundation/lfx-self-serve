// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MEMBER_IMPORT_COLUMNS } from '../constants/member-import.constants';
import type { Committee, CommitteeInvite } from './committee.interface';
import type { TagSeverity } from './components.interface';
import type { CommitteeMember, CreateCommitteeMemberRequest } from './member.interface';

/**
 * A canonical lowercase snake_case header of the member import CSV. A file header matches it when
 * they are equal ignoring case, whitespace, hyphens and underscores (`First Name` → `first_name`).
 */
export type MemberImportColumn = (typeof MEMBER_IMPORT_COLUMNS)[number];

/** Trimmed cell values of one CSV record, keyed by header. Absent headers are absent keys. */
export type MemberImportCells = Partial<Record<MemberImportColumn, string>>;

/**
 * Lifecycle of one imported row: `ready`/`invalid`/`skipped` while previewing, then
 * `not_submitted` until its chunk is sent, `importing` while that bulk request is in flight,
 * `waiting` while a retryable outcome pauses before resubmission, and `added`/`skipped`/`failed`
 * once it settles. `unknown` preserves an earlier attempt that may have committed without a
 * confirmed result. Rows left unsent when a run stops stay `not_submitted`.
 */
export type MemberImportRowStatus = 'ready' | 'invalid' | 'skipped' | 'importing' | 'added' | 'failed' | 'waiting' | 'not_submitted' | 'unknown';

/** Status filter of the import dialog's table: one row status, or `all` rows. */
export type MemberImportStatusFilter = MemberImportRowStatus | 'all';

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
 * (malformed quoting, repeated or missing headers, too many rows…) and no record should be previewed.
 */
export interface MemberImportParseResult {
  headers: MemberImportColumn[];
  records: MemberImportRecord[];
  /**
   * File columns the import does not use, by their original header text; a column without a header
   * is listed as `Column N (no header)` only when a row has a value in it. Empty when `errors` is not.
   */
  ignoredColumns: string[];
  errors: string[];
}

/** Text of an uploaded import file and the encoding it was read with. */
export interface MemberImportDecodedFile {
  text: string;
  /** `windows-1252` when the bytes were not valid UTF-8 (Excel's default "CSV (Comma delimited)"). */
  encoding: 'utf-8' | 'windows-1252';
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
  /** True when the create call reported the person was already a member upstream. */
  conflict?: boolean;
  /** False when resubmitting cannot succeed (upstream `invalid` row or a rejected chunk); the file must be fixed. */
  retryable?: boolean;
  /** True when a prior attempt may have committed; membership existence alone does not establish creation by this import. */
  uncertain?: boolean;
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

/** Data the Members tab or the create or edit wizard passes into the import dialog. */
export interface MemberImportDialogData {
  committee: Committee;
  existingMembers: CommitteeMember[];
  existingInvites: CommitteeInvite[];
  /** Collect validated member requests for the create or edit wizard; close returns StagedCommitteeMemberRequest[] with notification/cleanup metadata, without writing. */
  collectOnly?: boolean;
  /**
   * Reattach to the group's retained run (#5731) without a file, snapshots or a write. The dialog closes
   * instead of offering a new preview once that run is no longer retained.
   */
  attach?: boolean;
}

/** Whether a confirmed import run is still writing (`importing`) or has finished its latest attempt (`settled`). */
export type MemberImportRunStatus = 'importing' | 'settled';

/** A confirmed Members-tab import, captured from the preview when the user starts it (#5730). */
export interface MemberImportRunInput {
  /** Pinned at confirmation — every write targets this group even if the page navigates elsewhere. */
  committeeUid: string;
  committeeName: string;
  rules: MemberImportGroupRules;
  /** Original file name, kept only in memory. */
  fileName: string | null;
  /** Every previewed row; only `ready` rows are submitted. */
  rows: MemberImportRow[];
  skipNotification: boolean;
  /** Pending invitation UID by normalized email, revoked after a direct add so the roster does not show member + invite. */
  pendingInviteUidByEmail: Record<string, string>;
  /** Roster size from the complete pre-import snapshot. */
  baselineMemberCount: number;
}

/** Identity of one run: its group, its unique ID, and the user subject that started it. */
export interface MemberImportRunRef {
  committeeUid: string;
  runId: string;
  ownerSubject: string;
}

/** Immutable in-memory snapshot of a confirmed import run, owned by the committee member import service. */
export interface MemberImportRun extends MemberImportRunRef, MemberImportRunInput {
  status: MemberImportRunStatus;
  /** Submissions made so far: 1 for the initial import, plus one per Retry. */
  attempt: number;
  /** Rows submitted by the current attempt and how many of them have settled. */
  batchTotal: number;
  batchSettled: number;
  /** Automatic pauses taken by the current attempt (at most MEMBER_IMPORT_MAX_PAUSES). */
  pauseCount: number;
  /** Epoch ms when a paused attempt resumes automatically; null while not paused. */
  resumeAt: number | null;
  /** Length of the current pause, rounded up to whole seconds. */
  resumeInSeconds: number;
  /** Minimum server deadline for Retry, retained even if automatic recovery or a pause is stopped; 0 when none. */
  retryNotBefore: number;
  /** Set when auth/not-found, the pause cap, an excessive server cooldown or Stop import ends the attempt. */
  stopReason: string | null;
  /** Distinguishes the manager's Stop action from fatal errors and automatic recovery limits. */
  manualStopRequested: boolean;
  /**
   * `baselineMemberCount` plus every confirmed addition across attempts. Retries keep the original
   * baseline; this never rebases onto a roster that already includes the import's own additions.
   */
  reconciliationTarget: number;
}

/** What a retained run is doing now: writing, waiting out an automatic pause, finishing a requested stop, or finished. */
export type MemberImportRunPhase = 'importing' | 'paused' | 'stopping' | 'settled';

/** Counts-only projection of a retained run for status surfaces; it carries no member data (#5731). */
export interface MemberImportRunSummary {
  committeeUid: string;
  committeeName: string;
  runId: string;
  attempt: number;
  phase: MemberImportRunPhase;
  /** Rows submitted by the current attempt and how many of them have settled. */
  batchTotal: number;
  batchSettled: number;
  added: number;
  failed: number;
  unknown: number;
  notSubmitted: number;
  /** Rows that Retry would resubmit. */
  retryable: number;
  stopReason: string | null;
  manualStopRequested: boolean;
  baselineMemberCount: number;
  reconciliationTarget: number;
}

/** One settled attempt of a run. `key` (run ID plus attempt) identifies it exactly once. */
export interface MemberImportSettlement {
  key: string;
  summary: MemberImportRunSummary;
}

/** A fresh manager-access check for a group with a retained run; only `authorized` reveals its summary. */
export type MemberImportAccessState = 'pending' | 'authorized' | 'denied' | 'error';

/** Result of a fresh manager-access check, with group details only when authorized. */
export interface MemberImportAccessCheck {
  state: MemberImportAccessState;
  committee?: Committee;
}

/** The compact Groups-list entry beneath a group's member count, shown only after a fresh access check authorizes it. */
export interface MemberImportTableStatus {
  committeeUid: string;
  phase: MemberImportRunPhase;
  label: string;
  ariaLabel: string;
}
