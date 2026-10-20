// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ServiceValidationError } from '../errors';

/**
 * Validates the role / meetingCoordinator pair on the project-permissions POST/PUT routes.
 * `role` must be view, manage or none, `meetingCoordinator` must be a boolean when present, and
 * 'none' is only meaningful for a meeting coordinator (otherwise the user would hold no grant at
 * all — that is a removal, which has its own route). Returns the error rather than throwing so
 * the controller can hand it to `next()` like its other field checks.
 */
export function validateProjectPermissionRole(role: unknown, meetingCoordinator: unknown, operation: string, path: string): ServiceValidationError | null {
  if (typeof role !== 'string' || !['view', 'manage', 'none'].includes(role)) {
    return ServiceValidationError.forField('role', 'Role must be "view", "manage" or "none"', { operation, service: 'project_controller', path });
  }

  if (meetingCoordinator !== undefined && typeof meetingCoordinator !== 'boolean') {
    return ServiceValidationError.forField('meetingCoordinator', 'meetingCoordinator must be a boolean', { operation, service: 'project_controller', path });
  }

  if (role === 'none' && meetingCoordinator !== true) {
    return ServiceValidationError.forField('role', 'Role "none" requires meetingCoordinator to be true', { operation, service: 'project_controller', path });
  }

  return null;
}
