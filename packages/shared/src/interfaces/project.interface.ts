// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding } from '../enums/project-funding.enum';

export interface Project {
  uid: string;
  slug: string;
  description: string;
  name: string;
  /** Response-only — write access for the current user. */
  writer?: boolean;
  public: boolean;
  parent_uid: string;
  stage: string;
  category: string;
  /** Upstream Goa enum — optional to tolerate records indexed before the attribute was rolled out. */
  funding?: ProjectFunding;
  funding_model: string[];
  charter_url: string;
  legal_entity_type: string;
  legal_entity_name: string;
  legal_parent_uid: string;
  autojoin_enabled: boolean;
  formation_date: string;
  logo_url: string;
  repository_url: string;
  website_url: string;
  created_at: string;
  updated_at: string;
  mailing_list_count: number;
}

export type ProjectQueryResponse = Project[];

export interface UserInfo {
  name: string;
  email: string;
  username: string;
  avatar?: string;
}

export interface ProjectSettings {
  uid: string;
  announcement_date: string;
  writers: UserInfo[];
  auditors: UserInfo[];
  executive_director?: UserInfo | null;
  program_manager?: UserInfo | null;
  opportunity_owner?: UserInfo | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSlugToIdResponse {
  uid: string;
  slug: string;
  exists: boolean;
}

export interface ProjectContext {
  uid: string;
  name: string;
  slug: string;
  /** Present for sub-projects, absent for top-level foundations. */
  parent_uid?: string;
  logoUrl?: string;
}

export interface PendingSurveyRow {
  SURVEY_ID: string;
  SURVEY_TITLE: string;
  SURVEY_STATUS: string;
  SURVEY_COHORT_DATE: string;
  SURVEY_CUTOFF_DATE: string;
  COMMITTEE_ID: string;
  COMMITTEE_NAME: string;
  COMMITTEE_CATEGORY: string;
  PROJECT_ID: string;
  PROJECT_SLUG: string;
  PROJECT_NAME: string;
  RESPONSE_ID: string;
  RESPONSE_DATE: string;
  FIRST_NAME: string;
  LAST_NAME: string;
  EMAIL: string;
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  ORGANIZATION_ID: string;
  ORGANIZATION_NAME: string;
  RESPONSE_TYPE: string;
  SURVEY_LINK: string;
}
