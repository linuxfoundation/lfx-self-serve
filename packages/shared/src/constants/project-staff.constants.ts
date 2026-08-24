// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectStaffRowConfig } from '../interfaces/project.interface';

export const PROJECT_STAFF_ROWS: readonly ProjectStaffRowConfig[] = [
  { key: 'executive_director', label: 'Executive Director', icon: 'fa-light fa-user-tie' },
  { key: 'program_manager', label: 'Program Manager', icon: 'fa-light fa-user-gear' },
  { key: 'opportunity_owner', label: 'Opportunity Owner', icon: 'fa-light fa-user-chart' },
] as const;

/**
 * Staff roles editable from Self Serve (Executive Director, Program Manager).
 * Opportunity Owner is intentionally excluded — it is managed in PCC/Salesforce.
 */
export const EDITABLE_STAFF_ROLES = ['executive_director', 'program_manager'] as const satisfies readonly ProjectStaffRowConfig['key'][];
