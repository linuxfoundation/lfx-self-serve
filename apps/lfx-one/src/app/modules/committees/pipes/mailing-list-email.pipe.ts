// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'mailingListEmail',
  standalone: true,
  pure: true,
})
export class MailingListEmailPipe implements PipeTransform {
  /**
   * Returns a fully-formed email address when the mailing-list service has a domain,
   * or an empty string when no domain is available. Callers must check for an empty
   * result before rendering a mailto: link to avoid producing invalid URIs.
   */
  public transform(ml: GroupsIOMailingList): string {
    if (ml.service?.domain) {
      return `${ml.group_name}@${ml.service.domain}`;
    }
    return '';
  }
}
