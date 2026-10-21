// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentAgentKey, MktgDocumentLocation } from './mktg-document-store.interface';

/** Terminal runtime evidence, without treating arbitrary agent text as a document. */
export interface MktgSessionOutcome {
  ended: boolean;
  replyText: string;
}

/** Observable phases of a server-recorded run; a completed run is represented by its stored revision. */
export type MktgDocumentRunState = 'writing' | 'questions' | 'storing' | 'failed';

/** Server-only terminal markers for completion and superseded unfinished or failed runs. */
export type MktgStoredDocumentRunState = MktgDocumentRunState | 'completed' | 'superseded';

/**
 * Writer-entitled progress returned with Documents list/detail reads.
 * Deliberately excludes the Guild session, starter identity and session capabilities.
 */
export interface MktgDocumentRunProgress {
  /** Opaque server-generated run id, not a Guild session id or credential. */
  runId: string;
  /** Server-resolved project uid, never an intake-derived project name. */
  project: string;
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  /** Original server-recorded start, preserved across devices and retries. */
  startedAt: string;
  state: MktgDocumentRunState;
  /** Agent's final reply or server-authored reason (deadline / storage exhausted); plain text only. */
  failureText?: string;
}

/** Public rows only; read unavailability is not evidence of active work or current selection. */
export interface MktgDocumentRunSnapshot {
  runs: MktgDocumentRunProgress[];
  progressUnavailable?: boolean;
}

/** Catalog-labelled row in the Documents overview. */
export interface MktgDocumentRunRow extends MktgDocumentRunProgress {
  label: string;
}

/**
 * Mutable server-only started-run record in the private document store.
 * It must never be returned by spreading it into a public response: project
 * writers receive only an explicit MktgDocumentRunProgress projection.
 */
export interface MktgStartedRunRecord {
  schema: string;
  runId: string;
  project: string;
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  sessionId: string;
  startedAt: string;
  /** Generate-path prior-draft hint (chat records 0); completion uses current-turn finalization and receipts. */
  priorVersion: number;
  /** Delivered turn identity; a duplicate ACK cannot reopen that attempt. */
  attemptId?: string;
  state: MktgStoredDocumentRunState;
  /** Retry/answers-continuation budget origin; does not change the original Started label. */
  retryAt?: string;
  /** Latest questions block answered on this session; a different block is a new human pause. */
  answeredQuestionsId?: string;
  /** Bounded agent reply or server-authored reason (deadline / storage exhausted); detail may refresh the full reply. */
  failureText?: string;
  /** Separate bounded retries once a valid asset is ready but its revision write has not landed. */
  persistRetries?: number;
  /** Prior attempt's revision cannot complete a renewed same-session turn. */
  priorRevisionId?: string;
  /** Exact persisted result after recording this session through the existing generation path. */
  result: MktgDocumentLocation | null;
}

/** Private fetched started-run record and the exact bytes used for metadata-only refreshes. */
export interface MktgStoredStartedRun {
  key: string;
  body: string;
  record: MktgStartedRunRecord;
}

/** BFF-only partial coverage; The Documents transport retains known rows, never echoes these IDs to the client. */
export interface MktgDocumentRunCoverage {
  /** Unchecked entries, including unknown outside-window history that may already be closed. */
  uncheckedCount: number;
  /** Opaque IDs known unfinished/failed from HEAD or a matching terminal cache; bounded by discovery + cache limits. */
  retainedRunIds: string[];
  /** A lookup failed, distinct from intentionally bounded history coverage. */
  lookupFailed?: boolean;
}

/** The Documents transport's retry body, scoped by its document/run route; no generation is started. */
export interface MktgRetryDocumentRunRequest {
  project: string;
}
