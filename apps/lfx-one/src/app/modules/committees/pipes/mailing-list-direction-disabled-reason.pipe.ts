// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';

/**
 * Tooltip text explaining why a mailing list's sync-direction control in
 * MailingListPickerDialogComponent is disabled (#4026), or '' when it isn't. Pure so it only
 * re-runs when one of its reference inputs actually changes (selectedUids is a new Set on every
 * toggle, activeAutoSyncUid a new value whenever the "only one auto direction" slot changes
 * owner) — see docs/architecture/frontend/angular-patterns.md's pipes-over-methods guidance.
 */
@Pipe({
  name: 'mailingListDirectionDisabledReason',
  standalone: true,
  pure: true,
})
export class MailingListDirectionDisabledReasonPipe implements PipeTransform {
  public transform(ml: GroupsIOMailingList, selectedUids: Set<string>, activeAutoSyncUid: string | null, mailingLists: GroupsIOMailingList[]): string {
    if (ml.writer !== true) {
      return 'You need Manage access to this mailing list to change its sync direction.';
    }
    if (!selectedUids.has(ml.uid)) {
      return 'Link this mailing list to the committee before setting a sync direction.';
    }
    if (activeAutoSyncUid && activeAutoSyncUid !== ml.uid) {
      const active = mailingLists.find((m) => m.uid === activeAutoSyncUid);
      return `Only one mailing list per ${COMMITTEE_LABEL.singular.toLowerCase()} can have automatic sync configured at a time. ${active?.title || active?.group_name || 'Another list'} already has a direction set.`;
    }
    return '';
  }
}
