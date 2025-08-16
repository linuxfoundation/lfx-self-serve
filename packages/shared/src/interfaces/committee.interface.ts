// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface Committee {
  uid: string;
  name: string;
  display_name?: string;
  category: string;
  description?: string;
  parent_uid?: string;
  enable_voting: boolean;
  public: boolean;
  sso_group_enabled: boolean;
  sso_group_name?: string;
  website?: string;
  requires_review?: boolean;
  created_at: string;
  updated_at: string;
  total_members: number;
  total_voting_reps: number;
  project_uid: string;
  project_name?: string;
  calendar?: {
    public: boolean;
  };
  // These fields will be populated from the settings endpoint
  business_email_required?: boolean;
  is_audit_enabled?: boolean;
}

export interface CommitteeSettings {
  uid: string;
  business_email_required: boolean;
  last_reviewed_at?: string;
  last_reviewed_by?: string;
  writers: string[];
  auditors: string[];
  created_at: string;
  updated_at: string;
}

export interface CommitteeSummary {
  uid: string;
  name: string;
  category: string;
}

export interface CommitteeCreateData {
  name: string;
  category: string;
  description?: string;
  parent_uid?: string;
  business_email_required?: boolean;
  enable_voting?: boolean;
  is_audit_enabled?: boolean;
  public?: boolean;
  display_name?: string;
  sso_group_enabled?: boolean;
  sso_group_name?: string;
  website?: string;
  project_uid?: string;
  joinable?: boolean;
}

export interface CommitteeUpdateData extends Partial<CommitteeCreateData> {}

export interface CommitteeSettingsData {
  business_email_required?: boolean;
  is_audit_enabled?: boolean;
}

export interface CommitteeValidationError {
  field: string;
  message: string;
  code: string;
}

export interface CommitteeValidationResult {
  isValid: boolean;
  errors: CommitteeValidationError[];
}
