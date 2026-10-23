// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MktgCommentAgentKey,
  MktgStoredDocumentComment,
  MktgDocumentCommentSubmission,
  MktgDocumentCommentsRecord,
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
