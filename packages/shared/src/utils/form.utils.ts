// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, FormArray, FormGroup } from '@angular/forms';

import { isShowMeetingAttendeesLocked } from './meeting-attendee-lock.utils';

/**
 * Generates a temporary ID for entities that need unique identifiers before API assignment
 */
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Recursively marks all form controls as dirty.
 * Handles nested FormGroups and FormArrays.
 */
function markAllAsDirtyRecursive(control: AbstractControl): void {
  control.markAsDirty();

  if (control instanceof FormGroup) {
    Object.values(control.controls).forEach((c) => markAllAsDirtyRecursive(c));
  } else if (control instanceof FormArray) {
    control.controls.forEach((c) => markAllAsDirtyRecursive(c));
  }
}

/**
 * Marks all form controls as touched and dirty to trigger validation display.
 * Recursively handles nested FormGroups and FormArrays.
 *
 * @param form - The FormGroup to mark
 * @param onlySelf - Whether to only update the form itself (not ancestors)
 * @param emitEvent - Whether to emit value/status change events
 * @param markDirty - Whether to also mark controls as dirty (default: true)
 */
export function markFormControlsAsTouched(form: FormGroup, onlySelf: boolean = false, emitEvent: boolean = false, markDirty: boolean = true): void {
  form.markAllAsTouched();

  if (markDirty) {
    markAllAsDirtyRecursive(form);
  }

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

/**
 * Marks a meeting form's controls touched and dirty so a failed submit shows its validation errors.
 * @description Skips `show_meeting_attendees`, which carries no validators: marking it displays
 * nothing, and instead corrupts the only thing that reads its `dirty` flag. To the attendee picker
 * that flag means "the organizer edited this since the form was last hydrated", and the picker
 * seeds their standing choice from it on every mount. A bulk mark turns one failed save into a
 * silent opt-out that outranks every group default — permanently in create mode, which never
 * hydrates and so never clears the flag.
 *
 * Shared by the composer and both manage submit paths so the exclusion cannot drift between them.
 */
export function markMeetingFormForValidation(form: FormGroup): void {
  Object.keys(form.controls).forEach((key) => {
    if (key === 'show_meeting_attendees') {
      return;
    }
    const control = form.get(key);
    control?.markAsTouched();
    control?.markAsDirty();
  });
}

/**
 * Locks attendee visibility off for board and restricted meetings.
 * @description Forces `show_meeting_attendees` to false and disables the control when
 * {@link isShowMeetingAttendeesLocked} is true; re-enables it otherwise. Composer and manage
 * share this helper so the two surfaces cannot drift.
 *
 * This wrapper needs a `FormGroup`, so it stays here with the rest of the Angular-Forms
 * helpers. The lock predicate it calls lives in `meeting-attendee-lock.utils.ts`, which is
 * free of Angular imports so the server — and its tests — can load the real rule directly
 * rather than through this barrel.
 */
export function syncShowMeetingAttendeesLock(form: FormGroup): void {
  const control = form.get('show_meeting_attendees');
  if (!control) {
    return;
  }

  if (isShowMeetingAttendeesLocked(form.get('meeting_type')?.value, form.get('restricted')?.value)) {
    if (control.value !== false) {
      control.setValue(false, { emitEvent: false });
    }
    if (control.enabled) {
      control.disable({ emitEvent: false });
    }
    return;
  }

  if (control.disabled) {
    control.enable({ emitEvent: false });
  }
}
