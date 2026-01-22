// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { CommitteeReference } from '../interfaces/committee.interface';

/**
 * Validator that checks if a string value is non-empty after trimming whitespace.
 * Unlike Validators.required which passes for whitespace-only strings,
 * this validator ensures the value contains actual content.
 *
 * @returns ValidatorFn that returns { trimmedRequired: true } if invalid
 */
export function trimmedRequired(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    // Allow null/undefined to pass (use with Validators.required if needed)
    if (value === null || value === undefined) {
      return null;
    }

    // For strings, check trimmed length
    if (typeof value === 'string') {
      return value.trim().length > 0 ? null : { trimmedRequired: true };
    }

    // For non-strings, just check truthiness
    return value ? null : { trimmedRequired: true };
  };
}

/**
 * Validator that checks if a string value meets a minimum length after trimming whitespace.
 *
 * @param minLength - The minimum length the trimmed value must be
 * @returns ValidatorFn that returns { trimmedMinLength: { requiredLength, actualLength } } if invalid
 */
export function trimmedMinLength(minLength: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    // Allow null/undefined to pass (use with Validators.required if needed)
    if (value === null || value === undefined || value === '') {
      return null;
    }

    // For strings, check trimmed length
    if (typeof value === 'string') {
      const trimmedLength = value.trim().length;
      return trimmedLength >= minLength ? null : { trimmedMinLength: { requiredLength: minLength, actualLength: trimmedLength } };
    }

    return null;
  };
}

/**
 * Validator that checks if a CommitteeReference object is valid.
 * A valid CommitteeReference must have a 'uid' property that is a non-empty string.
 *
 * @returns ValidatorFn that returns { invalidCommittee: true } if invalid
 */
export function validCommitteeReference(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as CommitteeReference | null | undefined;

    // Allow null/undefined to pass (use with Validators.required if needed)
    if (value === null || value === undefined) {
      return null;
    }

    // Check if it's an object with a valid uid
    if (typeof value !== 'object') {
      return { invalidCommittee: true };
    }

    // Check for required uid property
    if (!value.uid || typeof value.uid !== 'string' || value.uid.trim().length === 0) {
      return { invalidCommittee: true };
    }

    return null;
  };
}
