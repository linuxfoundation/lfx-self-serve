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
 * @description Raw shape returned by the CDP API when finding or creating an organization
 */
export interface CdpOrganization {
  /** CDP internal organization ID (not a Salesforce SFID — never forward to v1 Project Service) */
  id: string;
  /** Organization display name */
  name: string;
  /** Organization logo URL */
  logo: string;
}

/**
 * Response from the BFF POST /api/organizations/resolve endpoint
 * @description Distinct from CdpOrganization — the BFF replaces the CDP org ID with the b2b SFID
 * before returning to the client, so the id field has different semantics.
 */
export interface OrganizationResolveResponse {
  /**
   * b2b Salesforce Account SFID (18-char), or null when no LF member account was found.
   * Callers that store this as organization.id in committee-service payloads must treat null
   * as "omit id" so v1-sync-helper falls back to resolveV1OrgID(name, website).
   */
  id: string | null;
  /** Organization display name (may differ from what the user searched) */
  name: string;
  /** Organization logo URL */
  logo: string;
}

/**
 * Result of resolving an organization through CDP
 * @description Enriched form of OrganizationResolveResponse with name-change metadata
 */
export interface OrganizationResolveResult {
  /**
   * b2b Salesforce Account SFID (18-char), or null when no LF member account was found.
   * Sourced from OrganizationResolveResponse.id — treat null as "omit id" in committee-service payloads.
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
