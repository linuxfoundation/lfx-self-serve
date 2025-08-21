// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Committee entity with complete details
 * @description Represents a committee/working group within a project with full metadata
 */
export interface Committee {
  /** Unique identifier for the committee */
  uid: string;
  /** Committee name */
  name: string;
  /** Display name for UI presentation (optional override) */
  display_name?: string;
  /** Committee category/type (e.g., "Technical", "Legal", "Board") */
  category: string;
  /** Optional description of the committee's purpose */
  description?: string;
  /** UID of parent committee for hierarchical structures */
  parent_uid?: string;
  /** Whether voting functionality is enabled for this committee */
  enable_voting: boolean;
  /** Whether the committee is publicly visible */
  public: boolean;
  /** Whether SSO group integration is enabled */
  sso_group_enabled: boolean;
  /** Associated SSO group name for membership sync */
  sso_group_name?: string;
  /** Committee website URL */
  website?: string;
  /** Whether committee membership requires review */
  requires_review?: boolean;
  /** Timestamp when committee was created */
  created_at: string;
  /** Timestamp when committee was last updated */
  updated_at: string;
  /** Total number of committee members */
  total_members: number;
  /** Total number of voting representatives */
  total_voting_reps: number;
  /** Associated project UID */
  project_uid: string;
  /** Associated project name (populated from project data) */
  project_name?: string;
  /** Calendar visibility settings */
  calendar?: {
    /** Whether committee calendar is public */
    public: boolean;
  };
  /** Whether business email is required for membership (from settings) */
  business_email_required?: boolean;
  /** Whether audit logging is enabled (from settings) */
  is_audit_enabled?: boolean;
}

/**
 * Committee settings configuration
 * @description Administrative settings for committee governance and compliance
 */
export interface CommitteeSettings {
  /** Committee UID these settings apply to */
  uid: string;
  /** Whether members must use business email addresses */
  business_email_required: boolean;
  /** Timestamp of last settings review */
  last_reviewed_at?: string;
  /** User ID who last reviewed the settings */
  last_reviewed_by?: string;
  /** Array of user IDs with write permissions */
  writers: string[];
  /** Array of user IDs with audit permissions */
  auditors: string[];
  /** Timestamp when settings were created */
  created_at: string;
  /** Timestamp when settings were last updated */
  updated_at: string;
}

/**
 * Minimal committee information for lists and dropdowns
 * @description Lightweight committee representation for UI components
 */
export interface CommitteeSummary {
  /** Committee unique identifier */
  uid: string;
  /** Committee display name */
  name: string;
  /** Committee category/type */
  category: string;
}

/**
 * Data required to create a new committee
 * @description Input payload for committee creation API
 */
export interface CommitteeCreateData {
  /** Committee name (required) */
  name: string;
  /** Committee category (required) */
  category: string;
  /** Optional committee description */
  description?: string;
  /** Parent committee UID for hierarchical structure */
  parent_uid?: string;
  /** Require business email for membership */
  business_email_required?: boolean;
  /** Enable voting functionality */
  enable_voting?: boolean;
  /** Enable audit logging */
  is_audit_enabled?: boolean;
  /** Make committee publicly visible */
  public?: boolean;
  /** Display name override */
  display_name?: string;
  /** Enable SSO group integration */
  sso_group_enabled?: boolean;
  /** SSO group name for membership sync */
  sso_group_name?: string;
  /** Committee website URL */
  website?: string;
  /** Associated project UID */
  project_uid?: string;
  /** Whether committee is open for self-joining */
  joinable?: boolean;
}

/**
 * Data for updating existing committee
 * @description Partial update payload allowing any field from create data to be modified
 */
export interface CommitteeUpdateData extends Partial<CommitteeCreateData> {}

/**
 * Committee settings update data
 * @description Specific settings that can be updated independently
 */
export interface CommitteeSettingsData {
  /** Update business email requirement */
  business_email_required?: boolean;
  /** Update audit logging setting */
  is_audit_enabled?: boolean;
}

/**
 * Validation error for committee operations
 * @description Detailed error information for form validation
 */
export interface CommitteeValidationError {
  /** Field name that failed validation */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
}

/**
 * Result of committee validation
 * @description Validation outcome with any errors found
 */
export interface CommitteeValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Array of validation errors (empty if valid) */
  errors: CommitteeValidationError[];
}
