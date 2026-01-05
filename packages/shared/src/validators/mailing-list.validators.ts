// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { MailingListType } from '../enums/mailing-list.enum';
import { stripHtml } from '../utils/html-utils';

/**
 * Validator to ensure announcement mailing lists have public visibility
 * Business rule: Announcement-type mailing lists must be publicly visible
 */
export function announcementVisibilityValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const formGroup = control as any; // FormGroup
    const type = formGroup.get?.('type')?.value;
    const isPublic = formGroup.get?.('public')?.value;

    if (type === MailingListType.ANNOUNCEMENT && isPublic === false) {
      return { announcementRequiresPublicVisibility: true };
    }

    return null;
  };
}

/**
 * Validator for minimum length of HTML content (strips tags before counting)
 * @param minLength - Minimum character count for plain text content
 */
export function htmlMinLengthValidator(minLength: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!value) return null; // Let required validator handle empty values

    const plainText = stripHtml(value);
    if (plainText.length < minLength) {
      return {
        minlength: {
          requiredLength: minLength,
          actualLength: plainText.length,
        },
      };
    }

    return null;
  };
}

/**
 * Validator for maximum length of HTML content (strips tags before counting)
 * @param maxLength - Maximum character count for plain text content
 */
export function htmlMaxLengthValidator(maxLength: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!value) return null;

    const plainText = stripHtml(value);
    if (plainText.length > maxLength) {
      return {
        maxlength: {
          requiredLength: maxLength,
          actualLength: plainText.length,
        },
      };
    }

    return null;
  };
}

/**
 * Validator for required HTML content (checks if plain text is not empty)
 */
export function htmlRequiredValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    const plainText = stripHtml(value);

    if (!plainText || plainText.length === 0) {
      return { required: true };
    }

    return null;
  };
}
