// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Params, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  DEFAULT_MEETING_TYPE_CONFIG,
  Meeting,
  MEETING_TYPE_CONFIGS,
  MeetingOccurrence,
  MeetingTypeBadge,
  PastMeetingRecording,
  TagSeverity,
} from '@lfx-one/shared';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-dashboard-meeting-card',
  imports: [ButtonComponent, TooltipModule, ClipboardModule, RecurrenceSummaryPipe, RouterLink],
  templateUrl: './dashboard-meeting-card.component.html',
})
export class DashboardMeetingCardComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  public readonly meeting = input.required<Meeting>();
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  /** Optional override for the detail URL. Defaults to /meetings/{meeting.id}. */
  public readonly detailUrl = input<string | null>(null);
  /** Set to false to hide the "Meeting details" button. */
  public readonly showDetailsButton = input<boolean>(true);
  /** Set to false to open the details link in the same tab. */
  public readonly openDetailsInNewTab = input<boolean>(true);

  // Card variant inputs for the Figma-style header strip
  /** Label shown in the card header strip (e.g. "LAST MEETING" / "NEXT MEETING"). When null, no header strip is rendered. */
  public readonly cardLabel = input<string | null>(null);
  /** Color theme for the card header strip and date badge. */
  public readonly cardVariant = input<'neutral' | 'accent'>('neutral');
  /** Router link for the "View all" button in the card header strip. */
  public readonly viewAllRouterLink = input<string | null>(null);
  /** Query params for the "View all" router link. */
  public readonly viewAllQueryParams = input<Params>({});
  /** Optional recording URL override — when set, skips the API call and renders the "Watch recording" button directly. */
  public readonly recordingUrl = input<string | null>(null);

  public readonly joinUrl: Signal<string | null>;

  // Computed values
  public readonly meetingTypeInfo: Signal<MeetingTypeBadge> = this.initMeetingTypeInfo();
  public readonly meetingStartTime: Signal<string> = this.initMeetingStartTime();
  public readonly formattedTimeWithDuration: Signal<string> = this.initFormattedTimeWithDuration();
  public readonly isPrivate: Signal<boolean> = this.initIsPrivate();
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

  // New signals for the Figma card design
  public readonly meetingDay: Signal<string> = this.initMeetingDay();
  public readonly meetingMonth: Signal<string> = this.initMeetingMonth();
  public readonly meetingDuration: Signal<number> = this.initMeetingDuration();
  public readonly meetingDescription: Signal<string> = this.initMeetingDescription();
  public readonly projectChipLabel: Signal<string | null> = this.initProjectChipLabel();
  public readonly dateBadgeDotInfo: Signal<{ bgColor: string; icon: string }> = this.initDateBadgeDotInfo();

  public constructor() {
    const meeting$ = toObservable(this.meeting);
    const user$ = toObservable(this.userService.user);
    const authenticated$ = toObservable(this.userService.authenticated);

    const joinUrl$ = combineLatest([meeting$, user$, authenticated$]).pipe(
      switchMap(([meeting, user, authenticated]) => {
        if (!meeting.id || !this.canJoinMeeting()) {
          return of(null);
        }

        if (meeting.public_link) {
          return of(meeting.public_link);
        }

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
      return occurrence?.start_time || meeting.start_time;
    });
  }

  private initFormattedTimeWithDuration(): Signal<string> {
    return computed(() => {
      const startTime = this.meetingStartTime();
      try {
        const date = new Date(startTime);
        if (isNaN(date.getTime())) return startTime;
        const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
        const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const duration = this.meetingDuration();
        return duration > 0 ? `${weekday}, ${time} · ${duration}m` : `${weekday}, ${time}`;
      } catch {
        return startTime;
      }
    });
  }

  private initIsPrivate(): Signal<boolean> {
    return computed(() => {
      return this.meeting().visibility === 'private';
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

  private initCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();

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
      combineLatest([toObservable(this.meeting), toObservable(this.recordingUrl), toObservable(this.occurrence)]).pipe(
        switchMap(([meeting, recordingUrlOverride, occurrence]) => {
          if (recordingUrlOverride) {
            return of(recordingUrlOverride);
          }
          if (!meeting?.id || !meeting.recording_enabled) {
            return of(null);
          }
          const startTime = occurrence?.start_time || meeting.start_time;
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

  private initMeetingDay(): Signal<string> {
    return computed(() => {
      const date = new Date(this.meetingStartTime());
      return isNaN(date.getTime()) ? '' : String(date.getDate());
    });
  }

  private initMeetingMonth(): Signal<string> {
    return computed(() => {
      const date = new Date(this.meetingStartTime());
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    });
  }

  private initMeetingDuration(): Signal<number> {
    return computed(() => {
      const occurrence = this.occurrence();
      return occurrence?.duration ?? this.meeting().duration ?? 0;
    });
  }

  private initMeetingDescription(): Signal<string> {
    return computed(() => {
      const occurrence = this.occurrence();
      return occurrence?.description || this.meeting().description || '';
    });
  }

  private initProjectChipLabel(): Signal<string | null> {
    return computed(() => {
      const meeting = this.meeting();
      return meeting.project_name || meeting.committees?.[0]?.name || null;
    });
  }

  private initDateBadgeDotInfo(): Signal<{ bgColor: string; icon: string }> {
    return computed(() => ({
      bgColor: this.isPrivate() ? '#d4183d' : '#00bc7d',
      icon: this.isPrivate() ? 'fa-solid fa-shield-halved' : 'fa-solid fa-globe',
    }));
  }
}
