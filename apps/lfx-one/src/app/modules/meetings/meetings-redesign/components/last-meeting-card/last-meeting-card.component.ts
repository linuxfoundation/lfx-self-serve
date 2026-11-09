// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
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
import { MEETING_VISIBILITY_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import {
  MeetingHomeAttendance,
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingHomeSummaryChange,
  MeetingVisibilityInfo,
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import {
  formatMeetingWhen,
  getMeetingGroupNames,
  getMeetingHomeAttendance,
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
  getPastMeetingSummaryContent,
  isPastMeetingSummaryAwaitingApproval,
} from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiSplitButtonComponent } from '@shared/uikit/split-button/split-button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';
import { MeetingsHomeDialogsService } from '../../services/meetings-home-dialogs.service';
import { MeetingHomeAttendanceComponent } from '../meeting-home-attendance/meeting-home-attendance.component';
import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';

/**
 * Last meeting card of the meetings home right column: the viewer's most recent past meeting with its recording and AI summary.
 * @description Each button shows only once its artifact has loaded and exists; a failed lookup hides it. Recording opens
 * in a new tab and its split half copies the link; AI Summary opens the meetings home dialog.
 */
@Component({
  selector: 'lfx-last-meeting-card',
  imports: [
    DatePipe,
    MeetingHomeAttendanceComponent,
    MeetingProjectLogoComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiSkeletonComponent,
    UiSplitButtonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './last-meeting-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LastMeetingCardComponent {
  private readonly router = inject(Router);
  private readonly dialogs = inject(MeetingsHomeDialogsService);
  private readonly details = inject(MeetingsHomeDetailsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly projectNameElement = viewChild<ElementRef<HTMLElement>>('projectName');

  /** The last meeting; null when the viewer has none. */
  public readonly row = input.required<MeetingHomeRow | null>();
  public readonly loading = input<boolean>(false);
  /** Undefined while loading, null when there is none or the lookup failed. */
  public readonly summary = input<PastMeetingSummary | null | undefined>(undefined);
  public readonly recordingUrl = input<string | null | undefined>(undefined);
  /** The summary after an organizer edited or approved it in the dialog. */
  public readonly summaryChange = output<MeetingHomeSummaryChange>();

  protected readonly projectTruncated = signal(false);
  protected readonly link: Signal<MeetingHomeRowLink | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingHomeRowLink(row, 'past') : null;
  });
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() => {
    const row = this.row();
    // Public needs no badge on the tile, as on the list rows.
    return row ? getMeetingVisibilityBadges(row.meeting).filter((badge) => badge.kind !== MeetingVisibilityKind.PUBLIC) : [];
  });
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingHomeRowProject(row.meeting) : null;
  });
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly recurrenceTooltip: Signal<string | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingRecurrenceTooltip(row.meeting, row.occurrence) : null;
  });
  protected readonly groups: Signal<string[]> = computed(() => {
    const row = this.row();
    return row ? getMeetingGroupNames(row.meeting) : [];
  });
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingHomeRowType(row.meeting) : null;
  });
  protected readonly attendance: Signal<MeetingHomeAttendance | null> = computed(() => {
    const row = this.row();
    return row ? getMeetingHomeAttendance(row, true) : null;
  });
  /** Raw summary text the viewer may read; organizers also see one awaiting their approval. */
  protected readonly summaryContent: Signal<string | null> = this.initSummaryContent();
  /** Only organizers see a summary that still needs approval; tell them invitees don't yet. */
  protected readonly summaryAwaitingReview: Signal<boolean> = computed(() => !!this.summaryContent() && isPastMeetingSummaryAwaitingApproval(this.summary()));
  protected readonly visibilityBg = MEETING_VISIBILITY_BG_CLASSES;

  public constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;
      const isTruncated = (element: ElementRef<HTMLElement> | undefined): boolean =>
        !!element && element.nativeElement.scrollWidth > element.nativeElement.clientWidth;
      const observer = new ResizeObserver(() => this.projectTruncated.set(isTruncated(this.projectNameElement())));
      // The card re-renders as data loads, so observe its host rather than elements that come and go.
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected open(): void {
    const row = this.row();
    // Releasing a text selection inside the card is not a click on it.
    if (!row || window.getSelection()?.toString()) return;
    this.details.open(row, 'last_card');
  }

  /** A plain click on the title opens the drawer; a modified click keeps the link's own behaviour. */
  protected onTitleClick(event: MouseEvent): void {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.open();
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
    if (!row || !summary || !this.summaryContent()) return;
    this.dialogs.openSummary(row, summary, (change) => this.summaryChange.emit({ key: row.key, summary: change }));
  }

  protected openRecording(shareUrl: string): void {
    this.dialogs.openRecording(shareUrl);
  }

  protected copyRecordingLink(shareUrl: string): void {
    this.dialogs.copyRecordingLink(shareUrl);
  }

  private initWhen(): Signal<string> {
    return computed(() => {
      const row = this.row();
      return row ? formatMeetingWhen(row.startTime, row.durationMinutes) : '';
    });
  }

  private initSummaryContent(): Signal<string | null> {
    return computed(() => getPastMeetingSummaryContent(this.row()?.meeting, this.summary()));
  }
}
