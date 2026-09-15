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

/**
 * Error code for a 404 raised by the staff update's own project-settings read/write, as opposed to
 * the generic `NOT_FOUND` the directory lookup raises for an unknown assignee email. Both failures
 * are 404s with identical shapes otherwise, and only the directory miss may offer manual entry —
 * so the project failure carries its own code and the client gates the fallback on `NOT_FOUND`.
 */
export const PROJECT_SETTINGS_NOT_FOUND_CODE = 'PROJECT_SETTINGS_NOT_FOUND';
