// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project search result with summary information
 * @description Lightweight project data optimized for search results and listings
 */
export interface ProjectSearchResult {
  /** Unique project identifier */
  project_uid: string;
  /** Project display name */
  project_name: string;
  /** URL-friendly project identifier */
  project_slug: string;
  /** Project description text */
  project_description: string;
  /** Project lifecycle status */
  status: string;
  /** URL to project logo image */
  logo_url: string;
  /** Number of meetings associated with project */
  meetings_count: number;
  /** Number of mailing lists for the project */
  mailing_list_count: number;
  /** Names of committees within this project */
  committee_names?: string[];
  /** Recent meeting topics for context */
  meeting_topics?: string[];
}

/**
 * Parameters for project search queries
 * @description Configuration for searching projects with pagination
 */
export interface ProjectSearchParams {
  /** Search query string */
  query: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
}
