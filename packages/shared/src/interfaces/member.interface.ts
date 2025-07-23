// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface CommitteeMember {
  id: string;
  created_at: string;
  updated_at?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string;
  organization?: string;
  organization_url?: string;
  role?: string;
  voting_status?: string;
  appointed_by?: string;
  role_start?: string;
  role_end?: string;
  voting_status_start?: string;
  voting_status_end?: string;
  committee_id: string;
}

export interface CreateCommitteeMemberRequest {
  first_name: string;
  last_name: string;
  email: string;
  job_title?: string;
  organization?: string;
  organization_url?: string;
  role?: string;
  voting_status?: string;
  appointed_by?: string;
  role_start?: string;
  role_end?: string;
  voting_status_start?: string;
  voting_status_end?: string;
}
