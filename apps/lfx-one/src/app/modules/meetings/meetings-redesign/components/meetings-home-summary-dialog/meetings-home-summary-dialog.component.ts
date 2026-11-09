// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MeetingSummaryDialogData, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getPastMeetingSummaryContent, isPastMeetingSummaryAwaitingApproval, isPastMeetingSummaryReadOnly } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

import { MeetingDialogContextComponent } from '../meeting-dialog-context/meeting-dialog-context.component';

/** AI summary of a past meeting on the meetings home, as markdown; an organizer can also edit and approve it. */
@Component({
  selector: 'lfx-meetings-home-summary-dialog',
  imports: [MarkdownRendererComponent, MeetingDialogContextComponent, UiBadgeComponent, UiButtonComponent, UiModalComponent, UiTextareaComponent],
  templateUrl: './meetings-home-summary-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingsHomeSummaryDialogComponent {
  private readonly data = inject<MeetingSummaryDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly clipboard = inject(Clipboard);
  // showPending skips the approval gate, the helper's only organizer branch.
  private readonly reader = this.data.showPending ? { organizer: true } : this.data.row.meeting;

  protected readonly row = this.data.row;
  protected readonly origin = this.data.origin ?? 'page';
  protected readonly readOnly = isPastMeetingSummaryReadOnly(this.data.row.meeting, this.data.summary);
  protected readonly summary = signal<PastMeetingSummary>(this.data.summary);
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly approving = signal(false);
  /** A blank summary is not saved. */
  protected readonly canSave: Signal<boolean> = computed(() => this.draft().trim() !== '');
  protected readonly content: Signal<string> = computed(() => getPastMeetingSummaryContent(this.reader, this.summary()) ?? '');
  protected readonly awaitingReview: Signal<boolean> = computed(() => !this.readOnly && isPastMeetingSummaryAwaitingApproval(this.summary()));
  /** A reader shown a summary before an organizer approved it. */
  protected readonly pendingReview: Signal<boolean> = computed(
    () => this.readOnly && !!this.data.showPending && isPastMeetingSummaryAwaitingApproval(this.summary())
  );

  protected edit(): void {
    this.draft.set(this.content());
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected save(): void {
    if (!this.canSave()) return;
    const summary = this.summary();
    const editedContent = this.draft();
    this.saving.set(true);
    this.meetingService
      .updatePastMeetingSummary(this.data.row.key, summary.uid, { edited_content: editedContent })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
          this.apply({ ...summary, summary_data: { ...summary.summary_data, edited_content: editedContent } });
          this.toast.show({ variant: 'dark', message: 'Summary updated successfully' });
        },
        error: (error: unknown) => {
          console.error('Failed to update summary:', error);
          this.saving.set(false);
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to update summary' });
        },
      });
  }

  protected approve(): void {
    const summary = this.summary();
    this.approving.set(true);
    this.meetingService
      .approvePastMeetingSummary(this.data.row.key, summary.uid)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.approving.set(false);
          this.apply({ ...summary, approved: true });
          this.toast.show({ variant: 'dark', message: 'Summary approved successfully' });
        },
        error: (error: unknown) => {
          console.error('Failed to approve summary:', error);
          this.approving.set(false);
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to approve summary' });
        },
      });
  }

  /** Call it straight from the click: Safari only allows the copy during the user's gesture. */
  protected copy(): void {
    if (this.clipboard.copy(this.content())) {
      this.toast.show({ variant: 'success', message: 'Meeting summary copied to clipboard' });
    } else {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Failed to copy summary' });
    }
  }

  /** Reports each saved change straight away, so the opener is in step however the dialog is closed. */
  private apply(summary: PastMeetingSummary): void {
    this.summary.set(summary);
    this.data.onChange?.(summary);
  }
}
