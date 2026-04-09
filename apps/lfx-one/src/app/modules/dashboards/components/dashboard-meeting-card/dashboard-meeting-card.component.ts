// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  DEFAULT_MEETING_TYPE_CONFIG,
  Meeting,
  MeetingAttachment,
  MEETING_TYPE_CONFIGS,
  MeetingOccurrence,
  MeetingTypeBadge,
  PastMeetingRecording,
  TagSeverity,
} from '@lfx-one/shared';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-dashboard-meeting-card',
  imports: [ButtonComponent, TagComponent, TooltipModule, ClipboardModule, RecurrenceSummaryPipe],
  templateUrl: './dashboard-meeting-card.component.html',
})
export class DashboardMeetingCardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  public readonly meeting = input.required<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  /** Optional override for the "See Meeting Details" URL. If not provided, defaults to /meetings/{meeting.id}. */
  public readonly detailUrl = input<string | null>(null);
  /** Set to false to hide the "See Meeting Details" button (e.g. for past meetings where the detail page is inaccessible). */
  public readonly showDetailsButton = input<boolean>(true);
  /** Set to false to open the details link in the same tab instead of a new tab. */
  public readonly openDetailsInNewTab = input<boolean>(true);

  public readonly attachments: Signal<MeetingAttachment[]> = this.initAttachments();
  public readonly joinUrl: Signal<string | null>;

  // Computed values
  public readonly meetingTypeInfo: Signal<MeetingTypeBadge> = this.initMeetingTypeInfo();
  public readonly meetingStartTime: Signal<string> = this.initMeetingStartTime();
  public readonly formattedTime: Signal<string> = this.initFormattedTime();
  public readonly isTodayMeeting: Signal<boolean> = this.initIsTodayMeeting();
  public readonly isPrivate: Signal<boolean> = this.initIsPrivate();
  public readonly hasYoutubeUploads: Signal<boolean> = this.initHasYoutubeUploads();
  public readonly hasShowAttendees: Signal<boolean> = this.initHasShowAttendees();
  public readonly hasRecording: Signal<boolean> = this.initHasRecording();
  public readonly hasTranscripts: Signal<boolean> = this.initHasTranscripts();
  public readonly canJoinMeeting: Signal<boolean> = this.initCanJoinMeeting();

  public readonly hasAiSummary: Signal<boolean> = this.initHasAiSummary();
  public readonly meetingTitle: Signal<string> = this.initMeetingTitle();
  public readonly isRecurring: Signal<boolean> = this.initIsRecurring();
  public readonly meetingDetailUrl: Signal<string> = this.initMeetingDetailUrl();
  public readonly meetingDetailQueryParams: Signal<Record<string, string>> = this.initMeetingDetailQueryParams();
  public readonly meetingDetailHref: Signal<string> = this.initMeetingDetailHref();
  public readonly recordingShareUrl: Signal<string | null> = this.initRecordingShareUrl();

  public constructor() {
    const meeting$ = toObservable(this.meeting);
    const user$ = toObservable(this.userService.user);
    const authenticated$ = toObservable(this.userService.authenticated);

    const joinUrl$ = combineLatest([meeting$, user$, authenticated$]).pipe(
      switchMap(([meeting, user, authenticated]) => {
        if (!meeting.id || !this.canJoinMeeting()) {
          return of(null);
        }

        // Use public_link directly if available (e.g. for legacy meetings with link from query service)
        if (meeting.public_link) {
          return of(meeting.public_link);
        }

        // Otherwise fetch join URL from API for authenticated users
        if (authenticated && user?.email) {
          return this.meetingService.getPublicMeetingJoinUrl(meeting.id, meeting.password, { email: user.email }).pipe(
            map((res) => buildJoinUrlWithParams(res.link, user)),
            catchError(() => of(null))
          );
        }
        return of(null);
      })
    );

    this.joinUrl = toSignal(joinUrl$, { initialValue: null });
  }

  public downloadAttachment(attachment: MeetingAttachment): void {
    const meetingId = this.meeting().id;
    this.meetingService
      .getMeetingAttachmentDownloadUrl(meetingId, attachment.uid)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const newWindow = window.open(res.download_url, '_blank', 'noopener,noreferrer');
          if (newWindow) {
            newWindow.opener = null;
          }
        },
        error: () =>
          this.messageService.add({
            severity: 'error',
            summary: 'Download Failed',
            detail: 'Unable to download the attachment. Please try again.',
          }),
      });
  }

  private initMeetingTypeInfo(): Signal<MeetingTypeBadge> {
    return computed(() => {
      const type = this.meeting().meeting_type?.toLowerCase();
      const config = type ? (MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG) : DEFAULT_MEETING_TYPE_CONFIG;

      return {
        label: config.label,
        className: `${config.bgColor} ${config.textColor}`,
        severity: 'secondary' as TagSeverity,
        styleClass: config.tagStyleClass,
        icon: `${config.icon} mr-2`,
      };
    });
  }

  private initMeetingStartTime(): Signal<string> {
    return computed(() => {
      const occurrence = this.occurrence();
      const meeting = this.meeting();

      // Use occurrence start time if available, otherwise use meeting start time
      return occurrence?.start_time || meeting.start_time;
    });
  }

  private initFormattedTime(): Signal<string> {
    return computed(() => {
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
  }

  private initIsTodayMeeting(): Signal<boolean> {
    return computed(() => {
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
  }

  private initIsPrivate(): Signal<boolean> {
    return computed(() => {
      return this.meeting().visibility === 'private';
    });
  }

  private initHasYoutubeUploads(): Signal<boolean> {
    return computed(() => {
      return this.meeting().youtube_upload_enabled === true;
    });
  }

  private initHasRecording(): Signal<boolean> {
    return computed(() => {
      return this.meeting().recording_enabled === true;
    });
  }

  private initHasTranscripts(): Signal<boolean> {
    return computed(() => {
      return this.meeting().transcript_enabled === true;
    });
  }

  private initHasShowAttendees(): Signal<boolean> {
    return computed(() => {
      return this.meeting().show_meeting_attendees === true;
    });
  }

  private initCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();

      // Restricted meetings require the user to be invited
      if (meeting.restricted && !meeting.invited) {
        return false;
      }

      return canJoinMeeting(meeting, this.occurrence());
    });
  }

  private initHasAiSummary(): Signal<boolean> {
    return computed(() => this.meeting().zoom_config?.ai_companion_enabled || false);
  }

  private initMeetingTitle(): Signal<string> {
    return computed(() => {
      const occurrence = this.occurrence();
      const meeting = this.meeting();
      return occurrence?.title || meeting.title || '';
    });
  }

  private initIsRecurring(): Signal<boolean> {
    return computed(() => !!this.meeting().recurrence);
  }

  private initMeetingDetailUrl(): Signal<string> {
    return computed(() => {
      const override = this.detailUrl();
      if (override) {
        return override;
      }
      return `/meetings/${this.meeting().id}`;
    });
  }

  private initMeetingDetailQueryParams(): Signal<Record<string, string>> {
    return computed((): Record<string, string> => {
      const meeting = this.meeting();
      return meeting.password ? { password: meeting.password } : {};
    });
  }

  private initMeetingDetailHref(): Signal<string> {
    return computed(() => {
      const url = this.meetingDetailUrl();
      const params = this.meetingDetailQueryParams();
      const queryString = new URLSearchParams(params).toString();
      return queryString ? `${url}?${queryString}` : url;
    });
  }

  private initRecordingShareUrl(): Signal<string | null> {
    return toSignal(
      toObservable(this.meeting).pipe(
        switchMap((meeting) => {
          if (!meeting?.id || !meeting.recording_enabled) {
            return of(null);
          }
          // Skip for upcoming meetings — no recording exists yet
          // Use occurrence start time for recurring meetings, fall back to meeting start time
          const startTime = this.occurrence()?.start_time || meeting.start_time;
          if (new Date(startTime).getTime() > Date.now()) {
            return of(null);
          }
          return this.meetingService.getPastMeetingRecording(meeting.id).pipe(
            map((recording: PastMeetingRecording | null) => {
              if (!recording?.sessions?.length) {
                return null;
              }
              const largest = recording.sessions.reduce((a, b) => ((a.total_size || 0) >= (b.total_size || 0) ? a : b));
              return largest.share_url || null;
            }),
            catchError(() => of(null))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initAttachments(): Signal<MeetingAttachment[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        switchMap((meeting) => (meeting?.id ? this.meetingService.getMeetingAttachments(meeting.id) : of([]))),
        catchError(() => of([] as MeetingAttachment[]))
      ),
      { initialValue: [] }
    );
  }
}
