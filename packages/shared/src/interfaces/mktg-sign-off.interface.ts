// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgDocumentType, MktgRevisionAuthor, MktgRevisionResponse } from './mktg-document-store.interface';

export type MktgSignOffRole = 'ed' | 'tocChair';
export type MktgSignOffDecision = 'approved' | 'changes-requested';
export interface MktgSignOffRoles {
  /** Opaque directory subjects only, never names, usernames or email addresses. */
  ed: string | null;
  tocChair: string | null;
}
export interface MktgSignOffAttribution {
  at: string;
  by: string | null;
}
export interface MktgSignOffRoleDecision extends MktgSignOffAttribution {
  decision: MktgSignOffDecision;
}
export interface MktgSignOffChangeRequest {
  /** Prepared by comment-and-revise before recording the terminal decision. */
  commentId: string | null;
  submissionId: string | null;
  /** Frozen input; a note-only receipt is allowed exclusively without CR roots. */
  note?: string;
}
export interface MktgSignOffChangeIntent {
  /** Server UUID prevents an old worker adopting a released/re-created nonce (ABA). */
  id: string;
  role: MktgSignOffRole;
  nonce: string;
  startedAt: string;
  phase: 'prepared' | 'starting';
  /** Frozen request input for same-actor recovery, never projected while pending. */
  note: string;
}
/** Canonical server-resolved operation scope, not a client DTO. */
export interface MktgSignOffChangeScope {
  project: string;
  type: MktgDocumentType;
  documentId: string;
  revisionId: string;
  role: MktgSignOffRole;
  nonce: string;
}
export interface MktgSignOffRequestIds {
  commentRequestId: string;
  requestId: string;
}
/** Server-only commands, NEVER deserialize them or the permission callback from an HTTP body. */
export type MktgSignOffChangeCommand = { role: MktgSignOffRole; nonce: string } & (
  | { operation: 'reserve'; note: string }
  | { operation: 'start'; intentId: string }
  | { operation: 'finish'; intentId: string; receipt: MktgSignOffChangeRequest }
  | { operation: 'release'; intentId: string; proof: 'absent' | 'failed' | 'released' }
);
/** Internal receipt, never spread into an HTTP response. */
export interface MktgSignOffChangeResult {
  view: MktgRevisionResponse;
  intent: MktgSignOffChangeIntent | null;
}
/** Private mutable pointer annotation; never part of content-addressed revision bytes. */
export interface MktgDocumentSignOffAnnotation {
  state: 'pending' | 'changes-requested' | 'approved';
  requestedAt: string;
  requestedBy: string | null;
  roles: MktgSignOffRoles;
  decisions: Partial<Record<MktgSignOffRole, MktgSignOffRoleDecision>>;
  approvedAt?: string;
  changeRequest?: MktgSignOffChangeRequest;
  changeRequestNonce?: string;
  changeRequestId?: string;
  changeRequestIntent?: MktgSignOffChangeIntent;
  /** Bounded replay tombstones, not an actor identity or active-run index. */
  releasedChangeRequests?: { role: MktgSignOffRole; nonce: string }[];
}
export interface MktgRevisionSignOff {
  state: MktgDocumentSignOffAnnotation['state'];
  requestedAt: string;
  requestedBy: MktgRevisionAuthor | null;
  roles: Record<MktgSignOffRole, { name: string | null; decision?: MktgSignOffDecision }>;
  changeRequestIntent?: Pick<MktgSignOffChangeIntent, 'role' | 'startedAt'>;
  note?: string;
}
export interface MktgSignOffWrite {
  signOff: Record<string, MktgDocumentSignOffAnnotation>;
  approval?: Record<MktgSignOffRole, MktgSignOffAttribution>;
}
/** Internal server action, not a client request or authorization assertion. */
export type MktgSignOffAction = { roles: MktgSignOffRoles } | { role: MktgSignOffRole; decision: 'approved' };
export interface MktgProjectSignOffSettings {
  schema: 'mktg-project-sign-off/v1';
  mode: 'single-writer' | 'two-role';
  changedAt: string;
  changedBy: string | null;
}
/** Server-only conditional policy snapshot, never an HTTP DTO. */
export interface MktgProjectSignOffSettingsSnapshot {
  record: MktgProjectSignOffSettings | null;
  etag?: string;
}
export interface MktgProjectSignOffSettingsResponse {
  mode: MktgProjectSignOffSettings['mode'];
  roles: Record<MktgSignOffRole, MktgRevisionAuthor | null>;
  canEnable: boolean;
  /** Role/policy reason only; never an address or stored subject. */
  reason?: string;
}
export interface MktgUpdateProjectSignOffSettingsRequest {
  project: string;
  mode: MktgProjectSignOffSettings['mode'];
}
