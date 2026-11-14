// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentAgentKey } from './mktg-document-store.interface';
import type { MktgRunActivity, MktgRunAnswer, MktgRunQuestion, MktgRunPersistReceipt } from './mktg-run.interface';

/** Exact stored asset identity; revision numbers are display labels, not ordering evidence. */
export interface MktgRevisionRef {
  agentKey: MktgDocumentAgentKey;
  revisionId: string;
  revisionNumber: number;
  contentSha256: string;
}

/** Server-computed mismatch for the dependent's CURRENT revision. Unknown provenance has no mismatch. */
export interface MktgRebuildStaleness {
  builtFrom: MktgRevisionRef;
  rebuildFrom: MktgRevisionRef;
}

export type MktgRebuildStepStatus = 'queued' | 'running' | 'questions' | 'draft' | 'failed';
export type MktgRebuildStatus = 'running' | 'questions' | 'complete' | 'failed';

export interface MktgRebuildStep {
  agentId: string;
  agentKey: MktgDocumentAgentKey;
  status: MktgRebuildStepStatus;
  activity: MktgRunActivity[];
  questions?: MktgRunQuestion[];
  questionsId?: string;
  persistence?: MktgRunPersistReceipt;
  message?: string;
}

/** Family progress row; names come from the catalog/intake, links from canonical receipts. */
export interface MktgRebuildStepView extends MktgRebuildStep {
  index: number;
  label: string;
  statusLabel: string;
  revisionId: string | null;
}

/** One-shot Downstream button intent carried in router navigation state, never in the URL. */
export interface MktgRebuildNavigationIntent {
  project: string;
  frameworkRevisionId: string;
}

/** POST /rebuild/start; server derives stale membership, order, handles and intake. */
export interface MktgRebuildStartRequest {
  project: string;
  /** Reject a click based on a superseded approval rather than silently changing input. */
  frameworkRevisionId: string;
}

/** POST /rebuild/result (read) and /rebuild/advance (write). Tokens never ride URLs. */
export interface MktgRebuildRequest {
  project: string;
  chainId: string;
  ownerToken: string;
}

/** Advance only the step and questions turn the caller saw; retries cannot answer a later turn. */
export interface MktgRebuildAdvanceRequest extends MktgRebuildRequest {
  stepIndex: number;
  questionsId?: string;
  answers?: MktgRunAnswer[];
}

/** Expiring project-wide CAS lease. Contains no requester identity or capability. */
export interface MktgRebuildActiveMarker {
  chainId: string;
  startedAt: string;
  expiresAt: number;
}

export interface MktgRebuildResponse {
  /** Start attached to an existing chain; ownerToken is minted for this caller. */
  attached?: boolean;
  project: string;
  chainId: string;
  ownerToken: string;
  framework: MktgRevisionRef;
  status: MktgRebuildStatus;
  steps: MktgRebuildStep[];
}

/** Private durable chain state. Never serialize this record directly as an API response. */
export interface MktgRebuildRecord {
  project: string;
  chainId: string;
  createdAt: string;
  /** CAS claim held across a Guild side effect. An interrupted claim is never silently replayed. */
  operationId?: string;
  framework: MktgRevisionRef;
  status: MktgRebuildStatus;
  steps: MktgRebuildStoredStep[];
}

export interface MktgRebuildStoredStep extends MktgRebuildStep {
  sessionId?: string;
  /** The last answered block remains visible in Guild until its next turn. */
  answeredQuestionsId?: string;
}

/** Immutable per-session capture; the result writer copies only framework to the revision sidecar. */
export interface MktgGenerationProvenance {
  project: string;
  agentKey: MktgDocumentAgentKey;
  framework: MktgRevisionRef | null;
}
