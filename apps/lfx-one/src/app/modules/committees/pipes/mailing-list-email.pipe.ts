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
  public transform(ml: GroupsIOMailingList): string {
    if (ml.service?.domain) {
      return `${ml.group_name}@${ml.service.domain}`;
    }
    return ml.group_name;
  }
}
