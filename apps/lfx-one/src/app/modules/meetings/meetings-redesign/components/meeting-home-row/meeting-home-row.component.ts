// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MeetingVisibilityKind } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingDashboardView,
  MeetingHomeAttendance,
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowOrganizer,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingVisibilityInfo,
  PastMeeting,
} from '@lfx-one/shared/interfaces';
import {
  getMeetingGroupNames,
  getMeetingHomeAttendance,
  getMeetingHomeRowLink,
  getMeetingHomeRowOrganizers,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceLabel,
  getMeetingRecurrenceTooltip,
  getMeetingVisibilityBadges,
  getMeetingWhenParts,
} from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingsHomeDetailsService } from '../../services/meetings-home-details.service';
import { MeetingsHomeJoinService } from '../../services/meetings-home-join.service';
import { MeetingsHomeResizeService } from '../../services/meetings-home-resize.service';
import { MeetingsHomeStore } from '../../services/meetings-home.store';
import { MeetingDateTileComponent } from '../meeting-date-tile/meeting-date-tile.component';
import { MeetingHomeActionsComponent } from '../meeting-home-actions/meeting-home-actions.component';
import { MeetingHomeAttendancePopupComponent } from '../meeting-home-attendance-popup/meeting-home-attendance-popup.component';
import { MeetingHomeArtifactsComponent } from '../meeting-home-artifacts/meeting-home-artifacts.component';
import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';
import { MeetingRsvpControlsComponent } from '../meeting-rsvp-controls/meeting-rsvp-controls.component';

/**
 * One row of the meetings home list: date tile with visibility badges, project eyebrow, title and two meta lines.
 * @description Clicking the row opens the meeting details drawer; the project eyebrow opens the project instead.
 */
@Component({
  selector: 'lfx-meeting-home-row',
  imports: [
    MeetingDateTileComponent,
    MeetingHomeActionsComponent,
    MeetingHomeArtifactsComponent,
    MeetingHomeAttendancePopupComponent,
    MeetingProjectLogoComponent,
    MeetingRsvpControlsComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-home-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeRowComponent {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly resize = inject(MeetingsHomeResizeService);
  private readonly store = inject(MeetingsHomeStore);
  private readonly joinService = inject(MeetingsHomeJoinService);
  private readonly details = inject(MeetingsHomeDetailsService);
  private readonly titleElement = viewChild.required<ElementRef<HTMLElement>>('titleElement');
  private readonly projectNameElement = viewChild<ElementRef<HTMLElement>>('projectName');

  public readonly row = input.required<MeetingHomeRow>();
  public readonly view = input.required<MeetingDashboardView>();

  protected readonly titleTruncated = signal(false);
  protected readonly projectTruncated = signal(false);
  protected readonly past: Signal<boolean> = computed(() => this.view() === 'past');
  protected readonly link: Signal<MeetingHomeRowLink> = computed(() => getMeetingHomeRowLink(this.row(), this.view()));
  // Public needs no badge on the tile.
  protected readonly visibilityBadges: Signal<MeetingVisibilityInfo[]> = computed(() =>
    getMeetingVisibilityBadges(this.row().meeting).filter((badge) => badge.kind !== MeetingVisibilityKind.PUBLIC)
  );
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.row().meeting));
  protected readonly when: Signal<string[]> = this.initWhen();
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = computed(() => getMeetingHomeRowType(this.row().meeting));
  protected readonly groups: Signal<string[]> = computed(() => getMeetingGroupNames(this.row().meeting));
  protected readonly recurrenceLabel: Signal<string | null> = computed(() => getMeetingRecurrenceLabel(this.row().meeting, this.row().occurrence));
  protected readonly recurrenceTooltip: Signal<string | null> = computed(() => getMeetingRecurrenceTooltip(this.row().meeting, this.row().occurrence));
  protected readonly attended: Signal<boolean> = this.initAttended();
  protected readonly attendance: Signal<MeetingHomeAttendance | null> = computed(() => getMeetingHomeAttendance(this.row(), this.past()));
  protected readonly organizers: Signal<MeetingHomeRowOrganizer[]> = computed(() =>
    getMeetingHomeRowOrganizers(this.row().meeting, this.userService.viewerUsername())
  );
  private readonly upcomingRow: Signal<MeetingHomeRow | null> = computed(() => (this.past() ? null : this.row()));
  /** Upcoming dates inside their join window get a Join button, as the Next meeting card does. */
  protected readonly joinable: Signal<boolean> = this.joinService.joinable(this.upcomingRow, this.store.now);
  protected readonly joinUrl: Signal<string | null> = this.joinService.joinUrl(this.upcomingRow, this.joinable);

  public constructor() {
    afterNextRender(() => {
      const title = this.titleElement().nativeElement;
      const projectName = this.projectNameElement()?.nativeElement;
      const stop = this.resize.observe(projectName ? [title, projectName] : [title], () => {
        this.titleTruncated.set(title.scrollWidth > title.clientWidth);
        this.projectTruncated.set(!!projectName && projectName.scrollWidth > projectName.clientWidth);
      });
      this.destroyRef.onDestroy(stop);
    });
  }

  protected open(): void {
    // Releasing a text selection inside the row is not a click on it.
    if (window.getSelection()?.toString()) return;
    this.details.open(this.row(), 'row');
  }

  /** A plain click on the title opens the drawer; a modified click keeps the link's own behaviour. */
  protected onTitleClick(event: MouseEvent): void {
    event.stopPropagation();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.details.open(this.row(), 'row');
  }

  protected join(): void {
    if (this.joinable()) this.joinService.join(this.row().meeting, this.joinUrl());
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

  private initWhen(): Signal<string[]> {
    return computed(() => {
      const { startTime, durationMinutes } = this.row();
      return getMeetingWhenParts(startTime, durationMinutes);
    });
  }
}
