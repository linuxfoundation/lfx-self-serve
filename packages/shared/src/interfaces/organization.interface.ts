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
  /** Organization logo URL */
  logo?: string;
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
  /**
   * b2b Salesforce Account SFID (18-char), or null when no LF member account was found.
   * Never a CDP org ID — the resolve endpoint now returns the b2b SFID so committee-service
   * can forward it to v1-sync-helper without triggering "some organization IDs do not exist".
   */
  id: string | null;
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
  /**
   * b2b Salesforce Account SFID (18-char), or null when no LF member account was found.
   * Never a CDP org ID — callers that use this as organization.id in committee-service payloads
   * must treat null as "omit id" so v1-sync-helper falls back to resolveV1OrgID(name, website).
   */
  id: string | null;
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
  /** Organization logo URL */
  logo?: string;
}
