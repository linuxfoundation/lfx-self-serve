// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  ComponentSeverity,
  DEFAULT_MEETING_TYPE_CONFIG,
  Meeting,
  MEETING_TYPE_CONFIGS,
  MeetingAttachment,
  MeetingOccurrence,
  MeetingTypeBadge,
} from '@lfx-one/shared';
import { FileTypeIconPipe } from '@pipes/file-type-icon.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-dashboard-meeting-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, TagComponent, TooltipModule, ClipboardModule, FileTypeIconPipe],
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

    // Map text color to severity
    let severity: ComponentSeverity = 'secondary';
    if (config.textColor.includes('red')) severity = 'danger';
    else if (config.textColor.includes('blue')) severity = 'info';
    else if (config.textColor.includes('green')) severity = 'success';
    else if (config.textColor.includes('purple')) severity = 'primary';
    else if (config.textColor.includes('amber')) severity = 'warn';

    return {
      label: config.label,
      className: `${config.bgColor} ${config.textColor}`,
      severity,
      icon: `${config.icon} mr-2`,
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

  // TODO(v1-migration): Simplify to use V2 fields only once all meetings are migrated to V2
  public readonly hasAiSummary: Signal<boolean> = computed(() => {
    const meeting = this.meeting();
    // V2: zoom_config.ai_companion_enabled, V1: zoom_ai_enabled
    return meeting.zoom_config?.ai_companion_enabled === true || meeting.zoom_ai_enabled === true;
  });

  // TODO(v1-migration): Simplify to use V2 fields only once all meetings are migrated to V2
  public readonly meetingTitle: Signal<string> = computed(() => {
    const occurrence = this.occurrence();
    const meeting = this.meeting();

    // Priority: occurrence title > meeting title > meeting topic (v1)
    return occurrence?.title || meeting.title || meeting.topic || '';
  });

  public readonly canJoinMeeting: Signal<boolean> = computed(() => {
    return canJoinMeeting(this.meeting(), this.occurrence());
  });

  // TODO(v1-migration): Remove once all meetings are migrated to V2
  public readonly isLegacyMeeting: Signal<boolean> = computed(() => {
    return this.meeting().version === 'v1';
  });

  // TODO(v1-migration): Simplify to use V2 uid only once all meetings are migrated to V2
  public readonly meetingDetailRouterLink: Signal<string[]> = computed(() => {
    const meeting = this.meeting();
    const identifier = this.isLegacyMeeting() && meeting.id ? meeting.id : meeting.uid;
    return ['/meetings', identifier];
  });

  // TODO(v1-migration): Remove V1 parameter handling once all meetings are migrated to V2
  public readonly meetingDetailQueryParams: Signal<Record<string, string>> = computed(() => {
    const meeting = this.meeting();
    const params: Record<string, string> = {};

    if (meeting.password) {
      params['password'] = meeting.password;
    }
    if (this.isLegacyMeeting()) {
      params['v1'] = 'true';
    }

    return params;
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

    // TODO(v1-migration): Remove V1 join URL handling once all meetings are migrated to V2
    // Convert user signal to observable and create reactive join URL stream
    const user$ = toObservable(this.userService.user);
    const authenticated$ = toObservable(this.userService.authenticated);
    const isLegacyMeeting$ = toObservable(this.isLegacyMeeting);

    const joinUrl$ = combineLatest([meeting$, user$, authenticated$, isLegacyMeeting$]).pipe(
      switchMap(([meeting, user, authenticated, isLegacy]) => {
        // For v1 meetings, use the join_url directly from the meeting object
        if (isLegacy && meeting.join_url && this.canJoinMeeting()) {
          return of(meeting.join_url);
        }

        // For v2 meetings, fetch join URL from API for authenticated users
        if (meeting.uid && authenticated && user?.email && this.canJoinMeeting()) {
          return this.meetingService.getPublicMeetingJoinUrl(meeting.uid, meeting.password, { email: user.email }).pipe(
            map((res) => buildJoinUrlWithParams(res.join_url, user)),
            catchError(() => of(null))
          );
        }
        return of(null);
      })
    );

    this.joinUrl = toSignal(joinUrl$, { initialValue: null });
  }
}
