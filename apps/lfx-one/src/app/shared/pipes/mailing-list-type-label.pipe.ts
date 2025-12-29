// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { MAILING_LIST_TYPE_LABELS } from '@lfx-one/shared/constants';
import { MailingListType } from '@lfx-one/shared/enums';

/**
 * Transforms mailing list type enum to human-readable label
 * @description Maps MailingListType values to display labels
 * @example
 * <!-- In template -->
 * {{ mailingList.type | mailingListTypeLabel }}
 */
@Pipe({
  name: 'mailingListTypeLabel',
})
export class MailingListTypeLabelPipe implements PipeTransform {
  public transform(type: MailingListType): string {
    return MAILING_LIST_TYPE_LABELS[type] || type;
  }
}
