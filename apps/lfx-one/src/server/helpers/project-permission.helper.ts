// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ServiceValidationError } from '../errors';

/**
 * Validates the role on the project-permissions POST/PUT routes: it must be view, manage or
 * meeting_coordinator. Returns the error rather than throwing so the controller can hand it to
 * `next()` like its other field checks.
 */
export function validateProjectPermissionRole(role: unknown, operation: string, path: string): ServiceValidationError | null {
  if (typeof role !== 'string' || !['view', 'manage', 'meeting_coordinator'].includes(role)) {
    return ServiceValidationError.forField('role', 'Role must be "view", "manage" or "meeting_coordinator"', {
      operation,
      service: 'project_controller',
      path,
    });
  }

  return null;
}
