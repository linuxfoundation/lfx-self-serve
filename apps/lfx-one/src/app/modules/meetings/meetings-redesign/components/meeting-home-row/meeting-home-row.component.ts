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
  PLATFORM_ID,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingDashboardView,
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingVisibilityInfo,
  PastMeeting,
} from '@lfx-one/shared/interfaces';
import {
  formatMeetingTimeRange,
  getMeetingHomeRowLink,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingHomeActionsComponent } from '../meeting-home-actions/meeting-home-actions.component';
import { MeetingHomeArtifactsComponent } from '../meeting-home-artifacts/meeting-home-artifacts.component';
import { MeetingRsvpControlsComponent } from '../meeting-rsvp-controls/meeting-rsvp-controls.component';

/**
 * One row of the meetings home list: date tile with visibility badges, project eyebrow, title and meta line.
 * @description Clicking the row opens the meeting; the project eyebrow opens the project instead.
 */
@Component({
  selector: 'lfx-meeting-home-row',
  imports: [DatePipe, MeetingHomeActionsComponent, MeetingHomeArtifactsComponent, MeetingRsvpControlsComponent, UiAvatarComponent, UiTooltipDirective],
  templateUrl: './meeting-home-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeRowComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly titleElement = viewChild.required<ElementRef<HTMLElement>>('titleElement');
  private readonly projectNameElement = viewChild<ElementRef<HTMLElement>>('projectName');

  public readonly row = input.required<MeetingHomeRow>();
  public readonly view = input.required<MeetingDashboardView>();

  protected readonly titleTruncated = signal(false);
  protected readonly projectTruncated = signal(false);
  protected readonly past: Signal<boolean> = computed(() => this.view() === 'past');
  protected readonly link: Signal<MeetingHomeRowLink> = computed(() => getMeetingHomeRowLink(this.row(), this.view()));
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() => getMeetingVisibilityBadges(this.row().meeting));
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.row().meeting));
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = computed(() => getMeetingHomeRowType(this.row().meeting));
  protected readonly recurrenceTooltip: Signal<string | null> = computed(() => getMeetingRecurrenceTooltip(this.row().meeting, this.row().occurrence));
  protected readonly attended: Signal<boolean> = this.initAttended();
  protected readonly visibilityBg: Record<MeetingVisibilityKind, string> = {
    [MeetingVisibilityKind.PUBLIC]: 'bg-emerald-500',
    [MeetingVisibilityKind.PRIVATE]: 'bg-gray-900',
    [MeetingVisibilityKind.RESTRICTED]: 'bg-red-600',
  };

  public constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;
      const title = this.titleElement().nativeElement;
      const projectName = this.projectNameElement()?.nativeElement;
      const observer = new ResizeObserver(() => {
        this.titleTruncated.set(title.scrollWidth > title.clientWidth);
        this.projectTruncated.set(!!projectName && projectName.scrollWidth > projectName.clientWidth);
      });
      observer.observe(title);
      if (projectName) observer.observe(projectName);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected open(): void {
    // Releasing a text selection inside the row is not a click on it.
    if (window.getSelection()?.toString()) return;
    const { url, newTab } = this.link();
    if (newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      void this.router.navigateByUrl(url);
    }
  }

  /** Keeps a link click from also opening the row; a plain same-tab click navigates in-app. */
  protected onLinkClick(event: MouseEvent, url: string, newTab: boolean): void {
    event.stopPropagation();
    if (newTab || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  private initAttended(): Signal<boolean> {
    return computed(() => {
      const meeting: Meeting | PastMeeting = this.row().meeting;
      return this.past() && 'user_attended' in meeting && meeting.user_attended === true;
    });
  }

  private initWhen(): Signal<string> {
    return computed(() => {
      const { startTime, durationMinutes } = this.row();
      return [formatDate(startTime, 'EEE, MMM d', 'en-US'), formatMeetingTimeRange(startTime, durationMinutes), `${durationMinutes} min`].join(' · ');
    });
  }
}
