// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ProjectSearchResult {
  project_uid: string;
  project_name: string;
  project_slug: string;
  project_description: string;
  status: string;
  logo_url: string;
  meetings_count: number;
  mailing_list_count: number;
  committee_names?: string[];
  meeting_topics?: string[];
}

export interface ProjectSearchParams {
  query: string;
  limit?: number;
  offset?: number;
}
