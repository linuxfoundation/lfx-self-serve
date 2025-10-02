// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Metric data for project cards with optional badge indicator
 * @description Displays key project statistics with visual indicators
 */
export interface ProjectCardMetric {
  /** Icon name/class for the metric */
  icon: string;
  /** Display label for the metric */
  label: string;
  /** Numeric value of the metric */
  value: number;
  /** Optional badge with status indicator */
  badge?: {
    /** Badge text label */
    label: string;
    /** Badge color/severity level */
    severity: 'success' | 'info' | 'warning' | 'danger';
  };
}

/**
 * Simple metric display for project statistics
 * @description Basic metric representation without additional styling
 */
export interface ProjectMetric {
  /** Icon name/class for the metric */
  icon: string;
  /** Display label for the metric */
  label: string;
  /** Numeric value of the metric */
  value: number;
}

/**
 * Filter button configuration for project lists
 * @description Interactive filter controls for project navigation
 */
export interface FilterButton {
  /** Button display text */
  label: string;
  /** Optional icon for the button */
  icon?: string;
  /** Whether the filter is currently active */
  active?: boolean;
}

/**
 * Complete project entity with all metadata
 * @description Full project information from the LFX platform
 */
export interface Project {
  /** Unique project identifier */
  uid: string;
  /** URL-friendly project identifier */
  slug: string;
  /** Project description text */
  description: string;
  /** Project display name */
  name: string;
  /** Write access permission for current user (response only) */
  writer?: boolean;
  /** Whether project is publicly visible */
  public: boolean;
  /** Parent project UID (for subprojects) */
  parent_uid: string;
  /** Project lifecycle stage */
  stage: string;
  /** Project category classification */
  category: string;
  /** Array of funding model types */
  funding_model: string[];
  /** URL to project charter document */
  charter_url: string;
  /** Legal entity structure type */
  legal_entity_type: string;
  /** Legal entity name */
  legal_entity_name: string;
  /** Parent legal entity UID */
  legal_parent_uid: string;
  /** Whether automatic membership joining is enabled */
  autojoin_enabled: boolean;
  /** Date when project was formed (ISO string) */
  formation_date: string;
  /** URL to project logo image */
  logo_url: string;
  /** Main repository URL */
  repository_url: string;
  /** Project website URL */
  website_url: string;
  /** Timestamp when project was created */
  created_at: string;
  /** Timestamp when project was last updated */
  updated_at: string;
  /** Number of committees in this project */
  committees_count: number;
  /** Number of meetings scheduled/held */
  meetings_count: number;
  /** Number of mailing lists associated */
  mailing_list_count: number;
}

/**
 * Project data optimized for card display with metrics
 * @description Extends partial project data with calculated metrics for UI cards
 */
export interface ProjectCard extends Partial<Project> {
  /** Array of metrics to display on the project card */
  metrics: ProjectCardMetric[];
}

/**
 * API response type for project queries
 * @description Array of projects returned from API endpoints
 */
export type ProjectQueryResponse = Project[];

/**
 * Project settings
 * @description Project settings for the LFX platform
 */
export interface ProjectSettings {
  /** Unique project identifier */
  uid: string;
  /** Project announcement date */
  announcement_date: string;
  /** Project writers */
  writers: string[];
  /** Project auditors */
  auditors: string[];
  /** Project created at */
  created_at: string;
  /** Project updated at */
  updated_at: string;
}

/**
 * Project slug to ID response payload
 */
export interface ProjectSlugToIdResponse {
  projectId: string;
  slug: string;
  exists: boolean;
}
