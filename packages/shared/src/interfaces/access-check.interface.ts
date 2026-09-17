// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Access check request for a single resource
 */
export interface AccessCheckRequest {
  /** Resource type (project, meeting, committee) */
  resource: AccessCheckResourceType;
  /** Resource unique identifier */
  id: string;
  /** Access type to check (writer, viewer, etc.) */
  access: AccessCheckAccessType;
}

/**
 * Internal format for the microservice access check API
 */
export interface AccessCheckApiRequest {
  /** Array of access check strings in format "resource:id#access" */
  requests: string[];
}

/**
 * Response from the access check microservice
 */
export interface AccessCheckApiResponse {
  /** Array of result strings in format "resource:id#access@user:username\ttrue/false" */
  results: string[];
}

/**
 * Resource types
 */
export type AccessCheckResourceType =
  | 'project'
  | 'meeting'
  | 'committee'
  | 'past_meeting'
  | 'v1_meeting'
  | 'v1_past_meeting'
  | 'groupsio_service'
  | 'groupsio_mailing_list'
  | 'groupsio_member'
  | 'team'
  /** LFXV2-3029 — b2b_org, so the BFF can ask the authorizer to classify connected-component candidates instead of re-deriving the hierarchy rule locally. No access-type change needed: `writer` and `auditor` are already in the union below. */
  | 'b2b_org';
export type AccessCheckAccessType =
  | 'writer'
  | 'viewer'
  | 'auditor'
  | 'organizer'
  | 'meeting_coordinator'
  | 'host'
  | 'member'
  | 'marketing_auditor'
  | 'campaign_manager'
  | 'marketing_ops';
