// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'mailingListType',
  standalone: true,
  pure: true,
})
export class MailingListTypePipe implements PipeTransform {
  public transform(type: string): string {
    switch (type) {
      case 'discussion_open':
        return 'Discussion Open';
      case 'announcement':
        return 'Announcement';
      case 'discussion_moderated':
        return 'Moderated';
      default:
        return type;
    }
  }
}
