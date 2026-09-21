// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { USER_SEARCH_TYPES } from '../constants/search.constants';

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

/**
 * The query-index corpora `GET /api/search/users` can be pointed at — the `type` the BFF forwards
 * to the query service's `/query/resources`. Derived from the runtime allowlist the BFF validates
 * against, so the two cannot drift.
 */
export type UserSearchType = (typeof USER_SEARCH_TYPES)[number];

/**
 * Where a {@link UserSearchResult} row came from: one of the searchable corpora, or
 * `project_member` for a row a consumer composed itself from a project's settings roles (the
 * formation assignee picker's candidate list — see `toAssigneeSearchOption`). Rows of that kind
 * never come back from the search endpoint.
 */
export type UserSearchResultSource = UserSearchType | 'project_member';

/**
 * User search result combining MeetingRegistrant and CommitteeMember
 * @description Common user information from either meeting registrants or committee members
 */
export interface UserSearchResult {
  /** Unique identifier for the user record */
  uid: string;
  /** User's email address */
  email: string;
  /** User's first name */
  first_name: string;
  /** User's last name */
  last_name: string;
  /** User's job title */
  job_title: string | null;
  /** User's organization information */
  organization: {
    /** Organization name */
    name: string;
    /** Organization website URL */
    website?: string | null;
  } | null;
  /** Committee information (if user is a committee member) */
  committee?: {
    /** Committee unique identifier */
    uid: string;
    /** Committee name */
    name: string;
  } | null;
  /** Source type of the user record */
  type: UserSearchResultSource;
  /** User's LFID username (optional) */
  username?: string | null;
}

/**
 * One row of a caller-supplied candidate list for `lfx-user-search`'s local mode — a
 * {@link UserSearchResult} plus what a static list can say that a directory search cannot: that
 * the row is shown but not selectable, and why. `disabled` is what the autocomplete's
 * `optionDisabled` reads; `note` renders under the name (e.g. "Invite pending").
 */
export interface UserSearchOption extends UserSearchResult {
  disabled?: boolean;
  note?: string | null;
}

/**
 * Parameters for user search queries
 * @description Query parameters for searching users across meeting registrants and committee members
 */
export interface UserSearchParams {
  /** Search query string (user name) */
  name?: string;
  /** Search query string (user email) */
  tags?: string;
  /** Type of resource to search */
  type: UserSearchType;
  /**
   * `best_match` opts into upstream `_score` ordering — meaningful only alongside `name`, and set
   * whenever `name` is: the query service defaults to `name_asc`, and OpenSearch discards relevance
   * once an explicit non-score sort is present, so a typeahead without it gets the alphabetically
   * first page of matches rather than the closest ones.
   */
  sort?: 'name_asc' | 'best_match';
}

/**
 * Response structure for user search API
 * @description Container for user search results with metadata
 */
export interface UserSearchResponse {
  /** Array of user search results */
  results: UserSearchResult[];
  /** Total number of matching users */
  total?: number;
  /** Whether there are more results available */
  has_more?: boolean;
}
