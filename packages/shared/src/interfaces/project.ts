// Copyright (c) 2025 The Linux Foundation and each contributor.
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
  name: string;
  slug: string;
  description: string;
  status: string;
  logo: string;
  tags: string[];
  committees_count: number;
  meetings_count: number;
  mailing_list_count: number;
}

export interface ProjectQueryItem {
  type: 'project';
  id: string;
  data: Project;
}

export type ProjectQueryResponse = {
  resources: ProjectQueryItem[];
};
