// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentAgentKey, MktgDocumentLocation } from './mktg-document-store.interface';
import type { MktgRunActivity } from './mktg-run.interface';
import type { Member360FailureReason } from './member-360.interface';
import type { MKTG_RUN_ACTIVE, MKTG_RUN_ANSWERED } from '../constants/mktg-run.constants';

/** Safe conflict facts; never a Guild session id or owner capability. */
export interface MktgActiveRunConflict {
  code: typeof MKTG_RUN_ACTIVE;
  message: string;
  startedBy: string;
  activeRunId: string;
  state: MktgDocumentRunState;
  agentKey: MktgDocumentAgentKey;
  documentId: string;
}

/** Deliberately narrow server acknowledgement; no subject, session or answer text. */
export interface MktgRunAnsweredConflict {
  code: typeof MKTG_RUN_ANSWERED;
  answeredBy: string;
  answeredAt: string;
}

/** Extend this union and its dedicated allow-list guard when a new one-off adds classified failures. */
export type MktgRunFailureReason = Member360FailureReason;

/** Private completion context, captured by the validated one-off generate path, never a public projection. */
export interface MktgOneOffRunContext {
  answers?: Record<string, string>;
  sourceWords?: number;
  /** An impersonated start must never initialize a profile on a later non-impersonated read. */
  initializeProfile?: boolean;
}

/** Distinct server start contexts; a revision id must never be interpreted as one-off completion data. */
export interface MktgDocumentRunStartOptions {
  oneOff?: MktgOneOffRunContext;
  basedOnId?: string;
}

/** Untrusted discard input is validated before any tracking mutation. */
export interface MktgActiveRunStartOptions {
  documentId?: string;
  discard?: unknown;
  /** Slot owner for one-offs when the caller acts on another creator's record; defaults to the caller. */
  creatorSubject?: string | null;
}

/** Server-only facts shared by one-off result readers; a model turn alone is not session completion. */
export interface MktgOneOffTerminalFacts {
  rootDone: boolean;
  sessionEnded: boolean;
  failed: boolean;
  /** Legacy Member 360 terminal reply: only root runtime_done.content { type: 'text', text }. */
  doneText: string;
  /** Root completion/reply after the newest queued-turn marker; suppressed for capped event pages. */
  currentRootDone: boolean;
  currentDoneText: string;
  /** First payload after the latest queued-turn marker, for current questions/output checks. */
  currentTurnOffset: number;
  /** Current status on the newest root agent event; one-off public-list evidence, ignored by Member 360. */
  rootTaskEnded: boolean;
  /** Last root agent_notification_message with content.type text (.data or .text), never streams or progress. */
  lastRootMessageText: string;
}

/** Terminal runtime evidence, without treating arbitrary agent text as a document. */
export interface MktgSessionOutcome {
  ended: boolean;
  replyText: string;
}

/** Observable phases of a server-recorded run; a completed run is represented by its stored revision. */
export type MktgDocumentRunState = 'writing' | 'questions' | 'storing' | 'failed';

/** Server-only terminal markers; closed runs are not reconciled or listed. */
export type MktgStoredDocumentRunState = MktgDocumentRunState | 'completed' | 'superseded' | 'discarded';

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
  /** Creator-only, server-filtered steps; Member contact/email redaction also applies. Never raw events or reasoning. */
  activity?: MktgRunActivity[];
  /** Agent's final reply or server-authored reason (deadline / storage exhausted); plain text only. */
  failureText?: string;
  /** Server-classified failure code, independent of private agent text. */
  failureReason?: MktgRunFailureReason;
  /** Only exhausted revision persistence can be retried on the existing Guild session. */
  persistenceFailed?: boolean;
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
  /** Private initiating subject; absent legacy records are unknown, never the reconciling visitor. */
  creatorSubject?: string | null;
  /** Private one-off metadata needed to complete without the initiating browser. */
  oneOff?: MktgOneOffRunContext;
  startedAt: string;
  /** Generate-path prior-draft hint (chat records 0); completion uses current-turn finalization and receipts. */
  priorVersion: number;
  /** Delivered turn identity; a duplicate ACK cannot reopen that attempt. */
  attemptId?: string;
  /** Private bounded ACK ledger; overflow rejects a new turn rather than forgetting accepted ones. */
  acceptedAttemptIds?: string[];
  state: MktgStoredDocumentRunState;
  /** Retry/answers-continuation budget origin; does not change the original Started label. */
  retryAt?: string;
  /** Latest questions block answered on this session; a different block is a new human pause. */
  answeredQuestionsId?: string;
  /** Server-only claim attribution; never spread into public progress. */
  answeredBySubject?: string;
  answeredAt?: string;
  /** Changes the object body on metadata CAS writes so S3 ETags cannot stay equal. */
  storageWriteId?: string;
  /** Bounded agent reply or server-authored reason (deadline / storage exhausted); detail may refresh the full reply. */
  failureText?: string;
  failureReason?: MktgRunFailureReason;
  /** Separate bounded retries once a valid asset is ready but its revision write has not landed. */
  persistRetries?: number;
  /** Prior attempt's revision cannot complete a renewed same-session turn. */
  priorRevisionId?: string;
  /** Exact persisted result after recording this session through the existing generation path. */
  result: MktgDocumentLocation | null;
}

/** BFF-only generation attribution; caller authorization stays on the visiting Request. */
export interface MktgGenerationAttribution {
  /** Explicit null is unknown, never a fallback to the visitor's subject. */
  creatorSubject: string | null;
}

/** Private fetched started-run record and the exact bytes used for metadata-only refreshes. */
export interface MktgStoredStartedRun {
  key: string;
  body: string;
  /** Private metadata and version observed in the same object-store read. */
  metadata: Record<string, string>;
  etag?: string;
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
