// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MeetingDeleteDialogData, MeetingDeleteTypeResult, MeetingHomeRow, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { getActiveOccurrences, getCurrentOrNextOccurrence, getMeetingSeriesUid, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

import { MeetingDeleteModalComponent } from '../components/meeting-delete-modal/meeting-delete-modal.component';
import { MeetingDeleteScopeModalComponent } from '../components/meeting-delete-scope-modal/meeting-delete-scope-modal.component';
import { MeetingsHomeStore } from './meetings-home.store';

/**
 * Delete Meeting on the meetings home page, following the legacy meeting card's flow.
 * @description A recurring meeting first asks whether to cancel one date or delete the series; the confirmation runs the
 * request, then the rows go from the list at once and the feeds reload. Provided by the page, next to the store it updates.
 */
@Injectable()
export class MeetingsHomeDeleteService {
  private readonly store = inject(MeetingsHomeStore);
  private readonly userService = inject(UserService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  public delete(row: MeetingHomeRow): void {
    if (!row.meeting.recurrence) {
      this.confirm(row, null);
      return;
    }

    const opening = row.occurrence ?? getCurrentOrNextOccurrence(row.meeting);
    this.modal
      .open<MeetingDeleteTypeResult, MeetingDeleteDialogData>(MeetingDeleteScopeModalComponent, { data: { row, occurrence: opening } })
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) return;
        if (result.deleteType === 'series') {
          this.confirm(row, null);
          return;
        }
        const occurrence = (result.occurrenceId ? this.findOccurrence(row, result.occurrenceId) : null) ?? opening;
        if (!occurrence) {
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Error', description: 'No upcoming occurrence found to cancel.' });
          return;
        }
        this.confirm(row, occurrence);
      });
  }

  private confirm(row: MeetingHomeRow, occurrence: MeetingOccurrence | null): void {
    this.modal
      .open<boolean, MeetingDeleteDialogData, MeetingDeleteModalComponent>(
        MeetingDeleteModalComponent,
        { data: { row, occurrence }, role: 'alertdialog', autoFocus: '[data-autofocus] button' },
        { closePredicate: (_result, _config, dialog) => !(dialog instanceof MeetingDeleteModalComponent && dialog.busy()) }
      )
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((done) => {
        if (!done) return;
        const meetingId = getMeetingSeriesUid(row.meeting);
        if (occurrence) {
          this.store.removeOccurrence(meetingId, occurrence.occurrence_id);
          this.toast.show({
            variant: 'dark',
            message: 'Occurrence cancelled',
            description: 'This occurrence was cancelled. The rest of the series is unchanged.',
          });
        } else {
          this.store.removeMeeting(meetingId);
          this.toast.show({ variant: 'dark', message: 'Success', description: 'Meeting deleted successfully.' });
        }
        this.userService.refreshUserMeetings();
        this.userService.refreshUserPastMeetings();
      });
  }

  private findOccurrence(row: MeetingHomeRow, occurrenceId: string): MeetingOccurrence | null {
    return (
      getActiveOccurrences(row.meeting.occurrences ?? [], row.meeting.cancelled_occurrences).find((candidate) =>
        isSameOccurrenceId(candidate.occurrence_id, occurrenceId)
      ) ?? null
    );
  }
}
