// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Indexed `key_contact.data` shape on query-service — server-side only; fields optional because the search index can omit unindexed columns per row. */
export interface KeyContactIndexedDoc {
  uid?: string;
  membership_uid?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  title?: string | null;
  role?: string;
  status?: string | null;
}

/** Indexed `project_membership.data` shape on query-service — server-side only; fields optional because the search index can omit unindexed columns per row. */
export interface ProjectMembershipIndexedDoc {
  uid?: string;
  project_slug?: string;
  project_name?: string | null;
  status?: string;
}
