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

/**
 * Organization record from the CDP (Community Data Platform)
 * @description Returned when finding or creating an organization via CDP API
 */
export interface CdpOrganization {
  /** CDP organization ID */
  id: string;
  /** Organization display name */
  name: string;
  /** Organization logo URL */
  logo: string;
}

/**
 * Result of resolving an organization through CDP
 * @description Contains the resolved organization details and whether the display name changed
 */
export interface OrganizationResolveResult {
  /** CDP organization ID */
  id: string;
  /** CDP display name (may differ from what the user searched) */
  name: string;
  /** Organization logo URL */
  logo: string;
  /** The name the user originally searched/selected */
  originalName: string;
  /** Whether the CDP display name differs from the original search name */
  nameChanged: boolean;
}

/**
 * Request body for creating an organization in CDP
 */
export interface CdpOrganizationCreateRequest {
  /** Organization name */
  name: string;
  /** Organization domain */
  domain: string;
  /** Source system that created this record */
  source: string;
}
