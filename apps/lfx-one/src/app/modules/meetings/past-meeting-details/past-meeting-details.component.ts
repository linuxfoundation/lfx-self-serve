// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location, NgClass } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingSummaryModalComponent } from '@app/modules/meetings/components/meeting-summary-modal/meeting-summary-modal.component';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  DEFAULT_MEETING_TYPE_CONFIG,
  EnrichedPastMeetingParticipant,
  MEETING_TYPE_CONFIGS,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  TagSeverity,
} from '@lfx-one/shared';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-past-meeting-details',
  imports: [
    NgClass,
    SkeletonModule,
    ButtonComponent,
    CardComponent,
    TagComponent,
    ExpandableTextComponent,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    LinkifyPipe,
    DynamicDialogModule,
    TableComponent,
    AvatarComponent,
    TooltipModule,
  ],
  templateUrl: './past-meeting-details.component.html',
})
export class PastMeetingDetailsComponent {
  // Private injections
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);

  // Simple writable signals
  public loading = signal(true);
  public participantsLoading = signal(true);
  public invitationFilter = signal<'all' | 'invited' | 'uninvited'>('all');
  public attendanceFilter = signal<'all' | 'attended' | 'absent'>('all');
  public votingOnly = signal(false);

  // Complex signals via init functions
  public meeting: Signal<PastMeeting | null> = this.initMeeting();
  public recording: Signal<PastMeetingRecording | null> = this.initRecording();
  public summary: Signal<PastMeetingSummary | null> = this.initSummary();
  public attachments: Signal<PastMeetingAttachment[]> = this.initAttachments();
  public participants: Signal<EnrichedPastMeetingParticipant[]> = this.initParticipants();

  // Computed signals
  public attendeeCount: Signal<number> = computed(() => this.participants().filter((p) => p.is_attended).length);
  public absenteeCount: Signal<number> = computed(() => this.participants().filter((p) => !p.is_attended).length);
  public invitedCount: Signal<number> = computed(() => this.participants().filter((p) => p.is_invited).length);
  public uninvitedCount: Signal<number> = computed(() => this.participants().filter((p) => !p.is_invited).length);
  public votingRepCount: Signal<number> = computed(
    () => this.participants().filter((p) => p.committee_voting_status === 'Voting Rep' || p.committee_voting_status === 'Alternate Voting Rep').length
  );
  public hasVotingCommittees: Signal<boolean> = computed(() => {
    const meeting = this.meeting();
    return meeting?.committees?.some((c) => c.allowed_voting_statuses && c.allowed_voting_statuses.length > 0) ?? false;
  });
  public isRecurring: Signal<boolean> = computed(() => !!this.meeting()?.recurrence);
  public filteredParticipants: Signal<EnrichedPastMeetingParticipant[]> = computed(() => {
    let result = this.participants();
    const invitation = this.invitationFilter();
    if (invitation === 'invited') result = result.filter((p) => p.is_invited);
    if (invitation === 'uninvited') result = result.filter((p) => !p.is_invited);
    const attendance = this.attendanceFilter();
    if (attendance === 'attended') result = result.filter((p) => p.is_attended);
    if (attendance === 'absent') result = result.filter((p) => !p.is_attended);
    if (this.votingOnly()) {
      result = result.filter((p) => p.committee_voting_status === 'Voting Rep' || p.committee_voting_status === 'Alternate Voting Rep');
    }
    return result;
  });
  public meetingTypeBadge = this.initMeetingTypeBadge();
  public attendancePercentage = this.initAttendancePercentage();
  public attendanceBarColor = this.initAttendanceBarColor();
  public hasRecording = this.initHasRecording();
  public recordingShareUrl = this.initRecordingShareUrl();
  public hasSummary = this.initHasSummary();
  public summaryContent = this.initSummaryContent();
  public summaryApproved = this.initSummaryApproved();

  // Public methods
  public goBack(): void {
    this.location.back();
  }

  public openSummaryModal(): void {
    const summary = this.summary();
    if (!summary) return;

    this.dialogService.open(MeetingSummaryModalComponent, {
      header: summary.summary_data?.title || 'AI Summary',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { summary },
    });
  }

  public downloadAttachment(attachment: PastMeetingAttachment): void {
    const meeting = this.meeting();
    if (!meeting) return;

    this.meetingService
      .getPastMeetingAttachmentDownloadUrl(meeting.id, attachment.uid)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const newWindow = window.open(res.download_url, '_blank', 'noopener');
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

  public openRecording(): void {
    const url = this.recordingShareUrl();
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // Private init functions
  private initMeeting(): Signal<PastMeeting | null> {
    return toSignal(
      this.activatedRoute.paramMap.pipe(
        switchMap((params) => {
          const meetingId = params.get('id');
          if (!meetingId) {
            this.router.navigate(['/meetings']);
            return of(null);
          }
          this.loading.set(true);
          return this.meetingService.getPastMeetingById(meetingId).pipe(
            catchError((error) => {
              if ([404, 403].includes(error.status)) {
                this.router.navigate(['/meetings']);
              }
              return of(null);
            })
          );
        }),
        tap(() => this.loading.set(false))
      ),
      { initialValue: null }
    );
  }

  private initRecording(): Signal<PastMeetingRecording | null> {
    return toSignal(
      toObservable(this.meeting).pipe(
        filter((m): m is PastMeeting => !!m?.id),
        map((m) => m.id),
        distinctUntilChanged(),
        take(1),
        switchMap((id) => this.meetingService.getPastMeetingRecording(id).pipe(catchError(() => of(null))))
      ),
      { initialValue: null }
    );
  }

  private initSummary(): Signal<PastMeetingSummary | null> {
    return toSignal(
      toObservable(this.meeting).pipe(
        filter((m): m is PastMeeting => !!m?.id),
        map((m) => m.id),
        distinctUntilChanged(),
        take(1),
        switchMap((id) => this.meetingService.getPastMeetingSummary(id).pipe(catchError(() => of(null))))
      ),
      { initialValue: null }
    );
  }

  private initParticipants(): Signal<EnrichedPastMeetingParticipant[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        filter((m): m is PastMeeting => !!m?.id),
        distinctUntilChanged((a, b) => a.id === b.id),
        take(1),
        tap(() => this.participantsLoading.set(true)),
        switchMap((meeting) => {
          const committeeUids = (meeting.committees || []).map((c) => c.uid).filter(Boolean);
          const committeeMembers$ =
            committeeUids.length > 0
              ? combineLatest(committeeUids.map((uid) => this.committeeService.getCommitteeMembers(uid).pipe(catchError(() => of([]))))).pipe(
                  map((arrays) => arrays.flat())
                )
              : of([]);

          return combineLatest([
            this.meetingService.getPastMeetingParticipants(meeting.id).pipe(catchError(() => of([] as PastMeetingParticipant[]))),
            committeeMembers$,
          ]).pipe(
            map(([participants, committeeMembers]) => {
              const memberMap = new Map(committeeMembers.map((m) => [m.email?.toLowerCase(), m]));
              return participants.map((p) => {
                const member = memberMap.get(p.email?.toLowerCase());
                const enriched: EnrichedPastMeetingParticipant = {
                  ...p,
                  committee_name: member?.committee_name ?? null,
                  committee_role: member?.role?.name ?? null,
                  committee_voting_status: member?.voting?.status ?? null,
                  committee_category: member?.committee_category ?? null,
                };
                return enriched;
              });
            }),
            tap(() => this.participantsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initAttachments(): Signal<PastMeetingAttachment[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        filter((m): m is PastMeeting => !!m?.id),
        map((m) => m.id),
        distinctUntilChanged(),
        take(1),
        switchMap((id) => this.meetingService.getPastMeetingAttachments(id).pipe(catchError(() => of([] as PastMeetingAttachment[]))))
      ),
      { initialValue: [] }
    );
  }

  private initMeetingTypeBadge(): Signal<{ severity: TagSeverity; styleClass: string; icon?: string; text: string } | null> {
    return computed(() => {
      const meetingType = this.meeting()?.meeting_type;
      if (!meetingType) return null;
      const type = meetingType.toLowerCase();
      const config = MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG;
      return { severity: 'secondary' as TagSeverity, styleClass: config.tagStyleClass, icon: config.icon, text: meetingType };
    });
  }

  private initAttendancePercentage(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) return 0;
      const total = meeting.participant_count || 0;
      const attended = meeting.attended_count || 0;
      return total > 0 ? Math.round((attended / total) * 100) : 0;
    });
  }

  private initAttendanceBarColor(): Signal<string> {
    return computed(() => {
      const pct = this.attendancePercentage();
      if (pct < 25) return 'bg-amber-500';
      if (pct < 70) return 'bg-blue-500';
      return 'bg-emerald-500';
    });
  }

  private initRecordingShareUrl(): Signal<string | null> {
    return computed(() => {
      const rec = this.recording();
      if (!rec?.sessions?.length) return null;
      const largest = rec.sessions.reduce((a, b) => ((a.total_size || 0) >= (b.total_size || 0) ? a : b));
      return largest.share_url || null;
    });
  }

  private initHasRecording(): Signal<boolean> {
    return computed(() => this.recordingShareUrl() !== null);
  }

  private initSummaryContent(): Signal<string | null> {
    return computed(() => {
      const s = this.summary();
      if (!s?.summary_data) return null;
      return s.summary_data.edited_content || s.summary_data.content;
    });
  }

  private initSummaryApproved(): Signal<boolean> {
    return computed(() => this.summary()?.approved || false);
  }

  private initHasSummary(): Signal<boolean> {
    return computed(() => this.summaryContent() !== null);
  }
}
