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
  | 'team';
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
  | 'marketing_ops'
  /**
   * TODO(#1957): not yet a real FGA relation — `lfx-v2-formation-service`/`lfx-v2-helm` haven't
   * shipped the `formation_item` type or its `gate_writer` relation. Added now so the frontend/BFF
   * types are ready; until then `FormationItemAccessService.canComplete` fabricates this value from
   * a real LF-staff check rather than an actual `checkSingleAccess` call.
   */
  | 'gate_writer';
