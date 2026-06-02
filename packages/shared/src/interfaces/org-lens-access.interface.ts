// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec 025 — Org Lens Access tab (People page). In-flight shapes shared between
// member-service (upstream), the Express BFF, and the Angular client. No persistent
// storage is introduced. See specs/025-org-lens-access-tab/data-model.md.

/** UI role value (compact). Maps to the FGA writer/auditor relations. */
export type OrgAccessRole = 'admin' | 'viewer';

/** Invite lifecycle state surfaced from the settings record. */
export type OrgAccessInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** Invite states that can appear on a listed row (revoked/expired are filtered out before listing). */
export type OrgAccessListedInviteStatus = Extract<OrgAccessInviteStatus, 'pending' | 'accepted'>;

/** Type-filter selection (single-select) for the access table toolbar. */
export type OrgAccessFilter = 'all' | 'admin' | 'viewer' | 'invited';

/** Type-filter dropdown option for the Org Lens Access toolbar (single-select). */
export interface OrgAccessTypeFilterOption {
  label: string;
  value: OrgAccessFilter;
}

/** One row in the Org Lens Access table (BFF → client). */
export interface OrgAccessUser {
  /** Lowercased; identity key for edit/remove. Always present. */
  email: string;
  /** Display name; falls back to the email local-part when blank. */
  name: string;
  /** Derived for the avatar chip. */
  initials: string;
  /** From settings `avatar` when present, else `null`. */
  avatarUrl: string | null;
  /** Best-effort enrichment by email; `null` when unknown. */
  jobTitle: string | null;
  /** `admin` (writer) or `viewer` (auditor). */
  role: OrgAccessRole;
  /** `accepted` or `pending` for listed rows. */
  inviteStatus: OrgAccessListedInviteStatus;
  /** `true` when `inviteStatus !== 'accepted'`. Drives the "Invited" filter and hides Edit. */
  isPending: boolean;
}

/** Derived counts for the summary cards. */
export interface OrgAccessSummary {
  /** Count of all listed rows (accepted + pending). */
  totalUsers: number;
  /** Count of accepted admins (writers). */
  administrators: number;
  /** Count of accepted viewers (auditors). */
  viewers: number;
}

/** BFF list payload for the access tab. */
export interface OrgAccessListResponse {
  orgUid: string;
  /** All listed rows; the client paginates/filters client-side. */
  users: OrgAccessUser[];
  summary: OrgAccessSummary;
  /** Caller is a direct writer of this org (UX-only gate; backend enforces). */
  canManage: boolean;
}

/** PUT /api/orgs/:orgUid/lens/access/users/:email — change role. */
export interface OrgAccessRoleChangeRequest {
  /** Target role (must differ from the current role). */
  role: OrgAccessRole;
}

/** POST /api/orgs/:orgUid/lens/access/users — invite a new principal (Add Users flow). */
export interface OrgAccessInviteRequest {
  /** Invitee email (identity key); the new grant lands as `pending` until accepted. */
  email: string;
  /** Role to grant: `admin` (writer) or `viewer` (auditor). */
  role: OrgAccessRole;
  /** Optional display name; member-service derives it from the user record when omitted. */
  name?: string | null;
}

/** Dropdown option for the edit modal's "Change to" role select. */
export interface OrgAccessRoleOption {
  label: string;
  value: OrgAccessRole;
  disabled: boolean;
}

/** Payload emitted when the Add Users modal submits an invite. */
export interface OrgAccessInviteFormValue {
  email: string;
  role: OrgAccessRole;
  name: string | null;
}

/** Mapped upstream-error contract for access write responses (mirrors KeyContactErrorResult). */
export interface AccessErrorResult {
  status: number;
  message: string;
  conflict: boolean;
}

// Upstream contract shapes (member-service; snake_case) -----------------------

/** Principal on a b2b_org settings list (member-service OrgUserType). */
export interface MemberServiceOrgUser {
  avatar?: string | null;
  /** Required. */
  email: string;
  name?: string | null;
  /** Absent for pending invites. */
  username?: string | null;
  /** Required. */
  invited_as: 'writer' | 'auditor';
  invite_status?: OrgAccessInviteStatus;
}

/** GET /b2b_orgs/{uid}/settings body. Writes use the per-principal endpoints, not a full-replace PUT. */
export interface MemberServiceB2bOrgSettings {
  writers?: MemberServiceOrgUser[];
  auditors?: MemberServiceOrgUser[];
}
