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
import type { MKTG_REDRAFT_COMMENTS_BUSY } from '../constants/mktg-document-redraft.constants';

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
  | { type: 'failed'; message: string }
  | ({ type: 'elsewhere' } & MktgRedraftElsewhere);

/** Safe facts of a send's 409 when another send holds its comments; never a subject, session or comment text. */
export interface MktgRedraftBusyConflict {
  code: typeof MKTG_REDRAFT_COMMENTS_BUSY;
  /** Directory display name; null for the viewer's own send or when the directory has none. */
  sentBy: string | null;
  /** Whether the send that holds the comments is the effective viewer's. */
  sentByViewer: boolean;
  /** When that send was reserved (ISO). */
  sentAt: string;
  /** The redraft's opaque run id once bound; null while that send is still starting. */
  runId: string | null;
}

/** The server refused this send because another run holds the document: what to say and which run to open. */
export interface MktgRedraftElsewhere {
  message: string;
  /** Null when the winning send has no recorded run yet. */
  runId: string | null;
}
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
