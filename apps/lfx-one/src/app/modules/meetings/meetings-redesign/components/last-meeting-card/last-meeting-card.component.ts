// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranscriptModalComponent } from '@app/modules/meetings/components/transcript-modal/transcript-modal.component';
import { RecordingModalComponent } from '@components/recording-modal/recording-modal.component';
import { SummaryModalComponent } from '@components/summary-modal/summary-modal.component';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingType, MeetingVisibilityKind } from '@lfx-one/shared/enums';
import {
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingVisibilityInfo,
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import {
  getMeetingHomeRowLink,
  getMeetingProjectUrl,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
  isPastMeetingSummaryAwaitingApproval,
  isPastMeetingSummaryReadOnly,
  isPastMeetingSummaryVisible,
  stripMarkdown,
} from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { DialogService } from 'primeng/dynamicdialog';

/**
 * Last meeting card of the meetings home right column: the viewer's most recent past meeting with its AI summary,
 * transcript and recording.
 * @description Each artifact shows only once it has loaded and exists; a failed lookup hides it. Read more, Transcript
 * and Recording open the same dialogs as the legacy meeting card and meeting page.
 */
@Component({
  selector: 'lfx-last-meeting-card',
  imports: [DatePipe, UiAvatarComponent, UiBadgeComponent, UiButtonComponent, UiEmptyStateComponent, UiSkeletonComponent, UiTooltipDirective],
  templateUrl: './last-meeting-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LastMeetingCardComponent {
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly projectNameElement = viewChild<ElementRef<HTMLElement>>('projectName');
  private readonly groupNameElement = viewChild<ElementRef<HTMLElement>>('groupName');

  /** The last meeting; null when the viewer has none. */
  public readonly row = input.required<MeetingHomeRow | null>();
  public readonly loading = input<boolean>(false);
  /** Undefined while loading, null when there is none or the lookup failed. */
  public readonly summary = input<PastMeetingSummary | null | undefined>(undefined);
  public readonly hasTranscript = input<boolean | null | undefined>(undefined);
  public readonly recordingUrl = input<string | null | undefined>(undefined);
  /** The summary after an organizer edited or approved it in the dialog. */
  public readonly summaryChange = output<PastMeetingSummary>();

  protected readonly projectTruncated = signal(false);
  protected readonly groupTruncated = signal(false);
  protected readonly link: Signal<MeetingHomeRowLink | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingHomeRowLink(row, 'past') : null;
  });
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() => {
    const row = this.row();
    return row ? getMeetingVisibilityBadges(row.meeting) : [];
  });
  protected readonly project: Signal<MeetingHomeRowProject | null> = this.initProject();
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly recurrenceTooltip: Signal<string | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingRecurrenceTooltip(row.meeting, row.occurrence) : null;
  });
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = this.initMeetingType();
  protected readonly group: Signal<string> = computed(() =>
    (this.row()?.meeting.committees ?? [])
      .map((committee) => committee.name?.trim())
      .filter(Boolean)
      .join(', ')
  );
  /** Raw summary text the viewer may read; organizers also see one awaiting their approval. */
  protected readonly summaryContent: Signal<string | null> = this.initSummaryContent();
  protected readonly summaryText: Signal<string> = computed(() => stripMarkdown(this.summaryContent() ?? ''));
  /** Only organizers see a summary that still needs approval; tell them invitees don't yet. */
  protected readonly summaryAwaitingReview: Signal<boolean> = computed(() => !!this.summaryContent() && isPastMeetingSummaryAwaitingApproval(this.summary()));
  protected readonly visibilityBg: Record<MeetingVisibilityKind, string> = {
    [MeetingVisibilityKind.PUBLIC]: 'bg-emerald-500',
    [MeetingVisibilityKind.PRIVATE]: 'bg-gray-900',
    [MeetingVisibilityKind.RESTRICTED]: 'bg-red-600',
  };

  public constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;
      const isTruncated = (element: ElementRef<HTMLElement> | undefined): boolean =>
        !!element && element.nativeElement.scrollWidth > element.nativeElement.clientWidth;
      const observer = new ResizeObserver(() => {
        this.projectTruncated.set(isTruncated(this.projectNameElement()));
        this.groupTruncated.set(isTruncated(this.groupNameElement()));
      });
      // The card re-renders as data loads, so observe its host rather than elements that come and go.
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected open(): void {
    const link = this.link();
    // Releasing a text selection inside the card is not a click on it.
    if (!link || window.getSelection()?.toString()) return;
    void this.router.navigateByUrl(link.url);
  }

  /** Keeps a link click from also opening the card; a plain click navigates in-app. */
  protected onLinkClick(event: MouseEvent, url: string): void {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  protected openSummary(event: Event): void {
    event.stopPropagation();
    const row = this.row();
    const summary = this.summary();
    const content = this.summaryContent();
    if (!row || !summary || !content) return;

    this.dialogService.open(SummaryModalComponent, {
      header: 'Meeting Summary',
      width: '800px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        summaryContent: content,
        summaryUid: summary.uid ?? '',
        pastMeetingUid: row.key,
        meetingTitle: row.title,
        approved: summary.approved,
        readOnly: isPastMeetingSummaryReadOnly(row.meeting, summary),
        onSummaryUpdated: (update: { content: string; approved: boolean }) =>
          this.summaryChange.emit({ ...summary, approved: update.approved, summary_data: { ...summary.summary_data, edited_content: update.content } }),
      },
    });
  }

  protected openTranscript(event: Event): void {
    event.stopPropagation();
    const row = this.row();
    if (!row) return;

    this.dialogService.open(TranscriptModalComponent, {
      header: 'Transcript',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { pastMeetingUid: row.key, meetingTitle: row.title },
    });
  }

  protected openRecording(event: Event): void {
    event.stopPropagation();
    const row = this.row();
    const shareUrl = this.recordingUrl();
    if (!row || !shareUrl) return;

    this.dialogService.open(RecordingModalComponent, {
      header: 'Meeting Recording',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { shareUrl, meetingTitle: row.title },
    });
  }

  // shortcut: date tile, visibility badges and eyebrow repeat meeting-home-row's. revisit: when the Next card lands with the same pieces
  private initProject(): Signal<MeetingHomeRowProject | null> {
    return computed(() => {
      const meeting = this.row()?.meeting;
      const name = meeting?.project_name?.trim();
      if (!meeting || !name) return null;
      return {
        name,
        initial: Array.from(name)[0].toUpperCase(),
        logo: meeting.project_logo_url ?? '',
        url: getMeetingProjectUrl(meeting),
        label: `${meeting.is_foundation ? 'Jump to foundation' : 'Jump to project'}: ${name}`,
      };
    });
  }

  /** "Wed, 8:00 AM · 60m" in the viewer's zone, per the design. */
  private initWhen(): Signal<string> {
    return computed(() => {
      const row = this.row();
      return row ? `${formatDate(row.startTime, 'EEE, h:mm a', 'en-US')} · ${row.durationMinutes}m` : '';
    });
  }

  private initMeetingType(): Signal<MeetingHomeRowType | null> {
    return computed(() => {
      const type = this.row()?.meeting.meeting_type?.trim();
      if (!type || type === MeetingType.NONE) return null;
      const config = MEETING_TYPE_CONFIGS[type.toLowerCase()];
      return { label: config?.label ?? type, icon: (config ?? DEFAULT_MEETING_TYPE_CONFIG).icon };
    });
  }

  private initSummaryContent(): Signal<string | null> {
    return computed(() => {
      const summary = this.summary();
      const content = summary?.summary_data?.edited_content || summary?.summary_data?.content;
      if (!content?.trim()) return null;
      return isPastMeetingSummaryVisible(summary) || this.row()?.meeting.organizer === true ? content : null;
    });
  }
}
