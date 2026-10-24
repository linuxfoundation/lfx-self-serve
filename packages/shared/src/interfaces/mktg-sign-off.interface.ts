// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgRevisionAuthor } from './mktg-document-store.interface';

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
  commentId: string;
  submissionId: string | null;
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
}
export interface MktgRevisionSignOff {
  state: MktgDocumentSignOffAnnotation['state'];
  requestedAt: string;
  requestedBy: MktgRevisionAuthor | null;
  roles: Record<MktgSignOffRole, { name: string | null; decision?: MktgSignOffDecision }>;
}
export interface MktgSignOffWrite {
  signOff: Record<string, MktgDocumentSignOffAnnotation>;
  approval?: Record<MktgSignOffRole, MktgSignOffAttribution>;
}
/** Internal server action, not a client request or authorization assertion. */
export type MktgSignOffAction =
  | { roles: MktgSignOffRoles }
  | { role: MktgSignOffRole; decision: MktgSignOffDecision; changeRequest?: MktgSignOffChangeRequest };
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
