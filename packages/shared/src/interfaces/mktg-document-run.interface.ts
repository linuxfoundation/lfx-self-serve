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
  startedAt: string;
  /** Prior draft hint; result services validate current-turn finalization before completion. */
  priorVersion: number;
  state: MktgStoredDocumentRunState;
  /** Bounded agent reply or server-authored reason (deadline / storage exhausted); detail may refresh the full reply. */
  failureText?: string;
  /** Exact persisted result after recording this session through the existing generation path. */
  result: MktgDocumentLocation | null;
}

/** BFF-only generation attribution; caller authorization stays on the visiting Request. */
export interface MktgGenerationAttribution {
  /** Explicit null is unknown, never a fallback to the visitor's subject. */
  creatorSubject: string | null;
}
