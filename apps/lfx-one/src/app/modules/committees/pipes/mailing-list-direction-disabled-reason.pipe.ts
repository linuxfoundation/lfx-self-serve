// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { GroupsIOMailingList, MailingListDirectionConflict } from '@lfx-one/shared/interfaces';

/**
 * Tooltip text explaining why a mailing list's sync-direction control in
 * MailingListPickerDialogComponent is disabled, or why one of its options is (#5786), or '' when
 * neither applies. Matches the backend's asymmetric CheckSyncModeConflict rule: a sibling running
 * Mailing List → Committee locks this row out of both auto directions, while a sibling running
 * Committee → Mailing List only locks out Mailing List → Committee, leaving Committee → Mailing
 * List available (multiple such lists are allowed per committee). Pure so it only re-runs when one
 * of its reference inputs actually changes — see
 * docs/architecture/frontend/angular-patterns.md's pipes-over-methods guidance.
 */
@Pipe({
  name: 'mailingListDirectionDisabledReason',
  standalone: true,
  pure: true,
})
export class MailingListDirectionDisabledReasonPipe implements PipeTransform {
  public transform(
    ml: GroupsIOMailingList,
    selectedUids: Set<string>,
    conflict: MailingListDirectionConflict | undefined,
    mailingLists: GroupsIOMailingList[]
  ): string {
    if (ml.writer !== true) {
      return 'You need Manage access to this mailing list to change its sync direction.';
    }
    if (!selectedUids.has(ml.uid)) {
      return `Link this mailing list to the ${COMMITTEE_LABEL.singular.toLowerCase()} before setting a sync direction.`;
    }
    if (conflict?.mlToCUid) {
      const active = mailingLists.find((m) => m.uid === conflict.mlToCUid);
      return `${active?.title || active?.group_name || 'Another list'} already syncs Mailing List → ${COMMITTEE_LABEL.singular}. No other list can sync in either direction while that sync is active.`;
    }
    if (conflict?.cToMlUid) {
      const active = mailingLists.find((m) => m.uid === conflict.cToMlUid);
      return `${active?.title || active?.group_name || 'Another list'} already syncs ${COMMITTEE_LABEL.singular} → Mailing List. This list can still sync in the same direction, but Mailing List → ${COMMITTEE_LABEL.singular} is unavailable while that sync is active.`;
    }
    return '';
  }
}
