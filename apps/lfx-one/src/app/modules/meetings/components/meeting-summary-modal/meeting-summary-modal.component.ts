// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { PastMeetingSummary } from '@lfx-one/shared';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-meeting-summary-modal',
  imports: [MarkdownRendererComponent],
  templateUrl: './meeting-summary-modal.component.html',
})
export class MeetingSummaryModalComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);

  public readonly summary: PastMeetingSummary = this.dialogConfig.data.summary;
  public readonly content: string = this.summary.summary_data?.edited_content || this.summary.summary_data?.content || '';
  public readonly approved: boolean = this.summary.approved || false;
}
