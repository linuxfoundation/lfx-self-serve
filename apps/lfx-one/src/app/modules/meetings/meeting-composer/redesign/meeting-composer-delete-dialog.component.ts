// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MeetingComposerDeleteDialogData } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

/** Confirms deleting a one-time meeting from the composer, then deletes it; closes with `true` once done. */
@Component({
  selector: 'lfx-meeting-composer-delete-dialog',
  imports: [UiModalComponent, UiButtonComponent],
  templateUrl: './meeting-composer-delete-dialog.component.html',
})
export class MeetingComposerDeleteDialogComponent {
  private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly data = inject<MeetingComposerDeleteDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** True while the request runs; the dialog cannot close meanwhile. */
  public readonly busy = signal(false);

  protected readonly title = this.data.meeting.title;
  protected readonly date = this.format({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  protected readonly time = this.format({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  protected readonly guests: string | null = this.guestLabel();

  protected keep(): void {
    this.dialogRef.close(false);
  }

  protected confirm(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.meetingService
      .deleteMeeting(this.data.meeting.id)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.dialogRef.close(true);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          const status = error instanceof HttpErrorResponse ? error.status : null;
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Delete Failed', description: this.describeFailure(status) });
        },
      });
  }

  private guestLabel(): string | null {
    const count = this.data.guestCount;
    if (count === null) return null;
    return `${count} ${count === 1 ? 'guest' : 'guests'}`;
  }

  private format(options: Intl.DateTimeFormatOptions): string {
    const start = new Date(this.data.meeting.start_time);
    return Number.isNaN(start.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-US', { ...options, timeZone: this.data.meeting.timezone || undefined }).format(start);
  }

  private describeFailure(status: number | null): string {
    if (status === 404) return 'Meeting not found. It may have already been deleted.';
    if (status === 403) return 'You do not have permission to delete this meeting.';
    if (status === 0) return 'Network error. Please check your connection and try again.';
    return 'Failed to delete meeting. Please try again.';
  }
}
