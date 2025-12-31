// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { MailingListType } from '../enums/mailing-list.enum';

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
