// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterOption, FilterPillColor, ProjectPermissionRole } from '../interfaces';

/**
 * Project permission roles, shared by the user form and the permissions table role filter.
 * The value type is the `ProjectPermissionRole` union, so adding a role also means widening
 * that union, the table's Role column label, and the role color map below.
 */
export const PROJECT_PERMISSION_ROLE_OPTIONS: readonly FilterOption<ProjectPermissionRole>[] = [
  { label: 'View', value: 'view' },
  { label: 'Manage', value: 'manage' },
  { label: 'Meeting Coordinator', value: 'meeting_coordinator' },
];

/** Filter pill color for each role in the permissions table */
export const PROJECT_PERMISSION_ROLE_COLOR: Record<ProjectPermissionRole, FilterPillColor> = {
  manage: 'green',
  view: 'blue',
  meeting_coordinator: 'purple',
};
