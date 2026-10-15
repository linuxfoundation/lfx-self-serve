// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { isFoundationMessageAnswerSubstantive } from '../utils/foundation-message.utils';

/**
 * An answer on an agent's questions step has to BE one: not blank, not a
 * skip, not a TBD. The agent asks only the gaps it could not settle from the
 * sources and suggests what it can, so a placeholder here leaves the document
 * with the hole the question exists to close. Raises
 * `{ substantiveAnswer: true }`; emptiness is reported by the same error, so a
 * required rule is not needed alongside it.
 */
export function substantiveAnswerValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value : '';
    return isFoundationMessageAnswerSubstantive(value) ? null : { substantiveAnswer: true };
  };
}
