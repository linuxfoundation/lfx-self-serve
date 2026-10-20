// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectPermissionUser } from '../interfaces/permissions.interface';

/** Project permission roles, shared by the user form and the permissions table role filter. Add new roles here. */
export const PROJECT_PERMISSION_ROLE_OPTIONS: ReadonlyArray<{ label: string; value: ProjectPermissionUser['role'] }> = [
  { label: 'View', value: 'view' },
  { label: 'Manage', value: 'manage' },
];
