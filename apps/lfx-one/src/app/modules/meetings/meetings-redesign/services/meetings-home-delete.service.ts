// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MeetingDeleteDialogData, MeetingDeleteTypeResult, MeetingDialogOrigin, MeetingHomeRow, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { getActiveOccurrences, getCurrentOrNextOccurrence, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { map, Observable, take } from 'rxjs';

import { MeetingDeleteModalComponent } from '../components/meeting-delete-modal/meeting-delete-modal.component';
import { MeetingDeleteScopeModalComponent } from '../components/meeting-delete-scope-modal/meeting-delete-scope-modal.component';
import { MeetingsHomeStore } from './meetings-home.store';

/**
 * Delete Meeting on the meetings home page, following the legacy meeting card's flow.
 * @description A recurring meeting first asks whether to cancel one date or delete the series; the confirmation runs the
 * request, then the rows go from the list at once and the feeds reload. Provided by the page, next to the store it updates;
 * the standalone meeting page has no list, so there only the feeds reload.
 */
@Injectable()
export class MeetingsHomeDeleteService {
  private readonly store = inject(MeetingsHomeStore, { optional: true });
  private readonly userService = inject(UserService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly openDialogs = new Set<() => void>();

  public constructor() {
    // A dialog still running its request stays open (its close predicate) and reports when done.
    this.destroyRef.onDestroy(() => this.openDialogs.forEach((close) => close()));
  }

  public delete(row: MeetingHomeRow): void {
    if (!row.meeting.recurrence) {
      this.confirm(row, null);
      return;
    }

    const opening = row.occurrence ?? getCurrentOrNextOccurrence(row.meeting);
    this.track(this.modal.open<MeetingDeleteTypeResult, MeetingDeleteDialogData>(MeetingDeleteScopeModalComponent, { data: { row, occurrence: opening } }))
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) return;
        if (result.deleteType === 'series') {
          this.confirm(row, null);
          return;
        }
        // A picked date that no longer resolves is reported, never swapped for another one.
        const active = getActiveOccurrences(row.meeting.occurrences ?? [], row.meeting.cancelled_occurrences);
        const occurrence = result.occurrenceId ? (active.find((date) => isSameOccurrenceId(date.occurrence_id, result.occurrenceId)) ?? null) : opening;
        if (!occurrence) {
          this.showError('Error', 'No upcoming occurrence found to cancel.');
          return;
        }
        this.confirm(row, occurrence);
      });
  }

  /** Asks to cancel one date of a series, as the date picked in the scope dialog does; emits once whether it was cancelled. */
  public cancelOccurrence(row: MeetingHomeRow, occurrence: MeetingOccurrence, origin?: MeetingDialogOrigin): Observable<boolean> {
    return this.confirm(row, occurrence, origin);
  }

  private confirm(row: MeetingHomeRow, occurrence: MeetingOccurrence | null, origin?: MeetingDialogOrigin): Observable<boolean> {
    const ref = this.track(
      this.modal.open<boolean, MeetingDeleteDialogData, MeetingDeleteModalComponent>(
        MeetingDeleteModalComponent,
        { data: { row, occurrence, origin }, role: 'alertdialog', autoFocus: '[data-autofocus] button' },
        { closePredicate: (_result, _config, dialog) => !(dialog instanceof MeetingDeleteModalComponent && dialog.busy()) }
      )
    );
    // Not bound to the page: a request that finishes after it is left still confirms and reloads the feeds.
    ref.closed.pipe(take(1)).subscribe((done) => {
      if (!done) return;
      if (occurrence) {
        this.store?.removeOccurrence(row.meeting.id, occurrence.occurrence_id);
        this.toast.show({ variant: 'dark', message: 'Meeting occurrence cancelled' });
      } else {
        this.store?.removeMeeting(row.meeting.id);
        this.toast.show({ variant: 'dark', message: 'Meeting deleted' });
      }
      this.userService.refreshUserMeetings();
      this.userService.refreshUserPastMeetings();
    });
    return ref.closed.pipe(
      take(1),
      map((done) => !!done)
    );
  }

  private track<R, C>(ref: DialogRef<R, C>): DialogRef<R, C> {
    const close = (): void => ref.close();
    this.openDialogs.add(close);
    ref.closed.pipe(take(1)).subscribe(() => this.openDialogs.delete(close));
    return ref;
  }

  private showError(message: string, description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message, description });
  }
}
