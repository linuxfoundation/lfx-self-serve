// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Cross-field validator for the project permission form. A user with the 'none' base role holds
 * no View/Manage access, so they are only meaningful as a meeting coordinator.
 *
 * @returns ValidatorFn for the form group that returns { roleRequiresCoordinator: true } if invalid
 */
export function roleRequiresCoordinatorValidator(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const role = group.get('role')?.value;
    const meetingCoordinator = group.get('meetingCoordinator')?.value;

    return role === 'none' && !meetingCoordinator ? { roleRequiresCoordinator: true } : null;
  };
}
