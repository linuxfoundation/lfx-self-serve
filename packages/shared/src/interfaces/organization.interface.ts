// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Organization suggestion from search results
 * @description Individual organization entry returned from typeahead search
 */
export interface OrganizationSuggestion {
  /** Organization display name */
  name: string;
  /** Organization domain name */
  domain: string;
}

/**
 * Response containing organization suggestions
 * @description API response format for organization typeahead search
 */
export interface OrganizationSuggestionsResponse {
  /** Array of organization suggestions */
  suggestions: OrganizationSuggestion[];
}
