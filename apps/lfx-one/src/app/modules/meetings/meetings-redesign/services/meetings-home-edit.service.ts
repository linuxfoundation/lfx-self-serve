// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import {
  Meeting,
  MeetingComposerSectionId,
  MeetingEditScopeDialogData,
  MeetingHomeRow,
  MeetingOccurrence,
  RecurringMeetingEditScopeResult,
} from '@lfx-one/shared/interfaces';
import { getActiveOccurrences, getCurrentOrNextOccurrence, isSameOccurrenceId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize, NEVER, take, takeUntil } from 'rxjs';

import { MeetingEditScopeModalComponent } from '../components/meeting-edit-scope-modal/meeting-edit-scope-modal.component';

/**
 * Edit Meeting on the meetings home page, following the legacy meeting card's flow.
 * @description Re-reads the meeting first, since the feed's `organizer` may be stale, then asks a recurring meeting's
 * scope and opens the composer on the series or on one date. Provided by the page, so leaving it drops a pending check.
 */
@Injectable()
export class MeetingsHomeEditService {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly composer = inject(MeetingComposerService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly checkingIds = signal<ReadonlySet<string>>(new Set());

  /** True while the permission re-check for this meeting runs. */
  public isChecking(meetingId: string): boolean {
    return this.checkingIds().has(meetingId);
  }

  /** `section` is where the composer lands. `drawer` stays open until the editor opens. */
  public edit(row: MeetingHomeRow, section?: MeetingComposerSectionId, drawer?: DialogRef | null, seriesOnly = false): void {
    const meeting = row.meeting;
    if (this.isChecking(meeting.id)) return;

    this.setChecking(meeting.id, true);
    this.meetingService
      .getMeetingDetail(meeting.id, { skipCache: true })
      .pipe(
        take(1),
        // Closing the drawer during the check drops the edit.
        takeUntil(drawer?.closed ?? NEVER),
        finalize(() => this.setChecking(meeting.id, false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (fresh) => this.openEditor(row, fresh, section, drawer, seriesOnly),
        error: (error: unknown) => this.reportCheckFailure(error),
      });
  }

  private openEditor(row: MeetingHomeRow, fresh: Meeting, section?: MeetingComposerSectionId, drawer?: DialogRef | null, seriesOnly = false): void {
    if (fresh.organizer !== true) {
      this.showError('Editing unavailable', 'You no longer have permission to edit this meeting.');
      return;
    }

    // The row's date decides which one is meant; a fallback to the next one would retarget the edit once it is gone.
    const shownGone = !!row.occurrenceId && !this.findOccurrence(fresh, row.occurrenceId);
    if (fresh.recurrence && shownGone) {
      this.toast.show({
        variant: 'warning',
        position: 'bottom-center',
        message: 'Occurrence changed',
        description: 'This occurrence was moved or cancelled. The list has been refreshed.',
      });
      this.userService.refreshUserMeetings();
      return;
    }

    // The fresh read wins; the row fills what it leaves out, such as a project lookup that failed.
    const meeting: Meeting = { ...row.meeting, ...fresh };
    // Series-only edits, such as materials, skip the scope question since an occurrence edit hides them.
    const occurrence = fresh.recurrence && !seriesOnly ? this.resolveOccurrence(row, fresh) : null;
    if (!occurrence) {
      this.leave(drawer, () => this.openSeriesEditor(meeting, section));
      return;
    }

    const data: MeetingEditScopeDialogData = { row, meeting: fresh, occurrence, origin: drawer ? 'drawer' : 'page' };
    this.modal
      .open<RecurringMeetingEditScopeResult, MeetingEditScopeDialogData>(MeetingEditScopeModalComponent, { data })
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result?.proceed) return;
        if (result.scope === 'series') {
          this.leave(drawer, () => this.openSeriesEditor(meeting, section));
          return;
        }
        const picked = (result.occurrenceId ? this.findOccurrence(fresh, result.occurrenceId) : null) ?? occurrence;
        this.leave(drawer, () => this.openOccurrenceEditor(meeting, picked, section));
      });
  }

  /** Closes the drawer without its close guard, then opens the editor once focus is handed back to the page. */
  private leave(drawer: DialogRef | null | undefined, open: () => void): void {
    if (!drawer) {
      open();
      return;
    }
    drawer.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(open);
    drawer.close();
  }

  private openSeriesEditor(meeting: Meeting, section?: MeetingComposerSectionId): void {
    this.composer.open({ mode: 'edit', meetingUid: meeting.id, projectUid: meeting.project_uid, section });
  }

  private openOccurrenceEditor(meeting: Meeting, occurrence: MeetingOccurrence, section?: MeetingComposerSectionId): void {
    this.composer.open({ mode: 'edit', meetingUid: meeting.id, projectUid: meeting.project_uid, occurrenceId: occurrence.occurrence_id, section });
  }

  /** The row's date in the fresh read, or the next date for a row without one. */
  private resolveOccurrence(row: MeetingHomeRow, fresh: Meeting): MeetingOccurrence | null {
    return row.occurrenceId ? this.findOccurrence(fresh, row.occurrenceId) : getCurrentOrNextOccurrence(fresh);
  }

  private findOccurrence(meeting: Meeting, occurrenceId: string): MeetingOccurrence | null {
    return (
      getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences).find((candidate) =>
        isSameOccurrenceId(candidate.occurrence_id, occurrenceId)
      ) ?? null
    );
  }

  /** A 403 or 404 is permanent, so only other failures invite a retry. */
  private reportCheckFailure(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status === 403) {
      this.showError('Editing unavailable', 'You no longer have permission to edit this meeting.');
      return;
    }
    if (status === 404) {
      this.showError('Editing unavailable', 'This meeting no longer exists.');
      return;
    }
    this.showError('Could not open the editor', 'We could not check your access to this meeting. Please try again.');
  }

  private setChecking(meetingId: string, checking: boolean): void {
    this.checkingIds.update((ids) => {
      const next = new Set(ids);
      if (checking) next.add(meetingId);
      else next.delete(meetingId);
      return next;
    });
  }

  private showError(message: string, description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message, description });
  }
}
