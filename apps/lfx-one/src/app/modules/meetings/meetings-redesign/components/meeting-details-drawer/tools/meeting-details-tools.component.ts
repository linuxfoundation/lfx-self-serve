// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { environment } from '@environments/environment';
import { PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getMeetingShareUrl, isPastMeetingSummaryAwaitingApproval } from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiSplitButtonComponent } from '@shared/uikit/split-button/split-button.component';

import { MeetingsHomeDialogsService } from '../../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsArtifactsService } from './meeting-details-artifacts.service';

/**
 * Right column of the meeting details drawer under the schedule: the ended date's recording, AI summary and transcript,
 * or the private-meeting notice.
 * @description Follows the legacy meeting page's gates and copy.
 */
@Component({
  selector: 'lfx-meeting-details-tools',
  imports: [UiBadgeComponent, UiButtonComponent, UiNoteComponent, UiSkeletonComponent, UiSplitButtonComponent],
  templateUrl: './meeting-details-tools.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[12px] empty:hidden' },
})
export class MeetingDetailsToolsComponent {
  private readonly dialogs = inject(MeetingsHomeDialogsService);
  private readonly store = inject(MeetingsHomeStore);
  private readonly document = inject(DOCUMENT);
  protected readonly context = inject(MeetingDetailsContext);
  protected readonly artifactsService = inject(MeetingDetailsArtifactsService);

  protected readonly ended: Signal<boolean> = computed(() => this.context.state() === 'ended');
  protected readonly summaryAwaitingApproval: Signal<boolean> = computed(() => isPastMeetingSummaryAwaitingApproval(this.artifactsService.summary()));

  protected openRecording(url: string): void {
    this.dialogs.openRecording(url);
  }

  protected copyRecordingLink(url: string): void {
    this.dialogs.copyRecordingLink(url);
  }

  protected openSummary(summary: PastMeetingSummary): void {
    const pastMeetingId = this.context.pastMeetingId();
    if (!pastMeetingId) return;
    // The dialog writes edits back to the past meeting the row key names.
    const row = { ...this.context.shownRow(), key: pastMeetingId, meeting: this.context.meeting() };
    const onChange = (change: PastMeetingSummary): void => {
      this.artifactsService.summary.set(change);
      // The home list behind the drawer shows the same summary.
      this.store.applySummaryChange(pastMeetingId, change);
    };
    this.dialogs.openSummary(row, summary, onChange, { origin: 'drawer', showPending: true });
  }

  /** The transcript is read on the past meeting page. */
  protected openTranscript(): void {
    const pastMeetingId = this.context.pastMeetingId();
    const url = pastMeetingId ? getMeetingShareUrl(environment.urls.home, pastMeetingId) : null;
    if (url) this.document.defaultView?.open(url, '_blank', 'noopener,noreferrer');
  }
}
