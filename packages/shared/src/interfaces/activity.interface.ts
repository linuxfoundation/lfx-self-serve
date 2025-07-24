// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type ActivityType = 'committee' | 'meeting' | 'mailing-list' | 'committee-member' | 'meeting-guest';

export interface RecentActivity {
  type: ActivityType;
  title: string;
  date: string;
  description: string;
  icon: string;
  url?: string;
  project_id: number;
}
