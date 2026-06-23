// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectSettings } from '../interfaces/project.interface';

export interface ProjectStaffRowConfig {
  key: keyof Pick<ProjectSettings, 'executive_director' | 'program_manager' | 'opportunity_owner'>;
  label: string;
  icon: string;
}

export const PROJECT_STAFF_ROWS: readonly ProjectStaffRowConfig[] = [
  { key: 'executive_director', label: 'Executive Director', icon: 'fa-light fa-user-tie' },
  { key: 'program_manager', label: 'Program Manager', icon: 'fa-light fa-user-gear' },
  { key: 'opportunity_owner', label: 'Opportunity Owner', icon: 'fa-light fa-user-chart' },
] as const;
