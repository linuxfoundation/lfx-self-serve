// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface Committee {
  id: string;
  name: string;
  category: string;
  parent_uid?: string | null;
  description?: string;
  business_email_required: boolean;
  enable_voting: boolean;
  is_audit_enabled: boolean;
  public_enabled: boolean;
  public_name?: string;
  sso_group_enabled: boolean;
  sso_group_name?: string;
  committee_website?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  updated_by?: string;
  system_mod_stamp: string;
  total_members: number;
  total_voting_reps: number;
  project_uid: string;
  joinable?: boolean;
}

export interface CommitteeSummary {
  id: string;
  name: string;
  category: string;
}
