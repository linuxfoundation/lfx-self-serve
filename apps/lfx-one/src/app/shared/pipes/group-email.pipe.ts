// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { getMailingListEmail } from '@lfx-one/shared/utils';

/**
 * Transforms mailing list data to email address format
 * @description Combines group_name with the mailing list's indexed domain to create an email address
 * @example
 * <!-- In template -->
 * {{ mailingList | groupEmail }}
 * <!-- Output: "group-name@lists.linuxfoundation.org" -->
 */
@Pipe({
  name: 'groupEmail',
})
export class GroupEmailPipe implements PipeTransform {
  public transform(mailingList: GroupsIOMailingList): string {
    return getMailingListEmail(mailingList);
  }
}
