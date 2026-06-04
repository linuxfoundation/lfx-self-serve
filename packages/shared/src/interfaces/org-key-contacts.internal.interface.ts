// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Mapped upstream error contract for key-contact write responses. */
export interface KeyContactErrorResult {
  status: number;
  message: string;
  conflict: boolean;
}

/** Minimal query-service key_contact document used by the BFF key-contact services. */
export interface KeyContactDoc {
  uid: string;
  membership_uid?: string;
  project_membership_uid?: string;
  role?: string;
  status?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  emails?: string[];
  primary_contact?: boolean;
  board_member?: boolean;
}

/** Minimal query-service project_membership document used during key-contact resolution. */
export interface ProjectMembershipDoc {
  uid: string;
  b2b_org_uid?: string;
  project_uid?: string;
  project_slug?: string;
  status?: string;
  start_date?: string;
}

/** Resolved org-membership context passed between key-contact BFF services. */
export interface ResolvedMembershipContext {
  b2bOrgUid: string;
  membershipUid: string;
  projectUid: string | null;
}
