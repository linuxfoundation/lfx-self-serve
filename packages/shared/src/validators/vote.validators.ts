// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import type { CommitteeReference } from '../interfaces/committee.interface';
import { combineDateTime, wallTimeExistsInTimezone } from '../utils/date-time.utils';

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

/** Group validator: the vote close date/time must be in the future in the chosen timezone (same-day deadlines allowed). Mirrors futureDateTimeValidator with vote control names. */
export function voteDeadlineValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const formGroup = control as any; // FormGroup
    const closeDate = formGroup.get?.('close_date')?.value;
    const closeTime = formGroup.get?.('close_time')?.value;
    const timezone = formGroup.get?.('timezone')?.value;

    if (!closeDate || !closeTime || !timezone) {
      return null; // Don't validate if values are not set
    }

    const combinedDateTime = combineDateTime(closeDate, closeTime, timezone);
    if (!combinedDateTime) {
      return null; // Invalid time format
    }

    // A syntactically valid wall time can be nonexistent in the selected zone during the spring-forward
    // gap (e.g. Mar 8 2026 2:30 AM in America/New_York) — fromZonedTime normalizes it to a different
    // local time, so reject rather than store a deadline ~1h off the organizer's exact selection.
    if (!wallTimeExistsInTimezone(closeDate, closeTime, timezone)) {
      return { nonexistentWallTime: true };
    }

    // combinedDateTime is already the resolved UTC instant (fromZonedTime in combineDateTime), so
    // compare instants directly. Projecting both sides back to wall clocks accepts a past deadline
    // during the fall-back repeated hour: an ambiguous wall time resolves to its EARLIER occurrence,
    // which can be in the past while still reading later than the current wall clock (1:30 AM entered
    // at 1:10 AM EST on Nov 1 2026 resolves to 1:30 AM EDT — 40 minutes earlier).
    if (new Date(combinedDateTime).getTime() <= Date.now()) {
      return { futureDateTime: true };
    }

    return null;
  };
}
