// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingType, MeetingVisibilityKind } from '@lfx-one/shared/enums';
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
  getMeetingProjectUrl,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
} from '@lfx-one/shared/utils';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * One row of the meetings home list: date tile with visibility badges, project eyebrow, title and meta line.
 * @description Clicking the row opens the meeting; the project eyebrow opens the project instead.
 */
@Component({
  selector: 'lfx-meeting-home-row',
  imports: [DatePipe, UiAvatarComponent, UiTooltipDirective],
  templateUrl: './meeting-home-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeRowComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly titleElement = viewChild.required<ElementRef<HTMLElement>>('titleElement');

  public readonly row = input.required<MeetingHomeRow>();
  public readonly view = input.required<MeetingDashboardView>();

  protected readonly past: Signal<boolean> = computed(() => this.view() === 'past');
  protected readonly link: Signal<MeetingHomeRowLink> = computed(() => getMeetingHomeRowLink(this.row(), this.view()));
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() => getMeetingVisibilityBadges(this.row().meeting));
  protected readonly project: Signal<MeetingHomeRowProject | null> = this.initProject();
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = this.initMeetingType();
  protected readonly recurrenceTooltip: Signal<string | null> = computed(() => getMeetingRecurrenceTooltip(this.row().meeting, this.row().occurrence));
  protected readonly attended: Signal<boolean> = computed(() => {
    const meeting: Meeting | PastMeeting = this.row().meeting;
    return this.past() && 'user_attended' in meeting && meeting.user_attended === true;
  });
  protected readonly titleTruncated = signal(false);
  protected readonly visibilityBg: Record<MeetingVisibilityKind, string> = {
    [MeetingVisibilityKind.PUBLIC]: 'bg-emerald-500',
    [MeetingVisibilityKind.PRIVATE]: 'bg-gray-900',
    [MeetingVisibilityKind.RESTRICTED]: 'bg-red-600',
  };

  public constructor() {
    afterNextRender(() => {
      const title = this.titleElement().nativeElement;
      const observer = new ResizeObserver(() => this.titleTruncated.set(title.scrollWidth > title.clientWidth));
      observer.observe(title);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected open(): void {
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

  private initProject(): Signal<MeetingHomeRowProject | null> {
    return computed(() => {
      const meeting = this.row().meeting;
      const name = meeting.project_name?.trim();
      if (!name) return null;
      return {
        name,
        initial: Array.from(name)[0].toUpperCase(),
        logo: meeting.project_logo_url ?? '',
        url: getMeetingProjectUrl(meeting),
        label: `${meeting.is_foundation ? 'Jump to foundation' : 'Jump to project'}: ${name}`,
      };
    });
  }

  private initWhen(): Signal<string> {
    return computed(() => {
      const { startTime, durationMinutes } = this.row();
      return [formatDate(startTime, 'EEE, MMM d', 'en-US'), formatMeetingTimeRange(startTime, durationMinutes), `${durationMinutes} min`].join(' · ');
    });
  }

  private initMeetingType(): Signal<MeetingHomeRowType | null> {
    return computed(() => {
      const type = this.row().meeting.meeting_type?.trim();
      if (!type || type === MeetingType.NONE) return null;
      const config = MEETING_TYPE_CONFIGS[type.toLowerCase()];
      return { label: config?.label ?? type, icon: (config ?? DEFAULT_MEETING_TYPE_CONFIG).icon };
    });
  }
}
