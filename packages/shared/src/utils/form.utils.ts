// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormGroup } from '@angular/forms';

/**
 * Generates a temporary ID for entities that need unique identifiers before API assignment
 */
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Marks all form controls as touched to trigger validation display
 */
export function markFormControlsAsTouched(form: FormGroup, onlySelf: boolean = false, emitEvent: boolean = false): void {
  form.markAllAsTouched();
  form.updateValueAndValidity({ onlySelf, emitEvent });
}

/**
 * Update value and validity of all form controls
 */
export function updateFormControls(form: FormGroup, onlySelf: boolean = false, emitEvent: boolean = false): void {
  Object.keys(form.controls).forEach((key) => {
    const control = form.get(key);
    control?.updateValueAndValidity({ onlySelf, emitEvent });
  });
}
