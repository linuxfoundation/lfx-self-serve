// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgRevisionRef } from './mktg-rebuild.interface';
import type { MktgDocumentLocation } from './mktg-document-store.interface';
import type { MktgRunAttempt, MktgRunResultResponse, MktgRunActivity } from './mktg-run.interface';
import type { MktgChatResponse } from './mktg-chat.interface';
import type {
  MktgCommentAgentKey,
  MktgStoredDocumentComment,
  MktgDocumentCommentSubmission,
  MktgDocumentCommentsRecord,
  MktgDocumentCommentScope,
} from './mktg-document-comments.interface';

/** Frozen send input, with no directory identity, session capability or lifecycle state. */
export type MktgRedraftCommentSnapshot = Pick<MktgStoredDocumentComment, 'id' | 'anchor' | 'text' | 'createdAt'>;

/** Server-only immutable descriptor; NEVER spread into an HTTP response. */
export interface MktgDocumentRedraftContext {
  schema: string;
  runId: string;
  project: string;
  agentKey: MktgCommentAgentKey;
  documentId: string;
  requestId: string;
  basedOnId: string;
  priorVersion: number;
  /** Form provenance, not personal attribution. */
  projectName: string;
  comments: MktgRedraftCommentSnapshot[];
}

/** Private result of reserving one immutable send input; fresh is process control, not lifecycle state. */
export interface MktgRedraftReservation {
  submission: MktgDocumentCommentSubmission;
  comments: MktgRedraftCommentSnapshot[];
  fresh: boolean;
}
export interface MktgDocumentCommentsMutation<T> {
  record: MktgDocumentCommentsRecord | null;
  result: T;
}

/** Server-prepared send; never deserialize this shape from a request. */
export interface MktgPreparedRedraft {
  context: Omit<MktgDocumentRedraftContext, 'schema' | 'runId'>;
  message: string;
  framework: MktgRevisionRef | null;
}
export type MktgRedraftStartResponse = Extract<MktgChatResponse, { sessionId: string }> & { runId: string; priorVersion: number };

/** UI-only landing context; not part of the persistence receipt or revise request. */
export interface MktgRedraftLanding extends MktgDocumentLocation {
  tab?: string;
}

/** Existing poller output, without manufacturing intake answers for accepted redrafts. */
export interface MktgObservedRunResult {
  result: MktgRunResultResponse;
  terminal: boolean;
}
export type MktgRedraftProgress =
  | { type: 'submitted'; attempt: MktgRunAttempt }
  | { type: 'activity'; activity: MktgRunActivity[] }
  | { type: 'storing' }
  | { type: 'ready'; location: MktgDocumentLocation }
  | { type: 'failed'; message: string };
export type MktgReleaseRedraftResponse = { success: true } | { state: 'unknown' };
/** Only a creator-owned terminal ledger row permits automatic local recovery cleanup. */
export interface MktgRedraftRecoveryResponse {
  terminal: boolean;
}
/** Private subject-keyed recovery only: the server, not this cache, owns liveness. */
export interface MktgPendingRedraftIntent {
  scope: MktgDocumentCommentScope;
  clientRequestId: string;
  commentIds: string[];
  priorVersion: number;
  updatedAt: string;
  attempt?: MktgRunAttempt;
  /** Last primary response proved uncertainty/expiry; never permits releasing an accepted attempt. */
  releaseAllowed?: boolean;
}

/** Optional object metadata only: do not put these annotations in hashed revision/agent bytes. */
export interface MktgRedraftRevisionMetadata {
  redraftRunId: string;
  commentCount: number;
}

export interface MktgRedraftResultValidation {
  valid: boolean;
  errors: string[];
  resolutions: string[];
}
