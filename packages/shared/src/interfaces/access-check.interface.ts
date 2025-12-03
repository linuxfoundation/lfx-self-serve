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
export type AccessCheckResourceType = 'project' | 'meeting' | 'committee' | 'past_meeting' | 'v1_meeting' | 'v1_past_meeting';
export type AccessCheckAccessType = 'writer' | 'viewer' | 'organizer';
