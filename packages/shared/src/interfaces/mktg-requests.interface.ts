// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MKTG_REQUEST_KINDS, MKTG_REQUEST_STATES, MKTG_REQUESTS_SCHEMA } from '../constants/mktg-requests.constants';
import type { MktgDocumentAgentKey, MktgRevisionAuthor } from './mktg-document-store.interface';

export type MktgRequestKind = (typeof MKTG_REQUEST_KINDS)[number];
export type MktgRequestState = (typeof MKTG_REQUEST_STATES)[number];
export interface MktgRequestTarget {
  familyId: string;
  assetId?: string;
  /** Historical identifiers remain readable after catalog changes. */
  agentKey?: string;
  documentId?: string;
  revisionId?: string;
}
export interface MktgCreateRequestTarget extends MktgRequestTarget {
  agentKey?: MktgDocumentAgentKey;
}
export interface MktgRequestResult {
  agentKey: string;
  documentId: string;
  revisionId: string;
}
export interface MktgCreateRequest {
  project: string;
  kind: MktgRequestKind;
  target: MktgCreateRequestTarget;
  text: string;
  clientRequestId: string;
}
export interface MktgUpdateRequestStateRequest {
  project: string;
  state: MktgRequestState;
  note?: string;
  result?: MktgRequestResult;
  clientRequestId: string;
  withdraw?: never;
}
export interface MktgWithdrawRequestStateRequest {
  project: string;
  clientRequestId: string;
  withdraw: true;
  state?: 'declined';
  note?: never;
  result?: never;
}
export type MktgChangeRequestStateRequest = MktgUpdateRequestStateRequest | MktgWithdrawRequestStateRequest;
/** At most two transitions per request; receipts make retries safe even after a later transition. */
export interface MktgRequestStateChange {
  clientRequestId: string;
  state: MktgRequestState;
  note: string | null;
  result?: MktgRequestResult;
  withdraw: boolean;
  changedBy: string | null;
}
export interface MktgStoredRequest {
  id: string;
  clientRequestId: string;
  kind: MktgRequestKind;
  target: MktgRequestTarget;
  text: string;
  requestedBy: string | null;
  requesterCommittees: string[];
  createdAt: string;
  state: MktgRequestState;
  stateChangedAt: string;
  stateChangedBy: string | null;
  note: string | null;
  result?: MktgRequestResult;
  stateChanges: MktgRequestStateChange[];
}
export interface MktgRequestsRecord {
  schema: typeof MKTG_REQUESTS_SCHEMA;
  project: string;
  requests: MktgStoredRequest[];
}
export interface MktgRequestsSnapshot {
  record: MktgRequestsRecord;
  etag?: string;
}
export interface MktgRequestsMutation<T> {
  record: MktgRequestsRecord | null;
  result: T;
}
export interface MktgRequest extends Omit<MktgStoredRequest, 'clientRequestId' | 'requestedBy' | 'stateChangedBy' | 'stateChanges'> {
  requestedBy: MktgRevisionAuthor | null;
  stateChangedBy: MktgRevisionAuthor | null;
  /** A display hint only; withdrawal ownership is rechecked at the write boundary. */
  isRequester: boolean;
  withdrawn: boolean;
}
export interface MktgRequestsResponse {
  requests: MktgRequest[];
  openCount: number;
}
