// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ProjectCardMetric {
  icon: string;
  label: string;
  value: number;
  badge?: {
    label: string;
    severity: 'success' | 'info' | 'warning' | 'danger';
  };
}

export interface ProjectMetric {
  icon: string;
  label: string;
  value: number;
}

export interface FilterButton {
  label: string;
  icon?: string;
  active?: boolean;
}

export interface Project {
  uid: string;
  slug: string;
  description: string;
  name: string;
  public: boolean;
  parent_uid: string;
  stage: string;
  category: string;
  funding_model: string[];
  charter_url: string;
  legal_entity_type: string;
  legal_entity_name: string;
  legal_parent_uid: string;
  autojoin_enabled: boolean;
  formation_date: string;
  logo_url: string;
  repository_url: string;
  website_url: string;
  created_at: string;
  updated_at: string;
  committees_count: number;
  meetings_count: number;
  mailing_list_count: number;
}

export interface ProjectCard extends Partial<Project> {
  metrics: ProjectCardMetric[];
}

export type ProjectQueryResponse = Project[];
