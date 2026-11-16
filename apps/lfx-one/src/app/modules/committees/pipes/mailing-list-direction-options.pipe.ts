// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { MailingListDirectionConflict } from '@lfx-one/shared/interfaces';

/**
 * Per-row sync-direction options for MailingListPickerDialogComponent (#5786), shaping the base
 * options array with per-option `disabled` flags from that row's MailingListDirectionConflict so
 * `lfx-select`'s `optionDisabled` can grey out just the blocked direction instead of the whole
 * control: Mailing List → Committee is blocked by either sibling type (mixed-direction conflict or
 * scarcity), while Committee → Mailing List is blocked only by a Mailing List → Committee sibling —
 * multiple Committee → Mailing List lists are allowed per committee. Pure so it only re-runs when
 * the conflict reference for this row actually changes.
 */
@Pipe({
  name: 'mailingListDirectionOptions',
  standalone: true,
  pure: true,
})
export class MailingListDirectionOptionsPipe implements PipeTransform {
  public transform(
    baseOptions: { label: string; value: MailingListSyncMode }[],
    conflict: MailingListDirectionConflict | undefined
  ): { label: string; value: MailingListSyncMode; disabled: boolean }[] {
    return baseOptions.map((option) => ({
      ...option,
      disabled: this.isOptionDisabled(option.value, conflict),
    }));
  }

  private isOptionDisabled(value: MailingListSyncMode, conflict: MailingListDirectionConflict | undefined): boolean {
    if (value === MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE) {
      return !!(conflict?.mlToCUid || conflict?.cToMlUid);
    }
    if (value === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST) {
      return !!conflict?.mlToCUid;
    }
    return false;
  }
}
