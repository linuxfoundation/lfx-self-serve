// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES } from './mktg-document-comments.constants';

/** Private contract descriptors, not an active-run/lifecycle index. No LIST consumer. */
export const MKTG_REDRAFT_CONTEXT_PREFIX = 'document-redrafts';
export const MKTG_REDRAFT_CONTEXT_SCHEMA = 'mktg-redraft-context/v1';
export const MKTG_REDRAFT_CONTEXT_MAX_BYTES = MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES;
export const MKTG_REDRAFT_CONTEXT_KEYS = [
  'schema',
  'runId',
  'project',
  'agentKey',
  'documentId',
  'requestId',
  'basedOnId',
  'priorVersion',
  'projectName',
  'comments',
] as const;
export const MKTG_REDRAFT_REQUEST_KEYS = ['project', 'revisionId', 'commentIds', 'clientRequestId'] as const;
export const MKTG_REDRAFT_SUBMISSION_KEYS = ['id', 'requestedBy', 'createdAt', 'baseRevisionId', 'commentIds', 'state', 'runId', 'resultRevisionId'] as const;
export const MKTG_REDRAFT_SNAPSHOT_KEYS = ['id', 'anchor', 'text', 'createdAt'] as const;
export const MKTG_REDRAFT_ANCHOR_KEYS = ['kind', 'key', 'passage'] as const;
/** Another send already holds some of these comments; a send's 409 names its sender and time. */
export const MKTG_REDRAFT_COMMENTS_BUSY = 'MKTG_REDRAFT_COMMENTS_BUSY';
/** The second clause of every sent-elsewhere line, with its dash and full stop. */
export const MKTG_REDRAFT_SENT_CLAUSE = ' already sent these — the agent is redrafting.';
/** Shown when the directory has no display name for the sender. */
export const MKTG_REDRAFT_SENDER_FALLBACK = 'Someone on your team';
