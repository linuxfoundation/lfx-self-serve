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

/**
 * `code` the BFF answers an add-user request with (a 409) when the person is already listed on the
 * project. Add is not an upsert, so a role change goes through the row's Edit action instead.
 * Mirrors the code thrown in `ProjectService.updateProjectPermissions`.
 */
export const PROJECT_USER_ALREADY_ON_PROJECT_CODE = 'ALREADY_ON_PROJECT';

/** What an admin reads when Add User is used for someone already on the project: why it failed, and where the role is changed. */
export const PROJECT_USER_ALREADY_ON_PROJECT_MESSAGE =
  'This person is already on the project. To change their role, use the Actions (⋮) menu on their row and choose Edit.';
