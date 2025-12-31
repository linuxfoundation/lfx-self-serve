// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { TagSeverity } from '@lfx-one/shared';

/**
 * Transforms mailing list public flag to tag severity for consistent styling
 * @description Maps public boolean to appropriate tag colors (success for public, warn for private)
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="mailingList.public | mailingListVisibilitySeverity"></lfx-tag>
 */
@Pipe({
  name: 'mailingListVisibilitySeverity',
})
export class MailingListVisibilitySeverityPipe implements PipeTransform {
  public transform(isPublic: boolean): TagSeverity {
    return isPublic ? 'success' : 'warn';
  }
}
