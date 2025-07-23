// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface Committee {
  id: string;
  name: string;
  category: string;
  committee_id: string;
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
  subcommittees: Subcommittee[] | null;
  project_id: string;
}

export interface Subcommittee {
  id: string;
  name: string;
  category: string;
  committee_id: string;
  committee?: CommitteeSummary;
  description?: string;
  business_email_required: boolean;
  enable_voting: boolean;
  is_audit_enabled: boolean;
  public_enabled: boolean;
  public_name?: string;
  sso_group_enabled: boolean;
  sso_group_name?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  last_updated_by?: string;
  system_mod_stamp: string;
  total_members: number;
  total_voting_reps: number;
  subcommittees: Subcommittee[] | null;
  project_id: string;
}

export interface CommitteeSummary {
  id: string;
  name: string;
  category: string;
}
