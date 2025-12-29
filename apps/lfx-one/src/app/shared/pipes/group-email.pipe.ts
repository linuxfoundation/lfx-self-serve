// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';

/**
 * Transforms mailing list data to email address format
 * @description Combines group_name with service domain to create email address
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
    if (!mailingList?.group_name) {
      return '';
    }

    const service = mailingList.service;
    if (!service?.domain) {
      return mailingList.group_name;
    }

    // For groups.io domain, extract list name from URL if available
    if (service.domain === 'groups.io' && service.url) {
      const listName = service.url.split('/').pop() || mailingList.group_name;
      return `${listName}@groups.io`;
    }

    // For other services, combine group_name with service domain
    return `${mailingList.group_name}@${service.domain}`;
  }
}
