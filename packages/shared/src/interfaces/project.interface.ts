// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding } from '../enums/project-funding.enum';
import { ProjectStage } from '../enums/project-stage.enum';

export interface Project {
  uid: string;
  slug: string;
  description: string;
  name: string;
  /** Response-only — write access for the current user. */
  writer?: boolean;
  public: boolean;
  parent_uid: string;
  stage: ProjectStage | string;
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

export type ProjectDocumentType = 'file' | 'link' | 'folder';

/**
 * Document types accepted by the JSON `POST /projects/:uid/documents` create endpoint.
 * Files are uploaded via a separate multipart endpoint, not this one — keep this union
 * narrow so misuse (sending `type: 'file'` to the JSON endpoint) is caught at compile time.
 */
export type CreateProjectDocumentType = 'link' | 'folder';

/**
 * A document or resource link associated with a project.
 */
export interface ProjectDocument {
  uid: string;
  type: ProjectDocumentType;
  name: string;
  /**
   * URL for `link`-type documents only. Files are not downloaded via this field —
   * use the BFF endpoint `/api/projects/:uid/documents/:documentId/download` (exposed
   * to the UI as `MyDocumentItem.downloadUrl`) so the upstream-streamed
   * `Content-Disposition` controls the filename.
   */
  url?: string;
  /** Optional description */
  description?: string;
  /** MIME type or file extension (files only) */
  mime_type?: string;
  /** File size in bytes (files only) */
  file_size?: number;
  /** ISO date string of creation */
  created_at?: string;
  /** ISO date string of last update */
  updated_at?: string;
  /** UID of the user who created the document */
  created_by?: string;
  uploaded_by?: string;
  /** Parent folder UID (for nested documents) */
  parent_uid?: string;
  /** Project UID this document belongs to */
  project_uid?: string;
}

/** Request body for creating a project document (folder or link). */
export interface CreateProjectDocumentRequest {
  type: CreateProjectDocumentType;
  name: string;
  /** Required for type 'link' */
  url?: string;
  description?: string;
  /** Parent folder UID (to place a link inside a folder) */
  parent_uid?: string;
  /** Display name of the creator (populated by BFF from session) */
  created_by_name?: string;
}

/**
 * Multipart upload payload for a project file document.
 * The actual `File` is sent separately via FormData / raw body — this interface
 * captures the metadata sent alongside it.
 */
export interface UploadProjectDocumentRequest {
  /** Display name for the document (max 500 chars) */
  name: string;
  /** Original file name (max 500 chars) */
  file_name: string;
  /** MIME type of the uploaded file */
  content_type: string;
  /**
   * File size in bytes. **BFF-only** — used to validate the request body
   * length against the client-reported size. Not forwarded to upstream
   * (upstream UploadProjectDocumentRequestBody has no `file_size` field).
   */
  file_size: number;
  /** Optional description (max 2000 chars) */
  description?: string;
  /**
   * Optional folder UID to nest the file inside a project folder.
   * When omitted, the file lands at the project root.
   */
  folder_uid?: string;
}

/** Upstream response shape returned by the project-service file upload endpoint. */
export interface ProjectDocumentUpstreamResponse {
  uid: string;
  name: string;
  file_name: string;
  file_size: number;
  content_type: string;
  description?: string;
  project_uid?: string;
  created_at?: string;
  updated_at?: string;
  uploaded_by_username?: string;
}

/**
 * Query-service shape for an indexed `project_document` resource. Files are not exposed
 * via a list endpoint upstream; they're discovered via the indexer (subject
 * `lfx.index.project_document`). Tag conventions mirror `committee_document`:
 *   - `project_document_uid:{uid}` — single-document lookup
 *   - `project_uid:{projectUID}`   — list all documents for a project
 *   - `content_type:{contentType}` — filter by MIME type
 *   - `uploaded_by:{username}`     — filter by uploader
 */
export interface ProjectDocumentQueryResult {
  uid: string;
  name: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
  description?: string;
  project_uid?: string;
  folder_uid?: string;
  created_at?: string;
  updated_at?: string;
  uploaded_by_username?: string;
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
