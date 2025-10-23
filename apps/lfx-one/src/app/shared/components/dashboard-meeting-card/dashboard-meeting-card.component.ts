// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FileTypeIconPipe } from '@app/shared/pipes/file-type-icon.pipe';
import { ButtonComponent } from '@components/button/button.component';
import { Meeting, MeetingAttachment, MeetingOccurrence } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, of, switchMap } from 'rxjs';

interface MeetingTypeBadge {
  label: string;
  className: string;
}

@Component({
  selector: 'lfx-dashboard-meeting-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, TooltipModule, ClipboardModule, FileTypeIconPipe],
  templateUrl: './dashboard-meeting-card.component.html',
})
export class DashboardMeetingCardComponent {
  private readonly meetingService = inject(MeetingService);

  public readonly meeting = input.required<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  public readonly onSeeMeeting = output<string>();

  public readonly attachments: Signal<MeetingAttachment[]>;

  // Computed values
  public readonly meetingTypeInfo: Signal<MeetingTypeBadge> = computed(() => {
    const type = this.meeting().meeting_type?.toLowerCase();

    switch (type) {
      case 'technical':
        return { label: 'Technical', className: 'bg-purple-100 text-purple-600' };
      case 'maintainers':
        return { label: 'Maintainers', className: 'bg-blue-100 text-blue-600' };
      case 'board':
        return { label: 'Board', className: 'bg-red-100 text-red-600' };
      case 'marketing':
        return { label: 'Marketing', className: 'bg-green-100 text-green-600' };
      case 'legal':
        return { label: 'Legal', className: 'bg-amber-100 text-amber-600' };
      case 'other':
        return { label: 'Other', className: 'bg-gray-100 text-gray-600' };
      default:
        return { label: 'Meeting', className: 'bg-gray-100 text-gray-400' };
    }
  });

  public readonly meetingStartTime: Signal<string> = computed(() => {
    const occurrence = this.occurrence();
    const meeting = this.meeting();

    // Use occurrence start time if available, otherwise use meeting start time
    return occurrence?.start_time || meeting.start_time;
  });

  public readonly formattedTime: Signal<string> = computed(() => {
    const startTime = this.meetingStartTime();

    try {
      const meetingDate = new Date(startTime);

      if (isNaN(meetingDate.getTime())) {
        return startTime;
      }

      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const isToday = meetingDate.toDateString() === today.toDateString();
      const isTomorrow = meetingDate.toDateString() === tomorrow.toDateString();

      const timeStr = meetingDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      if (isToday) {
        return `Today, ${timeStr}`;
      } else if (isTomorrow) {
        return `Tomorrow, ${timeStr}`;
      }
      const dateStr = meetingDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return `${dateStr} at ${timeStr}`;
    } catch {
      return startTime;
    }
  });

  public readonly isTodayMeeting: Signal<boolean> = computed(() => {
    const startTime = this.meetingStartTime();

    try {
      const meetingDate = new Date(startTime);

      if (isNaN(meetingDate.getTime())) {
        return false;
      }

      const today = new Date();
      return meetingDate.toDateString() === today.toDateString();
    } catch {
      return false;
    }
  });

  public readonly isPrivate: Signal<boolean> = computed(() => {
    return this.meeting().visibility === 'private';
  });

  public readonly hasYoutubeUploads: Signal<boolean> = computed(() => {
    return this.meeting().youtube_upload_enabled === true;
  });

  public readonly hasRecording: Signal<boolean> = computed(() => {
    return this.meeting().recording_enabled === true;
  });

  public readonly hasTranscripts: Signal<boolean> = computed(() => {
    return this.meeting().transcript_enabled === true;
  });

  public readonly hasAiSummary: Signal<boolean> = computed(() => {
    return this.meeting().zoom_config?.ai_companion_enabled === true;
  });

  public readonly meetingTitle: Signal<string> = computed(() => {
    const occurrence = this.occurrence();
    const meeting = this.meeting();

    // Use occurrence title if available, otherwise use meeting title
    return occurrence?.title || meeting.title;
  });

  public constructor() {
    // Convert meeting input signal to observable and create reactive attachment stream
    const meeting$ = toObservable(this.meeting);
    const attachments$ = meeting$.pipe(
      switchMap((meeting) => {
        if (meeting.uid) {
          return this.meetingService.getMeetingAttachments(meeting.uid).pipe(catchError(() => of([])));
        }
        return of([]);
      })
    );

    this.attachments = toSignal(attachments$, { initialValue: [] });
  }

  public handleSeeMeeting(): void {
    this.onSeeMeeting.emit(this.meeting().uid);
  }
}
