// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { HttpParams } from '@angular/common/http';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FileTypeIconPipe } from '@app/shared/pipes/file-type-icon.pipe';
import { ButtonComponent } from '@components/button/button.component';
import { DEFAULT_MEETING_TYPE_CONFIG, Meeting, MeetingAttachment, MeetingOccurrence, MeetingTypeBadge, MEETING_TYPE_CONFIGS, User } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-dashboard-meeting-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, TooltipModule, ClipboardModule, FileTypeIconPipe],
  templateUrl: './dashboard-meeting-card.component.html',
})
export class DashboardMeetingCardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  public readonly meeting = input.required<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);

  public readonly attachments: Signal<MeetingAttachment[]>;
  public readonly joinUrl: Signal<string | null>;

  // Computed values
  public readonly meetingTypeInfo: Signal<MeetingTypeBadge> = computed(() => {
    const type = this.meeting().meeting_type?.toLowerCase();
    const config = type ? (MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG) : DEFAULT_MEETING_TYPE_CONFIG;

    return {
      label: config.label,
      className: `${config.bgColor} ${config.textColor}`,
    };
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

  public readonly borderColorClass: Signal<string> = computed(() => {
    const type = this.meeting().meeting_type?.toLowerCase();
    const config = type ? (MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG) : DEFAULT_MEETING_TYPE_CONFIG;
    return config.borderColor;
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

    // Convert user signal to observable and create reactive join URL stream
    const user$ = toObservable(this.userService.user);
    const authenticated$ = toObservable(this.userService.authenticated);

    const joinUrl$ = combineLatest([meeting$, user$, authenticated$]).pipe(
      switchMap(([meeting, user, authenticated]) => {
        // Only fetch join URL for today's meetings with authenticated users
        if (meeting.uid && authenticated && user?.email && this.isTodayMeeting()) {
          return this.meetingService.getPublicMeetingJoinUrl(meeting.uid, meeting.password, { email: user.email }).pipe(
            map((res) => this.buildJoinUrlWithParams(res.join_url, user)),
            catchError(() => of(null))
          );
        }
        return of(null);
      })
    );

    this.joinUrl = toSignal(joinUrl$, { initialValue: null });
  }

  /**
   * Build join URL with user parameters (matches meeting-join component logic)
   * @param joinUrl - Base join URL from API
   * @param user - Authenticated user
   * @returns Join URL with encoded user parameters
   */
  private buildJoinUrlWithParams(joinUrl: string, user: User): string {
    const displayName = user.name || user.email;
    const encodedName = btoa(unescape(encodeURIComponent(displayName)));

    const queryParams = new HttpParams().set('uname', displayName).set('un', encodedName);

    const separator = joinUrl.includes('?') ? '&' : '?';
    return `${joinUrl}${separator}${queryParams.toString()}`;
  }
}
