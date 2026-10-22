// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ClipboardModule } from '@angular/cdk/clipboard';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Params, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  getUpcomingMeetingStartTime,
  resolveUpcomingMeetingDurationMinutes,
  Meeting,
  MEETING_TYPE_CONFIGS,
  MeetingOccurrence,
  MeetingRecurrence,
  MeetingTypeBadge,
  PastMeetingRecording,
  resolveOccurrenceRecurrence,
  resolveShownOccurrenceId,
  TagSeverity,
} from '@lfx-one/shared';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
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
  private readonly inviteResend = inject(MeetingInviteResendService);
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);

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
  /** Count of other meetings whose time range overlaps this one. When > 0, the card header shows a "+N overlapping" hint before the "View all" link. */
  public readonly overlappingCount = input<number>(0);
  /** Optional recording URL override — when set, skips the API call and renders the "Watch recording" button directly. */
  public readonly recordingUrl = input<string | null>(null);
  /** When true, suppresses the join-url fetch and hides the Join button. Pass for past-meeting contexts (e.g. Last Meeting card) where joining is never appropriate. */
  public readonly pastMeeting = input<boolean>(false);

  public readonly joinUrl: Signal<string | null>;

  // Computed values
  public readonly meetingTypeInfo: Signal<MeetingTypeBadge | null> = this.initMeetingTypeInfo();
  public readonly meetingStartTime: Signal<string> = this.initMeetingStartTime();
  public readonly formattedTimeWithDuration: Signal<string> = this.initFormattedTimeWithDuration();
  public readonly isPrivate: Signal<boolean> = this.initIsPrivate();
  public readonly isRestricted: Signal<boolean> = this.initIsRestricted();
  public readonly hasRecording: Signal<boolean> = this.initHasRecording();
  public readonly hasTranscripts: Signal<boolean> = this.initHasTranscripts();
  public readonly canJoinMeeting: Signal<boolean> = this.initCanJoinMeeting();
  public readonly hasAiSummary: Signal<boolean> = this.initHasAiSummary();
  public readonly meetingTitle: Signal<string> = this.initMeetingTitle();
  public readonly isRecurring: Signal<boolean> = this.initIsRecurring();
  // Recurrence rule for the cadence tooltip: the displayed occurrence's own override when
  // present (cadence changed at/after it — LFXV2-2112), otherwise the series rule.
  public readonly displayRecurrence: Signal<MeetingRecurrence | null> = computed(() => resolveOccurrenceRecurrence(this.meeting(), this.occurrence()));
  public readonly meetingDetailUrl: Signal<string> = this.initMeetingDetailUrl();
  public readonly meetingDetailQueryParams: Signal<Record<string, string>> = this.initMeetingDetailQueryParams();
  public readonly meetingDetailHref: Signal<string> = this.initMeetingDetailHref();
  public readonly meetingDetailClipboardUrl: Signal<string> = this.initMeetingDetailClipboardUrl();
  public readonly recordingShareUrl: Signal<string | null> = this.initRecordingShareUrl();
  public readonly canResendInvite: Signal<boolean> = this.initCanResendInvite();
  public readonly resendingInvite: Signal<boolean> = computed(() => this.inviteResend.isResendingOwn(this.meeting().id));

  // New signals for the Figma card design
  public readonly meetingDay: Signal<string> = this.initMeetingDay();
  public readonly meetingMonth: Signal<string> = this.initMeetingMonth();
  public readonly meetingDuration: Signal<number> = this.initMeetingDuration();
  public readonly meetingDescription: Signal<string> = this.initMeetingDescription();
  public readonly projectChipLabel: Signal<string | null> = this.initProjectChipLabel();
  public readonly dateBadgeDotInfo: Signal<{ bgColor: string; icon: string }> = this.initDateBadgeDotInfo();

  public constructor() {
    const meeting$ = toObservable(this.meeting);
    // The join link is built for the real viewer, never the impersonation target.
    const user$ = toObservable(this.userService.meetingJoinIdentity);
    const authenticated$ = toObservable(this.userService.authenticated);

    const joinUrl$ = combineLatest([meeting$, user$, authenticated$]).pipe(
      switchMap(([meeting, user, authenticated]) => {
        if (!meeting.id || !this.canJoinMeeting()) {
          return of(null);
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

  public resendInvite(): void {
    // The date this card shows: the occurrence input when given, else the next occurrence it resolves from the meeting
    // itself (Groups Overview passes only the meeting), so the registration that fits what is on screen is chosen.
    this.inviteResend.resendOwn(this.meeting().id, resolveShownOccurrenceId(this.meeting(), this.occurrence()));
  }

  // Resending goes to the viewer's own registrant row, so it is offered only where one exists: signed in, upcoming,
  // invited and not since removed, and with an active registration. `my_registrant_ids` is authoritative for every
  // viewer where the feed provides it, an empty list meaning no active registration (`invited` is derived from access
  // grants and can be true without one); only when it is absent does `invited` stand in. Same rule as the meeting card's
  // "Remove Myself". The removal marker is read because the cached meetings feed keeps answering `invited: true` for a
  // while after the viewer removes themselves elsewhere (query-service indexing lag), which would offer a resend for a
  // registration that no longer exists.
  private initCanResendInvite(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      if (!this.userService.authenticated() || this.pastMeeting() || !meeting.invited || this.meetingService.removedRegistrationMeetingIds().has(meeting.id)) {
        return false;
      }
      const registrantIds = meeting.my_registrant_ids;
      return registrantIds ? registrantIds.length > 0 : true;
    });
  }

  private initMeetingTypeInfo(): Signal<MeetingTypeBadge | null> {
    return computed(() => {
      const type = this.meeting().meeting_type?.toLowerCase();
      const config = type ? MEETING_TYPE_CONFIGS[type] : undefined;
      // Unrecognized/untyped meetings would only get a generic "Meeting" chip, which adds no information on a meeting card
      if (!config) {
        return null;
      }

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
      if (this.pastMeeting()) {
        return occurrence?.start_time || meeting.start_time;
      }
      // Recurring series keep their origin in start_time. Upcoming cards prefer the resolved
      // occurrence, then next_occurrence_start_time, and only then the series origin — the same
      // rule as meeting-card (LFXV2-2054). Groups Overview passes no occurrence, so without this
      // the Next Meeting badge showed the series origin (GH-2907).
      return getUpcomingMeetingStartTime(meeting, occurrence) || meeting.start_time;
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

  private initIsRestricted(): Signal<boolean> {
    return computed(() => !!this.meeting().restricted);
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
      if (this.pastMeeting()) {
        return false;
      }

      const meeting = this.meeting();

      if (meeting.restricted && !meeting.invited) {
        return false;
      }

      const explicit = this.occurrence();
      if (explicit) {
        return canJoinMeeting(meeting, explicit);
      }
      // Groups Overview passes no occurrence. Join must follow the same upcoming start the
      // badge shows, or a past series origin hides Join during the real occurrence (GH-2907).
      const start = getUpcomingMeetingStartTime(meeting);
      if (!start) {
        return canJoinMeeting(meeting);
      }
      return canJoinMeeting(meeting, {
        occurrence_id: '',
        start_time: start,
        duration: resolveUpcomingMeetingDurationMinutes(meeting),
      });
    });
  }

  private initHasAiSummary(): Signal<boolean> {
    return computed(() => this.meeting().ai_summary_enabled || false);
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

  private initMeetingDetailClipboardUrl(): Signal<string> {
    return computed(() => {
      const href = this.meetingDetailHref();
      // SSR fallback: `window` is undefined during server rendering, so we return the relative
      // path. The copy-link button sits behind a `@defer` block, so in practice the clipboard
      // write only runs in the browser where `window.location.origin` resolves — but if that
      // `@defer` is ever removed, preserve this guard so SSR snapshots don't copy a relative URL.
      if (!isPlatformBrowser(this.platformId)) return href;
      const override = this.detailUrl();
      if (override && /^https?:\/\//i.test(override)) return href;
      return `${window.location.origin}${href}`;
    });
  }

  private initRecordingShareUrl(): Signal<string | null> {
    return toSignal(
      combineLatest([toObservable(this.meeting), toObservable(this.recordingUrl), toObservable(this.occurrence), toObservable(this.pastMeeting)]).pipe(
        switchMap(([meeting, recordingUrlOverride, occurrence, pastMeeting]) => {
          if (recordingUrlOverride) {
            return of(recordingUrlOverride);
          }
          if (!meeting?.id || !meeting.recording_enabled) {
            return of(null);
          }
          const startTime = pastMeeting ? occurrence?.start_time || meeting.start_time : getUpcomingMeetingStartTime(meeting, occurrence) || meeting.start_time;
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
      const meeting = this.meeting();
      const occurrence = this.occurrence();
      if (this.pastMeeting()) {
        return occurrence?.duration ?? meeting.duration ?? 0;
      }
      return resolveUpcomingMeetingDurationMinutes(meeting, occurrence);
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
