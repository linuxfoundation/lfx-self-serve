// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_STATUSES,
  MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES,
  MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS,
} from '../constants/mktg-document-comments.constants';
import type { MktgRevisionAuthor } from './mktg-document-store.interface';

export type MktgCommentAgentKey = keyof typeof MKTG_DOCUMENT_COMMENT_LIMITS;
export type MktgDocumentCommentStatus = (typeof MKTG_DOCUMENT_COMMENT_STATUSES)[number];
export type MktgDocumentCommentSubmissionState = (typeof MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES)[number];
export type MktgDocumentCommentAnchorKind = (typeof MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS)[number];

/** key always addresses the source JSON; only the kit agent takes a prose passage. */
export interface MktgDocumentCommentAnchor {
  kind: MktgDocumentCommentAnchorKind;
  key: string;
  /** Server-derived verbatim passage of the selected revision, never a browser assertion. */
  passage?: string;
}

/** Private mutable thread. No display identity or session capability is persisted. */
export interface MktgStoredDocumentComment {
  id: string;
  clientRequestId: string;
  anchor: MktgDocumentCommentAnchor;
  /** Original anchor context, retained even when the result is a later revision. */
  revisionId: string;
  authorId: string | null;
  text: string;
  createdAt: string;
  status: MktgDocumentCommentStatus;
  sentInRun: string | null;
  resultRevisionId: string | null;
  resolution: string | null;
}

/** Private reserved send snapshot. An uncertain external POST is NEVER retried automatically. */
export interface MktgDocumentCommentSubmission {
  id: string;
  baseRevisionId: string;
  commentIds: string[];
  state: MktgDocumentCommentSubmissionState;
  runId: string | null;
  resultRevisionId: string | null;
}

export interface MktgDocumentCommentsRecord {
  schema: string;
  project: string;
  agentKey: MktgCommentAgentKey;
  documentId: string;
  threads: MktgStoredDocumentComment[];
  submissions: MktgDocumentCommentSubmission[];
}

/** Private conditional-write snapshot; no version token is exposed through HTTP. */
export interface MktgDocumentCommentsSnapshot {
  record: MktgDocumentCommentsRecord;
  etag?: string;
}

/** Public explicit projection: directory-resolved name, no stored subject or private ledger. */
export interface MktgDocumentComment extends Omit<MktgStoredDocumentComment, 'authorId' | 'clientRequestId'> {
  author: MktgRevisionAuthor | null;
}

export interface MktgDocumentCommentsResponse {
  revisionId: string;
  threads: MktgDocumentComment[];
}

export interface MktgAddDocumentCommentRequest {
  project: string;
  revisionId: string;
  anchor: Pick<MktgDocumentCommentAnchor, 'kind' | 'key'>;
  text: string;
  clientRequestId: string;
}

/** Send identifies stored comments, never previous JSON, author, version or routing handle. */
export interface MktgReviseDocumentRequest {
  project: string;
  revisionId: string;
  commentIds: string[];
  clientRequestId: string;
}

/** One browser view's revision selection; identity comes from UserService, never a request body. */
export interface MktgDocumentCommentScope {
  projectUid: string;
  agentKey: MktgCommentAgentKey;
  documentId: string;
  revisionId: string;
}

/** Distinguishes a valid nullable field from a missing/unsafe path. */
export interface MktgDocumentCommentField {
  value: unknown;
}
