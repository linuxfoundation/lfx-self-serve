// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterOption, ProjectPermissionUser } from '../interfaces';

/**
 * Project permission roles, shared by the user form and the permissions table role filter.
 * The value type is the `ProjectPermissionUser['role']` union, so adding a role also means widening
 * that union (and the request interfaces) and the table's Role column label.
 */
export const PROJECT_PERMISSION_ROLE_OPTIONS: readonly FilterOption<ProjectPermissionUser['role']>[] = [
  { label: 'View', value: 'view' },
  { label: 'Manage', value: 'manage' },
];
