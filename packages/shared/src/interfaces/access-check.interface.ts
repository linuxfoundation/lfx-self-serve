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
  /** `project` only: `writer or global_writer`. Staff whose access is a per-project global-team grant hold this, not bare `writer`. */
  | 'writer_guard'
  | 'viewer'
  | 'auditor'
  /** `project` only: `auditor or global_auditor`. `global_writer` does not compose into it, so pair it with `writer_guard` where writers must also pass. */
  | 'auditor_guard'
  | 'organizer'
  | 'meeting_coordinator'
  | 'host'
  | 'member'
  | 'marketing_auditor'
  | 'campaign_manager'
  /** Scheduled for removal from the model once `team:marketing-ops` moves to `global_marketing_ops`; drop it here first. */
  | 'marketing_ops'
  | 'global_marketing_ops';
