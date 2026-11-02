// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MeetingSummaryDialogData, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getPastMeetingSummaryContent, isPastMeetingSummaryReadOnly } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

/**
 * AI summary of a past meeting on the meetings home, rendered as markdown.
 * @description An organizer can edit the text and approve it, as in the legacy summary dialog; everyone else reads it.
 */
@Component({
  selector: 'lfx-meetings-home-summary-dialog',
  imports: [MarkdownRendererComponent, UiBadgeComponent, UiButtonComponent, UiModalComponent, UiTextareaComponent],
  templateUrl: './meetings-home-summary-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingsHomeSummaryDialogComponent {
  private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
  private readonly data = inject<MeetingSummaryDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);

  protected readonly title = this.data.row.title;
  protected readonly readOnly = isPastMeetingSummaryReadOnly(this.data.row.meeting, this.data.summary);
  protected readonly summary = signal<PastMeetingSummary>(this.data.summary);
  protected readonly content: Signal<string> = computed(() => getPastMeetingSummaryContent(this.data.row.meeting, this.summary()) ?? '');
  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);
  protected readonly approving = signal(false);

  protected edit(): void {
    this.draft.set(this.content());
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected save(): void {
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
        error: () => {
          this.saving.set(false);
          this.toast.show({ variant: 'dark', message: 'Failed to update summary', duration: 5000 });
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
        error: () => {
          this.approving.set(false);
          this.toast.show({ variant: 'dark', message: 'Failed to approve summary', duration: 5000 });
        },
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /** Reports each saved change straight away, so the opener is in step however the dialog is closed. */
  private apply(summary: PastMeetingSummary): void {
    this.summary.set(summary);
    this.data.onChange?.(summary);
  }
}
