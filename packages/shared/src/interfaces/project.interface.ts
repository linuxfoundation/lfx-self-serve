// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Complete project entity with all metadata
 * @description Full project information from the LFX platform
 */
export interface Project {
  /** Unique project identifier */
  uid: string;
  /** URL-friendly project identifier */
  slug: string;
  /** Project description text */
  description: string;
  /** Project display name */
  name: string;
  /** Write access permission for current user (response only) */
  writer?: boolean;
  /** Whether project is publicly visible */
  public: boolean;
  /** Parent project UID (for subprojects) */
  parent_uid: string;
  /** Project lifecycle stage */
  stage: string;
  /** Project category classification */
  category: string;
  /** Array of funding model types */
  funding_model: string[];
  /** URL to project charter document */
  charter_url: string;
  /** Legal entity structure type */
  legal_entity_type: string;
  /** Legal entity name */
  legal_entity_name: string;
  /** Parent legal entity UID */
  legal_parent_uid: string;
  /** Whether automatic membership joining is enabled */
  autojoin_enabled: boolean;
  /** Date when project was formed (ISO string) */
  formation_date: string;
  /** URL to project logo image */
  logo_url: string;
  /** Main repository URL */
  repository_url: string;
  /** Project website URL */
  website_url: string;
  /** Timestamp when project was created */
  created_at: string;
  /** Timestamp when project was last updated */
  updated_at: string;
  /** Number of mailing lists associated */
  mailing_list_count: number;
}

/**
 * API response type for project queries
 * @description Array of projects returned from API endpoints
 */
export type ProjectQueryResponse = Project[];

/**
 * User information for project permissions
 * @description Complete user profile data for project writers and auditors
 */
export interface UserInfo {
  /** User's full name */
  name: string;
  /** User's email address */
  email: string;
  /** User's username/LFID */
  username: string;
  /** URL to user's avatar image (optional) */
  avatar?: string;
}

/**
 * Project settings
 * @description Project settings for the LFX platform
 */
export interface ProjectSettings {
  /** Unique project identifier */
  uid: string;
  /** Project announcement date */
  announcement_date: string;
  /** Project writers with full user information */
  writers: UserInfo[];
  /** Project auditors with full user information */
  auditors: UserInfo[];
  /** Project created at */
  created_at: string;
  /** Project updated at */
  updated_at: string;
}

/**
 * Project slug to ID response payload
 */
export interface ProjectSlugToIdResponse {
  uid: string;
  slug: string;
  exists: boolean;
}

/**
 * Project context for the application state
 * @description Minimal project information used for context management
 */
export interface ProjectContext {
  /** Unique project identifier */
  uid: string;
  /** Project display name */
  name: string;
  /** URL-friendly project identifier */
  slug: string;
  /** Parent project UID (present for sub-projects; absent for top-level foundations) */
  parent_uid?: string;
}

/**
 * Pending survey response from analytics database
 * @description Survey data for member dashboard pending actions
 */
export interface PendingSurveyRow {
  /** Unique survey identifier */
  SURVEY_ID: string;
  /** Survey title/name */
  SURVEY_TITLE: string;
  /** Survey status (e.g., sent) */
  SURVEY_STATUS: string;
  /** Survey cohort date */
  SURVEY_COHORT_DATE: string;
  /** Survey cutoff/due date */
  SURVEY_CUTOFF_DATE: string;
  /** Committee identifier */
  COMMITTEE_ID: string;
  /** Committee name */
  COMMITTEE_NAME: string;
  /** Committee category (e.g., Board) */
  COMMITTEE_CATEGORY: string;
  /** Project identifier */
  PROJECT_ID: string;
  /** Project slug */
  PROJECT_SLUG: string;
  /** Project name */
  PROJECT_NAME: string;
  /** Response identifier */
  RESPONSE_ID: string;
  /** Response date */
  RESPONSE_DATE: string;
  /** Respondent first name */
  FIRST_NAME: string;
  /** Respondent last name */
  LAST_NAME: string;
  /** Respondent email */
  EMAIL: string;
  /** Account identifier */
  ACCOUNT_ID: string;
  /** Account name */
  ACCOUNT_NAME: string;
  /** Organization identifier */
  ORGANIZATION_ID: string;
  /** Organization name */
  ORGANIZATION_NAME: string;
  /** Response type (e.g., non_response) */
  RESPONSE_TYPE: string;
  /** Survey link URL */
  SURVEY_LINK: string;
}
