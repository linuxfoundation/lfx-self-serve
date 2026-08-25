// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { MEMBER_FORM_VOTING_STATUSES } from '../constants/committees.constants';

/**
 * Validator that rejects voting statuses outside the member form's accepted set.
 * Legacy members may carry `None` — a value the committee service rejects on
 * voting-enabled committees (LFXV2-2075) — so an untouched legacy value must fail
 * validation and force the user to pick an accepted status before saving.
 *
 * @returns ValidatorFn that returns { legacyVotingStatus: { value } } if invalid
 */
export function acceptedMemberVotingStatus(): ValidatorFn {
  const accepted = new Set(MEMBER_FORM_VOTING_STATUSES.map(({ value }) => value));
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    // Allow empty values to pass (pair with Validators.required when the field is mandatory)
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return accepted.has(value) ? null : { legacyVotingStatus: { value } };
  };
}
