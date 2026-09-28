// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { PROJECT_APPLICATION_FORMATION_LIST_MAX } from '../constants/project-application.constants';
import { EMAIL_REGEX } from '../constants/regex.constants';
import { parseEmailList } from '../utils/email.utils';
import { isHttpUrl, isLegalContactEmail } from '../utils/project-application.utils';

/**
 * http(s) URL for a project-application answer (#3037). Blank passes — pair with `Validators.required`
 * when the field is mandatory. `requireHost` mirrors formation-service's repository rule.
 */
export function projectApplicationUrlValidator(requireHost: boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value) {
      return null;
    }
    return isHttpUrl(value, requireHost) ? null : { httpUrl: true };
  };
}

/** Legal contact: formation-service's rule plus a plausible domain, so a typo is caught before submit. */
export function projectApplicationLegalEmailValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim().toLowerCase() : '';
    if (!value) {
      return null;
    }
    return isLegalContactEmail(value) && EMAIL_REGEX.test(value) ? null : { email: true };
  };
}

/** Free-text list of additional formation contacts: every entry must be an email, within the cap. */
export function projectApplicationEmailListValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const parsed = parseEmailList(typeof control.value === 'string' ? control.value : '');
    if (parsed.invalid.length > 0) {
      return { emailList: { invalid: parsed.invalid.length } };
    }
    if (parsed.valid.length > PROJECT_APPLICATION_FORMATION_LIST_MAX) {
      return { emailListMax: { max: PROJECT_APPLICATION_FORMATION_LIST_MAX } };
    }
    return null;
  };
}
