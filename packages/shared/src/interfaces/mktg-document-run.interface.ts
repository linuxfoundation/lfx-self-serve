// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentAgentKey, MktgDocumentLocation } from './mktg-document-store.interface';
import type { MktgReadmeOutcome } from './mktg-run.interface';

/** Observable phases of a server-recorded run; a completed run is represented by its stored revision. */
export type MktgDocumentRunState = 'writing' | 'storing' | 'failed';

/** Server-only terminal marker; completed sessions no longer appear as unfinished runs. */
export type MktgStoredDocumentRunState = MktgDocumentRunState | 'completed';

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
  /** Opaque subject hash, not a display name, username or capability. Never sent to the browser. */
  startedBy: string;
  startedAt: string;
  /** Only a strictly newer validated envelope can finish this attempt. */
  priorVersion: number;
  state: MktgStoredDocumentRunState;
  /** Explicit retry budget origin; does not change the original Started label. */
  retryAt?: string;
  /** Submission provenance obtained by the BFF, not an arbitrary client note. */
  readme?: MktgReadmeOutcome;
  /** Exact persisted result after recording this session through the existing generation path. */
  result: MktgDocumentLocation | null;
}

/** Body for an explicit retry of a failed server-recorded run, scoped by its document/run route. */
/** Private fetched started-run record and the exact bytes used for metadata-only refreshes. */
export interface MktgStoredStartedRun {
  key: string;
  body: string;
  record: MktgStartedRunRecord;
}

export interface MktgRetryDocumentRunRequest {
  project: string;
}
